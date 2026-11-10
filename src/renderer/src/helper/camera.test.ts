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
import { CAMERA_RETRY_MS, startCapture } from "./camera";

const JPEG = [0xff, 0xd8, 0xff, 0xd9];

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
function camera() {
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
  const frame = (width = 1280, height = 720) => {
    const close = vi.fn();
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a fake
    const f = {
      displayWidth: width,
      displayHeight: height,
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

let source: ReturnType<typeof camera>;
let canvases: { width: number; height: number }[];
const drawn = vi.fn();

let gum: MockInstance<MediaDevices["getUserMedia"]>;
const listed = (...devices: MediaDeviceInfo[]) =>
  vi
    .spyOn(navigator.mediaDevices, "enumerateDevices")
    .mockResolvedValue(devices);

describe("startCapture", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    source = camera();
    canvases = [];
    drawn.mockReset();
    gum = vi
      .spyOn(navigator.mediaDevices, "getUserMedia")
      .mockResolvedValue(source.stream);
    vi.stubGlobal(
      "MediaStreamTrackProcessor",
      class {
        readable = { getReader: () => ({ read: source.read }) };
      },
    );
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(
          public width: number,
          public height: number,
        ) {
          canvases.push(this);
        }
        getContext() {
          return { drawImage: drawn };
        }
        async convertToBlob() {
          return { arrayBuffer: async () => new Uint8Array(JPEG).buffer };
        }
      },
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the default camera at 720p and sends each frame as a JPEG", async () => {
    const stop = startCapture(capture());
    await vi.advanceTimersByTimeAsync(0);

    expect(gum).toHaveBeenCalledWith({
      audio: false,
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 30 },
      },
    });
    const first = source.frame(1280, 720);
    await vi.advanceTimersByTimeAsync(0);
    const second = source.frame(640, 360);
    await vi.advanceTimersByTimeAsync(0);

    expect(sent(APP_EVENTS.CAMERA_FRAME)).toEqual([
      { id: "cam-1", key: true, timestamp: 0, frame: new Uint8Array(JPEG) },
      { id: "cam-1", key: true, timestamp: 0, frame: new Uint8Array(JPEG) },
    ]);
    expect(drawn).toHaveBeenCalledWith(first.f, 0, 0);
    expect(drawn).toHaveBeenCalledWith(second.f, 0, 0);
    expect(first.close).toHaveBeenCalled();
    expect(second.close).toHaveBeenCalled();
    // One canvas, sized to the latest frame
    expect(canvases).toHaveLength(1);
    expect(canvases[0]).toMatchObject({ width: 640, height: 360 });
    stop();
  });

  it("finds a camera by its id, else by its name, at 1080p", async () => {
    listed(device("other", "Other"), device("id-2", "Studio Cam"));
    const stop = startCapture(
      capture({ device: "id-1", label: "Studio Cam", quality: "1080p" }),
    );
    await vi.advanceTimersByTimeAsync(0);

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

    const again = startCapture(
      capture({ device: "other", label: "Studio Cam" }),
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(gum).toHaveBeenCalledWith(
      expect.objectContaining({
        video: expect.objectContaining({ deviceId: { exact: "other" } }),
      }),
    );
    again();
  });

  it("says a camera that isn't listed is missing, and tries again later", async () => {
    const enumerate = listed(device("other", "Other"));
    const stop = startCapture(capture({ device: "id-1", label: "Studio Cam" }));
    await vi.advanceTimersByTimeAsync(0);

    expect(gum).not.toHaveBeenCalled();
    expect(sent(APP_EVENTS.CAMERA_FAILED)).toEqual([
      { id: "cam-1", reason: "missing" },
    ]);

    enumerate.mockResolvedValue([device("id-1", "Studio Cam")]);
    await vi.advanceTimersByTimeAsync(CAMERA_RETRY_MS - 1);
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
    const stop = startCapture(capture());
    await vi.advanceTimersByTimeAsync(0);

    expect(sent(APP_EVENTS.CAMERA_FAILED)).toEqual([{ id: "cam-1", reason }]);
    stop();
  });

  it("says the camera went missing when its track ends, and stops it", async () => {
    const stop = startCapture(capture());
    await vi.advanceTimersByTimeAsync(0);

    source.end();
    await vi.advanceTimersByTimeAsync(0);

    expect(sent(APP_EVENTS.CAMERA_FAILED)).toEqual([
      { id: "cam-1", reason: "missing" },
    ]);
    expect(source.track.stop).toHaveBeenCalled();
    // Opened again
    await vi.advanceTimersByTimeAsync(CAMERA_RETRY_MS);
    expect(gum).toHaveBeenCalledTimes(2);
    stop();
  });

  it("stops the camera and sends nothing after it's stopped", async () => {
    const stop = startCapture(capture());
    await vi.advanceTimersByTimeAsync(0);

    source.frame();
    stop();
    await vi.advanceTimersByTimeAsync(CAMERA_RETRY_MS * 2);

    expect(source.track.stop).toHaveBeenCalled();
    expect(sent(APP_EVENTS.CAMERA_FRAME)).toEqual([]);
    expect(sent(APP_EVENTS.CAMERA_FAILED)).toEqual([]);
    expect(gum).toHaveBeenCalledTimes(1);
  });

  it("stops a camera that opens after it was stopped", async () => {
    let open!: (stream: MediaStream) => void;
    gum.mockReturnValue(new Promise((resolve) => (open = resolve)));
    const stop = startCapture(capture());
    await vi.advanceTimersByTimeAsync(0);

    stop();
    open(source.stream);
    await vi.advanceTimersByTimeAsync(0);

    expect(source.track.stop).toHaveBeenCalled();
    expect(canvases).toHaveLength(0);
  });

  it("stops retrying once stopped", async () => {
    gum.mockRejectedValue(new DOMException("", "NotReadableError"));
    const stop = startCapture(capture());
    await vi.advanceTimersByTimeAsync(0);

    stop();
    await vi.advanceTimersByTimeAsync(CAMERA_RETRY_MS * 3);

    expect(gum).toHaveBeenCalledTimes(1);
    expect(sent(APP_EVENTS.CAMERA_FAILED)).toHaveLength(1);
  });
});
