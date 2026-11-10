import { StudioCameraQuality } from "@/common/schemas";
import { APP_EVENTS, CameraCapture, CameraFailure } from "@/common/types";

// How long a failed capture waits before it tries again
export const CAMERA_RETRY_MS = 5000;

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

/**
 * Captures a camera main asked for and sends its frames as JPEGs, until the
 * returned function stops it. A failure, or the camera going away, is sent
 * as CAMERA_FAILED and tried again CAMERA_RETRY_MS later.
 */
export function startCapture(capture: CameraCapture): () => void {
  const { id } = capture;
  let stopped = false;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let stream: MediaStream | null = null;

  const run = async () => {
    try {
      const deviceId = await deviceOf(capture);
      if (stopped) return;
      const { width, height } = SIZES[capture.quality];
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          ...(deviceId !== undefined && { deviceId: { exact: deviceId } }),
          width: { ideal: width },
          height: { ideal: height },
          frameRate: { ideal: 30, max: 30 },
        },
      });
      if (stopped) return;
      const [track] = stream.getVideoTracks();
      // Unlike requestVideoFrameCallback, it doesn't wait for paint, so it
      // runs while the window is hidden in the tray
      const reader = new MediaStreamTrackProcessor({
        track,
      }).readable.getReader();
      const canvas = new OffscreenCanvas(1, 1);
      const context = canvas.getContext("2d")!;
      // shortcut: the encode runs on the window's thread; move it to a worker
      // (transfer processor.readable) if the UI stutters at 1080p or with
      // several cameras
      for (;;) {
        const { done, value: frame } = await reader.read();
        if (done) break;
        try {
          if (
            canvas.width !== frame.displayWidth ||
            canvas.height !== frame.displayHeight
          ) {
            canvas.width = frame.displayWidth;
            canvas.height = frame.displayHeight;
          }
          context.drawImage(frame, 0, 0);
        } finally {
          frame.close();
        }
        const blob = await canvas.convertToBlob({
          type: "image/jpeg",
          quality: 0.8,
        });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        if (stopped) return;
        window.api.emit(APP_EVENTS.CAMERA_FRAME, { id, frame: bytes });
      }
      // The track ended: the camera was unplugged
      throw missing();
    } catch (e) {
      if (stopped) return;
      const name =
        typeof e === "object" && e !== null && "name" in e ? e.name : null;
      const reason = REASONS.get(name) ?? "failed";
      window.api.emit(APP_EVENTS.CAMERA_FAILED, { id, reason });
      retry = setTimeout(run, CAMERA_RETRY_MS);
    } finally {
      stream?.getTracks().forEach((t) => t.stop());
      stream = null;
    }
  };

  void run();

  return () => {
    stopped = true;
    clearTimeout(retry);
    // Ends the track, which ends the reader's stream
    stream?.getTracks().forEach((t) => t.stop());
  };
}
