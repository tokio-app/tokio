import { StudioCameraQuality } from "@/common/schemas";
import {
  APP_EVENTS,
  CameraCapture,
  CameraConfig,
  CameraFailure,
} from "@/common/types";

// How long a failed capture waits before it tries again
export const CAMERA_RETRY_MS = 5000;

// A keyframe at least this often (by the frames' timestamps, in µs), so a
// page that opens or falls behind waits at most this long for a picture
const KEYFRAME_US = 2_000_000;

const SIZES: Record<StudioCameraQuality, { width: number; height: number }> = {
  "720p": { width: 1280, height: 720 },
  "1080p": { width: 1920, height: 1080 },
};

// The name of what getUserMedia rejects with, to why it failed
const REASONS = new Map<unknown, CameraFailure>([
  ["NotAllowedError", "blocked"],
  ["SecurityError", "blocked"],
  ["NotFoundError", "missing"],
  ["OverconstrainedError", "missing"],
  ["NotReadableError", "busy"],
  ["AbortError", "busy"],
]);

// Why getUserMedia rejected with e, cameras and microphones alike
export function mediaFailure(e: unknown): CameraFailure {
  const name =
    typeof e === "object" && e !== null && "name" in e ? e.name : null;
  return REASONS.get(name) ?? "failed";
}

const missing = () => new DOMException("No such camera", "NotFoundError");

// The camera's id here, undefined for the default one. Ids are per origin, so
// one saved in a dev build is found by its name in the packaged app.
async function deviceOf(capture: CameraCapture) {
  if (capture.device === "") return undefined;
  const cameras = (await navigator.mediaDevices.enumerateDevices()).filter(
    (d) => d.kind === "videoinput",
  );
  const found =
    cameras.find((d) => d.deviceId === capture.device) ??
    (capture.label ? cameras.find((d) => d.label === capture.label) : null);
  if (!found) throw missing();
  return found.deviceId;
}

// The capture's camera, at its quality
async function openCamera(capture: CameraCapture) {
  const deviceId = await deviceOf(capture);
  const { width, height } = SIZES[capture.quality];
  return navigator.mediaDevices.getUserMedia({
    audio: false,
    video: {
      ...(deviceId !== undefined && { deviceId: { exact: deviceId } }),
      width: { ideal: width },
      height: { ideal: height },
      frameRate: { ideal: 30, max: 30 },
    },
  });
}

/**
 * Shows the camera a camera element's stream names (its src's device, label
 * and quality) in the video, straight from this window, until the returned
 * function stops it: the editor needs no encoding, stream or overlay server
 * to show one. One that can't open is tried again CAMERA_RETRY_MS later,
 * without a notice: a page that streams it gets one.
 */
export function previewCamera(
  video: HTMLVideoElement,
  src: string,
): () => void {
  const query = new URL(src, location.href).searchParams;
  const camera: CameraCapture = {
    id: "",
    device: query.get("device") ?? "",
    label: query.get("label") ?? "",
    quality: query.get("quality") === "1080p" ? "1080p" : "720p",
  };
  let stopped = false;
  let stream: MediaStream | null = null;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const again = () => {
    if (stopped) return;
    video.srcObject = null;
    retry = setTimeout(run, CAMERA_RETRY_MS);
  };
  const run = async () => {
    try {
      const opened = await openCamera(camera);
      if (stopped) {
        opened.getTracks().forEach((t) => t.stop());
        return;
      }
      stream = opened;
      // Unplugged: tried again
      opened.getVideoTracks()[0]?.addEventListener("ended", again, {
        once: true,
      });
      video.srcObject = opened;
      video.play().catch(() => {});
    } catch {
      again();
    }
  };
  void run();

  return () => {
    stopped = true;
    clearTimeout(retry);
    stream?.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };
}

// The first config this computer encodes, by frame size
const configs = new Map<string, VideoEncoderConfig>();
// Frame sizes whose GPU encoder took its config, then failed to start (when
// OBS holds the encoder sessions, say): they encode in software from then on
const noHardware = new Set<string>();

/**
 * The encoder config for frames of that size: H.264 Constrained Baseline,
 * Main, then High, in hardware first; null when none works. Its chunks are
 * length-prefixed NAL units (avc), as an MP4 sample holds them: main muxes
 * them for the pages' MediaSource, which plays only H.264 here.
 */
async function configFor(width: number, height: number) {
  const id = `${width}x${height}`;
  const cached = configs.get(id);
  if (cached) return cached;
  // Level 4.0 past 720p, 3.1 up to it
  const big = width * height > 1280 * 720;
  const common = {
    width,
    height,
    framerate: 30,
    latencyMode: "realtime",
    bitrate: big ? 6_000_000 : 4_000_000,
  } as const;
  const h264 = ["42e0", "4d00", "6400"].map(
    (profile) => `avc1.${profile}${big ? "28" : "1f"}`,
  );
  const tries: VideoEncoderConfig[] = (
    noHardware.has(id)
      ? (["prefer-software", "no-preference"] as const)
      : (["prefer-hardware", "no-preference"] as const)
  ).flatMap((hardwareAcceleration) =>
    h264.map((codec) => ({
      ...common,
      codec,
      hardwareAcceleration,
      avc: { format: "avc" as const },
    })),
  );
  for (const config of tries) {
    const { supported } = await VideoEncoder.isConfigSupported(config);
    if (!supported) continue;
    configs.set(id, config);
    return config;
  }
  return null;
}

// A copy of the encoder's bytes, which it may reuse
const copied = (bytes: AllowSharedBufferSource) =>
  ArrayBuffer.isView(bytes)
    ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength).slice()
    : new Uint8Array(bytes).slice();

const shut = (encoder: VideoEncoder | null) => {
  if (encoder && encoder.state !== "closed") encoder.close();
};

export type Capture = {
  stop: () => void;
  // Encodes the next frame as a keyframe, for a page that waits for one
  keyframe: () => void;
};

/**
 * Captures a camera main asked for and sends its frames as encoded video
 * chunks, until it's stopped. A failure, or the camera going away, is sent
 * as CAMERA_FAILED and tried again CAMERA_RETRY_MS later.
 */
export function startCapture(capture: CameraCapture): Capture {
  const { id } = capture;
  let stopped = false;
  let keyNow = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let stream: MediaStream | null = null;

  const run = async () => {
    let encoder: VideoEncoder | null = null;
    // The encoder failed: the capture ends as if its camera did
    let broken = false;
    try {
      stream = await openCamera(capture);
      if (stopped) return;
      const tracks = stream.getTracks();
      const [track] = stream.getVideoTracks();

      let lastKey = -Infinity;

      // Each encoder sends its chunks with its own config on keyframes
      const open = (config: VideoEncoderConfig) => {
        let sent: CameraConfig | undefined;
        // Until a keyframe goes out, a delta has nothing to build on
        let keyed = false;
        const made = new VideoEncoder({
          output: (chunk, metadata) => {
            if (stopped) return;
            const description = metadata?.decoderConfig?.description;
            if (description) {
              // The H.264 doesn't carry them: main puts them in the MP4
              const space = metadata?.decoderConfig?.colorSpace;
              sent = {
                codec: config.codec,
                width: config.width,
                height: config.height,
                description: copied(description),
                colors: space
                  ? {
                      primaries: space.primaries ?? null,
                      transfer: space.transfer ?? null,
                      matrix: space.matrix ?? null,
                      fullRange: space.fullRange ?? null,
                    }
                  : null,
              };
            }
            const key = chunk.type === "key";
            if (key && !sent) {
              // No page could play it: the next frame is a keyframe
              lastKey = -Infinity;
              return;
            }
            if (!key && !keyed) return;
            keyed = true;
            const frame = new Uint8Array(chunk.byteLength);
            chunk.copyTo(frame);
            window.api.emit(APP_EVENTS.CAMERA_FRAME, {
              id,
              key,
              timestamp: chunk.timestamp,
              frame,
              ...(key && sent && { config: sent }),
            });
          },
          error: () => {
            broken = true;
            const size = `${config.width}x${config.height}`;
            configs.delete(size);
            // A GPU that sent chunks before, as after a driver reset, gets
            // another go
            if (config.hardwareAcceleration === "prefer-hardware" && !sent) {
              noHardware.add(size);
            }
            // Ends the reader's stream
            tracks.forEach((t) => t.stop());
          },
        });
        made.configure(config);
        return made;
      };

      // Unlike requestVideoFrameCallback, it doesn't wait for paint, so it
      // runs while the window is hidden in the tray. It keeps only the
      // newest frame while one waits, so frames the encoder can't take are
      // dropped instead of falling behind.
      const reader = new MediaStreamTrackProcessor({
        track,
        maxBufferSize: 1,
      }).readable.getReader();
      let size = { width: 0, height: 0 };
      for (;;) {
        const { done, value: frame } = await reader.read();
        if (done) break;
        try {
          const width = frame.displayWidth & ~1;
          const height = frame.displayHeight & ~1;
          // The first frame, or the camera changed its format
          if (!encoder || width !== size.width || height !== size.height) {
            shut(encoder);
            encoder = null;
            const config = await configFor(width, height);
            if (stopped) return;
            if (!config) throw new Error("No encoder takes this camera");
            size = { width, height };
            encoder = open(config);
            lastKey = -Infinity;
          }
          if (encoder.encodeQueueSize > 2) continue;
          const keyFrame = keyNow || frame.timestamp - lastKey >= KEYFRAME_US;
          if (keyFrame) {
            lastKey = frame.timestamp;
            keyNow = false;
          }
          encoder.encode(frame, { keyFrame });
        } finally {
          frame.close();
        }
      }
      if (broken) throw new Error("The encoder failed");
      // The track ended: the camera was unplugged
      throw missing();
    } catch (e) {
      if (stopped) return;
      const reason = broken ? "failed" : mediaFailure(e);
      window.api.emit(APP_EVENTS.CAMERA_FAILED, { id, reason });
      retry = setTimeout(run, CAMERA_RETRY_MS);
    } finally {
      shut(encoder);
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
    }
  };

  void run();

  return {
    stop: () => {
      stopped = true;
      clearTimeout(retry);
      // Ends the track, which ends the reader's stream
      stream?.getTracks().forEach((t) => t.stop());
    },
    keyframe: () => {
      keyNow = true;
    },
  };
}
