import { APP_EVENTS, CameraCapture } from "@/common/types";
import { sent } from "@test/ipc";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  MockInstance,
  vi,
} from "vitest";

// Imported again for each test, so its cache of configs starts empty
let camera: typeof import("./camera");
const RETRY_MS = 5000;

const capture = (patch: Partial<CameraCapture> = {}): CameraCapture => ({
  id: "cam-1",
  device: "",
  label: "",
  quality: "720p",
  ...patch,
});

const device = (deviceId: string, label: string) =>
  ({
    kind: "videoinput",
    deviceId,
    label,
    groupId: "",
    toJSON: () => ({}),
  }) satisfies MediaDeviceInfo;

type Read = ReadableStreamReadResult<VideoFrame>;

// A camera's stream, whose frames a test pushes, and which ends once its
// track stops
function webcam() {
  const waiting: ((read: Read) => void)[] = [];
  const queued: Read[] = [];
  const push = (read: Read) => {
    const next = waiting.shift();
    if (next) next(read);
    else queued.push(read);
  };
  const track = { stop: vi.fn(() => push({ done: true, value: undefined })) };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a fake
  const stream = {
    getVideoTracks: () => [track],
    getTracks: () => [track],
  } as unknown as MediaStream;
  const read = () =>
    queued.length > 0
      ? Promise.resolve(queued.shift()!)
      : new Promise<Read>((resolve) => waiting.push(resolve));
  const frame = (timestamp = 0, width = 1280, height = 720) => {
    const close = vi.fn();
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a fake
    const f = {
      displayWidth: width,
      displayHeight: height,
      timestamp,
      close,
    } as unknown as VideoFrame;
    push({ done: false, value: f });
    return { f, close };
  };
  return {
    stream,
    track,
    read,
    frame,
    end: () => push({ done: true, value: undefined }),
  };
}

// What the fake encoders were made with, and what they were given
class FakeEncoder {
  static made: FakeEncoder[] = [];
  static supports: (config: VideoEncoderConfig) => boolean = () => true;
  static isConfigSupported = vi.fn(async (config: VideoEncoderConfig) => ({
    supported: FakeEncoder.supports(config),
    config,
  }));
  state = "unconfigured";
  encodeQueueSize = 0;
  config: VideoEncoderConfig | undefined;
  encode = vi.fn<(frame: VideoFrame, options: { keyFrame: boolean }) => void>();
  close = vi.fn(() => {
    this.state = "closed";
  });
  constructor(public init: VideoEncoderInit) {
    FakeEncoder.made.push(this);
  }
  configure(config: VideoEncoderConfig) {
    this.config = config;
    this.state = "configured";
  }
  // The encoder's output of one chunk, with its description if it gives
  // one
  out(
    type: "key" | "delta",
    timestamp: number,
    bytes: number[],
    description?: AllowSharedBufferSource,
  ) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a fake
    const chunk = {
      type,
      timestamp,
      byteLength: bytes.length,
      copyTo: (to: Uint8Array) => to.set(bytes),
    } as unknown as EncodedVideoChunk;
    this.init.output(
      chunk,
      description ? { decoderConfig: { codec: "", description } } : {},
    );
  }
}

const keyFrames = (encoder: FakeEncoder) =>
  encoder.encode.mock.calls.map(([, options]) => options.keyFrame);

let source: ReturnType<typeof webcam>;
let gum: MockInstance<MediaDevices["getUserMedia"]>;
const listed = (...devices: MediaDeviceInfo[]) =>
  vi
    .spyOn(navigator.mediaDevices, "enumerateDevices")
    .mockResolvedValue(devices);

const start = async (c = capture()) => {
  const stop = camera.startCapture(c);
  await vi.advanceTimersByTimeAsync(0);
  return stop;
};

// Pushes a frame and lets the capture take it
const push = async (...args: Parameters<typeof source.frame>) => {
  const frame = source.frame(...args);
  await vi.advanceTimersByTimeAsync(0);
  return frame;
};

describe("startCapture", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    camera = await import("./camera");
    source = webcam();
    gum = vi
      .spyOn(navigator.mediaDevices, "getUserMedia")
      .mockResolvedValue(source.stream);
    vi.stubGlobal(
      "MediaStreamTrackProcessor",
      class {
        readable = { getReader: () => ({ read: source.read }) };
      },
    );
    FakeEncoder.made = [];
    FakeEncoder.supports = () => true;
    FakeEncoder.isConfigSupported.mockClear();
    vi.stubGlobal("VideoEncoder", FakeEncoder);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("waits as long to try again as main expects", () => {
    expect(camera.CAMERA_RETRY_MS).toBe(RETRY_MS);
  });

  it("opens the default camera at 720p and sends its chunks, the config on keyframes", async () => {
    const stop = await start();

    expect(gum).toHaveBeenCalledWith({
      audio: false,
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 },
      },
    });
    const first = await push(0);
    const second = await push(33_333);

    const [encoder] = FakeEncoder.made;
    expect(encoder.config).toEqual({
      width: 1280,
      height: 720,
      framerate: 30,
      latencyMode: "realtime",
      bitrate: 4_000_000,
      codec: "avc1.42e01f",
      hardwareAcceleration: "prefer-hardware",
      avc: { format: "avc" },
    });
    expect(encoder.encode).toHaveBeenCalledWith(first.f, { keyFrame: true });
    expect(encoder.encode).toHaveBeenCalledWith(second.f, { keyFrame: false });
    expect(first.close).toHaveBeenCalled();
    expect(second.close).toHaveBeenCalled();

    // A view into a buffer the encoder reuses
    const record = new Uint8Array([0, 1, 0x64, 0, 0x1f, 0]);
    encoder.out("key", 0, [1, 2], new DataView(record.buffer, 1, 4));
    record.fill(0);
    encoder.out("delta", 33_333, [3]);
    expect(sent(APP_EVENTS.CAMERA_FRAME)).toEqual([
      {
        id: "cam-1",
        key: true,
        timestamp: 0,
        frame: new Uint8Array([1, 2]),
        config: {
          codec: "avc1.42e01f",
          width: 1280,
          height: 720,
          description: new Uint8Array([1, 0x64, 0, 0x1f]),
        },
      },
      {
        id: "cam-1",
        key: false,
        timestamp: 33_333,
        frame: new Uint8Array([3]),
      },
    ]);
    // Asked once: the config is kept
    expect(FakeEncoder.isConfigSupported).toHaveBeenCalledTimes(1);
    stop();
  });

  it("tries H.264's profiles in hardware, then in any", async () => {
    FakeEncoder.supports = (config) =>
      config.codec === "avc1.640028" &&
      config.hardwareAcceleration === "no-preference";
    const stop = await start(capture({ quality: "1080p" }));
    await push(0, 1920, 1080);

    expect(
      FakeEncoder.isConfigSupported.mock.calls.map(([c]) => [
        c.codec,
        c.hardwareAcceleration,
      ]),
    ).toEqual([
      ["avc1.42e028", "prefer-hardware"],
      ["avc1.4d0028", "prefer-hardware"],
      ["avc1.640028", "prefer-hardware"],
      ["avc1.42e028", "no-preference"],
      ["avc1.4d0028", "no-preference"],
      ["avc1.640028", "no-preference"],
    ]);
    expect(FakeEncoder.made[0].config).toEqual({
      width: 1920,
      height: 1080,
      framerate: 30,
      latencyMode: "realtime",
      bitrate: 6_000_000,
      codec: "avc1.640028",
      hardwareAcceleration: "no-preference",
      avc: { format: "avc" },
    });
    stop();
  });

  it("fails when no config is supported, and tries again later", async () => {
    FakeEncoder.supports = () => false;
    const stop = await start();
    const frame = await push(0);

    expect(FakeEncoder.made).toHaveLength(0);
    expect(frame.close).toHaveBeenCalled();
    expect(sent(APP_EVENTS.CAMERA_FAILED)).toEqual([
      { id: "cam-1", reason: "failed" },
    ]);
    expect(source.track.stop).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(gum).toHaveBeenCalledTimes(2);
    stop();
  });

  it("sends no keyframe before a description, and makes the next frame one", async () => {
    const stop = await start();
    await push(0);
    const [encoder] = FakeEncoder.made;

    encoder.out("key", 0, [1]);
    encoder.out("delta", 33_333, [2]);
    expect(sent(APP_EVENTS.CAMERA_FRAME)).toEqual([]);

    await push(66_666);
    expect(keyFrames(encoder)).toEqual([true, true]);
    encoder.out("key", 66_666, [3], new Uint8Array([7]).buffer);
    encoder.out("delta", 99_999, [4]);
    expect(
      sent(APP_EVENTS.CAMERA_FRAME).map((c) => [c?.timestamp, c?.config]),
    ).toEqual([
      [
        66_666,
        {
          codec: "avc1.42e01f",
          width: 1280,
          height: 720,
          description: new Uint8Array([7]),
        },
      ],
      [99_999, undefined],
    ]);
    stop();
  });

  it("asks for a keyframe first, then every 2 seconds", async () => {
    const stop = await start();
    for (const t of [0, 33_333, 1_999_999, 2_000_000, 3_999_999, 4_000_000]) {
      await push(t);
    }

    expect(keyFrames(FakeEncoder.made[0])).toEqual([
      true,
      false,
      false,
      true,
      false,
      true,
    ]);
    stop();
  });

  it("drops frames while the encoder is behind", async () => {
    const stop = await start();
    await push(0);
    const [encoder] = FakeEncoder.made;

    encoder.encodeQueueSize = 3;
    const dropped = await push(33_333);
    expect(encoder.encode).toHaveBeenCalledTimes(1);
    expect(dropped.close).toHaveBeenCalled();

    encoder.encodeQueueSize = 2;
    await push(66_666);
    expect(encoder.encode).toHaveBeenCalledTimes(2);
    stop();
  });

  it("starts a new encoder, from a keyframe, when the frames change size", async () => {
    const stop = await start();
    await push(0);
    await push(33_333);
    // Rounded down to even
    await push(66_666, 641, 361);

    const [old, next] = FakeEncoder.made;
    expect(old.close).toHaveBeenCalled();
    expect(next.config).toMatchObject({ width: 640, height: 360 });
    expect(keyFrames(next)).toEqual([true]);

    next.out("key", 66_666, [9], new Uint8Array([8]));
    expect(sent(APP_EVENTS.CAMERA_FRAME)).toEqual([
      expect.objectContaining({
        config: {
          codec: "avc1.42e01f",
          width: 640,
          height: 360,
          description: new Uint8Array([8]),
        },
      }),
    ]);
    stop();
  });

  it("ends the capture when the encoder fails, and tries again later", async () => {
    const stop = await start();
    await push(0);
    const [encoder] = FakeEncoder.made;

    encoder.init.error(new DOMException("", "EncodingError"));
    await vi.advanceTimersByTimeAsync(0);

    expect(sent(APP_EVENTS.CAMERA_FAILED)).toEqual([
      { id: "cam-1", reason: "failed" },
    ]);
    expect(source.track.stop).toHaveBeenCalled();
    expect(encoder.close).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(gum).toHaveBeenCalledTimes(2);
    stop();
  });

  it("finds a camera by its id, else by its name, at 1080p", async () => {
    listed(device("other", "Other"), device("id-2", "Studio Cam"));
    const stop = await start(
      capture({ device: "id-1", label: "Studio Cam", quality: "1080p" }),
    );

    expect(gum).toHaveBeenCalledWith({
      audio: false,
      video: {
        deviceId: { exact: "id-2" },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        frameRate: { ideal: 30, max: 30 },
      },
    });
    stop();
    gum.mockClear();

    const again = await start(
      capture({ device: "other", label: "Studio Cam" }),
    );
    expect(gum).toHaveBeenCalledWith(
      expect.objectContaining({
        video: expect.objectContaining({ deviceId: { exact: "other" } }),
      }),
    );
    again();
  });

  it("says a camera that isn't listed is missing, and tries again later", async () => {
    const enumerate = listed(device("other", "Other"));
    const stop = await start(capture({ device: "id-1", label: "Studio Cam" }));

    expect(gum).not.toHaveBeenCalled();
    expect(sent(APP_EVENTS.CAMERA_FAILED)).toEqual([
      { id: "cam-1", reason: "missing" },
    ]);

    enumerate.mockResolvedValue([device("id-1", "Studio Cam")]);
    await vi.advanceTimersByTimeAsync(RETRY_MS - 1);
    expect(gum).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(gum).toHaveBeenCalledTimes(1);
    stop();
  });

  it.each([
    ["NotAllowedError", "blocked"],
    ["SecurityError", "blocked"],
    ["NotFoundError", "missing"],
    ["OverconstrainedError", "missing"],
    ["NotReadableError", "busy"],
    ["AbortError", "busy"],
    ["TypeError", "failed"],
  ])("sends a %s as %s", async (name, reason) => {
    gum.mockRejectedValue(new DOMException("", name));
    const stop = await start();

    expect(sent(APP_EVENTS.CAMERA_FAILED)).toEqual([{ id: "cam-1", reason }]);
    stop();
  });

  it("says the camera went missing when its track ends, and stops it", async () => {
    const stop = await start();

    source.end();
    await vi.advanceTimersByTimeAsync(0);

    expect(sent(APP_EVENTS.CAMERA_FAILED)).toEqual([
      { id: "cam-1", reason: "missing" },
    ]);
    expect(source.track.stop).toHaveBeenCalled();
    // Opened again
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    expect(gum).toHaveBeenCalledTimes(2);
    stop();
  });

  it("stops the camera and sends nothing after it's stopped", async () => {
    const stop = await start();
    await push(0);
    const [encoder] = FakeEncoder.made;

    source.frame(33_333);
    stop();
    await vi.advanceTimersByTimeAsync(RETRY_MS * 2);
    // A chunk the encoder still had
    encoder.out("key", 0, [1], new Uint8Array([1]));

    expect(source.track.stop).toHaveBeenCalled();
    expect(encoder.close).toHaveBeenCalled();
    expect(sent(APP_EVENTS.CAMERA_FRAME)).toEqual([]);
    expect(sent(APP_EVENTS.CAMERA_FAILED)).toEqual([]);
    expect(gum).toHaveBeenCalledTimes(1);
  });

  it("stops a camera that opens after it was stopped", async () => {
    let open!: (stream: MediaStream) => void;
    gum.mockReturnValue(new Promise((resolve) => (open = resolve)));
    const stop = await start();

    stop();
    open(source.stream);
    await vi.advanceTimersByTimeAsync(0);

    expect(source.track.stop).toHaveBeenCalled();
    expect(FakeEncoder.made).toHaveLength(0);
  });

  it("stops retrying once stopped", async () => {
    gum.mockRejectedValue(new DOMException("", "NotReadableError"));
    const stop = await start();

    stop();
    await vi.advanceTimersByTimeAsync(RETRY_MS * 3);

    expect(gum).toHaveBeenCalledTimes(1);
    expect(sent(APP_EVENTS.CAMERA_FAILED)).toHaveLength(1);
  });
});
