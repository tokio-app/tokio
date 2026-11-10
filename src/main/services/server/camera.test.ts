import type { StudioCameraQuality } from "@/common/schemas";
import type { CameraChunk, CameraConfig } from "@/common/types";
import { EventEmitter } from "node:events";
import type { ServerResponse } from "node:http";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type Mock,
  vi,
} from "vitest";
import {
  CAMERA_CONFIG,
  CAMERA_DELTA,
  CAMERA_GOP_MAX_BYTES,
  CAMERA_GOP_MAX_MESSAGES,
  CAMERA_KEYFRAME,
  CAMERA_LINGER_MS,
  CameraFeeds,
} from "./camera";

// A response that records what it was sent
class FakeResponse extends EventEmitter {
  writableNeedDrain = false;
  head: [number, Record<string, string>] | null = null;
  chunks: Uint8Array[] = [];
  ended = false;
  writeHead(status: number, headers: Record<string, string>) {
    this.head = [status, headers];
    return this;
  }
  flushHeaders() {}
  write(chunk: Uint8Array) {
    this.chunks.push(chunk);
    return true;
  }
  end() {
    this.ended = true;
    this.emit("close");
    return this;
  }
  // What it got, as config objects and "key 1 A" / "delta 2 B" lines
  messages() {
    const bytes = Buffer.concat(this.chunks);
    const got: (CameraConfig | string)[] = [];
    for (let at = 0; at < bytes.length;) {
      const type = bytes[at];
      const size = bytes.readUInt32BE(at + 1);
      const payload = bytes.subarray(at + 5, at + 5 + size);
      at += 5 + size;
      if (type === CAMERA_CONFIG) {
        got.push(JSON.parse(payload.toString("utf8")));
        continue;
      }
      const kind = type === CAMERA_KEYFRAME ? "key" : "delta";
      expect([CAMERA_KEYFRAME, CAMERA_DELTA]).toContain(type);
      got.push(
        `${kind} ${payload.readDoubleBE(0)} ${payload.subarray(8).toString("latin1")}`,
      );
    }
    return got;
  }
}

// The fake stands in for Node's type
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const asResponse = (res: FakeResponse) => res as unknown as ServerResponse;

const DEFAULT = { device: "", label: "" };
const CAM = { device: "abc", label: "HD Webcam" };
const H264 = { codec: "avc1.42001f", width: 1280, height: 720 };

describe("CameraFeeds", () => {
  let feeds: CameraFeeds;
  let changed: Mock<() => void>;

  const watch = (camera = DEFAULT, quality: StudioCameraQuality = "720p") => {
    const res = new FakeResponse();
    feeds.watch(asResponse(res), camera, quality);
    return res;
  };
  const qualities = () =>
    feeds.captures().map((c) => [c.label, c.quality] as const);
  const idOf = (label = "") =>
    feeds.captures().find((c) => c.label === label)!.id;
  const chunk = (
    timestamp: number,
    frame: string,
    patch: Partial<CameraChunk> = {},
  ): CameraChunk => ({
    id: idOf(),
    key: false,
    timestamp,
    frame: Buffer.from(frame, "latin1"),
    ...patch,
  });
  const key = (timestamp: number, frame: string, config = H264) =>
    feeds.frame(chunk(timestamp, frame, { key: true, config }));
  const delta = (timestamp: number, frame: string) =>
    feeds.frame(chunk(timestamp, frame));

  beforeEach(() => {
    vi.useFakeTimers();
    feeds = new CameraFeeds();
    changed = vi.fn<() => void>();
    feeds.onChange(changed);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts a binary stream that sends nothing before a keyframe", () => {
    const res = watch();

    expect(res.head).toEqual([
      200,
      {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Access-Control-Allow-Origin": "*",
      },
    ]);
    expect(res.chunks).toEqual([]);
  });

  it("frames each message as a type, a big-endian length and the payload", () => {
    const res = watch();

    key(33_333.5, "KEY");
    delta(66_667, "D");

    const config = Buffer.from(JSON.stringify(H264));
    const time = (us: number) => {
      const b = Buffer.alloc(8);
      b.writeDoubleBE(us);
      return b;
    };
    expect(Buffer.concat(res.chunks)).toEqual(
      Buffer.concat([
        Buffer.from([1, 0, 0, 0, config.length]),
        config,
        Buffer.from([2, 0, 0, 0, 11]),
        time(33_333.5),
        Buffer.from("KEY"),
        Buffer.from([3, 0, 0, 0, 9]),
        time(66_667),
        Buffer.from("D"),
      ]),
    );
    // Each message goes in one write
    expect(res.chunks).toHaveLength(3);
  });

  it("sends a chunk to its camera's pages only, one buffer for all", () => {
    const one = watch();
    const two = watch();
    const other = watch(CAM);

    key(0, "K");

    expect(one.messages()).toEqual([H264, "key 0 K"]);
    expect(two.messages()).toEqual([H264, "key 0 K"]);
    expect(other.chunks).toEqual([]);
    expect(one.chunks[1]).toBe(two.chunks[1]);
  });

  it("drops deltas before the first keyframe, and keyframes before a config", () => {
    const res = watch();

    delta(0, "A");
    feeds.frame(chunk(1, "K", { key: true }));
    delta(2, "B");
    key(3, "K");

    expect(res.messages()).toEqual([H264, "key 3 K"]);
  });

  it("gives a new page the config and the GOP at once", () => {
    watch();
    key(0, "K1");
    delta(1, "A");
    key(2, "K2");
    delta(3, "B");
    delta(4, "C");

    const late = watch();

    expect(late.messages()).toEqual([
      H264,
      "key 2 K2",
      "delta 3 B",
      "delta 4 C",
    ]);
    delta(5, "D");
    expect(late.messages().at(-1)).toBe("delta 5 D");
  });

  it("keeps the GOP while the camera lingers with no page", () => {
    const res = watch();
    key(0, "K");
    res.emit("close");
    delta(1, "A");

    const again = watch();

    expect(again.messages()).toEqual([H264, "key 0 K", "delta 1 A"]);
  });

  it("sends a changed config before its keyframe, and the same one once", () => {
    const res = watch();
    const hd = { ...H264, width: 1920, height: 1080 };

    key(0, "K1");
    key(1, "K2");
    key(2, "K3", hd);
    key(3, "K4", { ...hd, codec: "avc1.640028" });

    expect(res.messages()).toEqual([
      H264,
      "key 0 K1",
      "key 1 K2",
      hd,
      "key 2 K3",
      { ...hd, codec: "avc1.640028" },
      "key 3 K4",
    ]);
    expect(watch().messages()).toEqual([
      { ...hd, codec: "avc1.640028" },
      "key 3 K4",
    ]);
  });

  it("keeps a page that can't keep up waiting for the next keyframe", () => {
    const slow = watch();
    key(0, "K1");

    slow.writableNeedDrain = true;
    delta(1, "A");
    slow.writableNeedDrain = false;
    delta(2, "B");
    slow.writableNeedDrain = true;
    key(3, "K2");
    slow.writableNeedDrain = false;
    delta(4, "C");
    key(5, "K3", { ...H264, width: 640, height: 360 });
    delta(6, "D");

    expect(slow.messages()).toEqual([
      H264,
      "key 0 K1",
      { ...H264, width: 640, height: 360 },
      "key 5 K3",
      "delta 6 D",
    ]);
  });

  it("makes new pages wait for a keyframe once the GOP outgrows its cap", () => {
    const res = watch();
    key(0, "K");
    for (let i = 1; i < CAMERA_GOP_MAX_MESSAGES; i++) delta(i, "d");

    expect(watch().messages()).toHaveLength(CAMERA_GOP_MAX_MESSAGES + 1);
    delta(CAMERA_GOP_MAX_MESSAGES, "d");
    const late = watch();
    delta(CAMERA_GOP_MAX_MESSAGES + 1, "d");
    expect(late.chunks).toEqual([]);
    // The pages already following still get every delta
    expect(res.messages()).toHaveLength(CAMERA_GOP_MAX_MESSAGES + 3);

    key(1000, "K2");
    expect(late.messages()).toEqual([H264, "key 1000 K2"]);
  });

  it("caps the GOP's bytes too", () => {
    watch();
    key(0, "K");
    delta(1, "x".repeat(CAMERA_GOP_MAX_BYTES));

    expect(watch().chunks).toEqual([]);
  });

  it("ignores chunks for a capture it doesn't hold", () => {
    const res = watch();
    feeds.frame({ ...chunk(0, "K", { key: true, config: H264 }), id: "99" });
    expect(res.chunks).toEqual([]);
  });

  it("captures each camera once, at the largest quality its pages ask for", () => {
    watch(DEFAULT, "1080p");
    watch(DEFAULT, "720p");
    watch(CAM, "720p");

    expect(qualities()).toEqual([
      ["", "1080p"],
      ["HD Webcam", "720p"],
    ]);
    expect(feeds.captures()[0]).toMatchObject({ device: "", label: "" });
    expect(feeds.captures()[1]).toMatchObject({ device: "abc" });
    // The second page asked for less, which changed nothing
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("takes a higher quality at once", () => {
    watch(DEFAULT, "720p");
    watch(DEFAULT, "1080p");

    expect(qualities()).toEqual([["", "1080p"]]);
    expect(changed).toHaveBeenCalledTimes(2);
  });

  it("drops a camera no page shows only after the linger", () => {
    const res = watch();
    changed.mockClear();

    res.emit("close");
    vi.advanceTimersByTime(CAMERA_LINGER_MS - 1);
    expect(qualities()).toEqual([["", "720p"]]);
    expect(changed).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(feeds.captures()).toEqual([]);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("lowers the quality only after the linger", () => {
    const high = watch(DEFAULT, "1080p");
    watch(DEFAULT, "720p");
    changed.mockClear();

    high.emit("close");
    expect(qualities()).toEqual([["", "1080p"]]);
    vi.advanceTimersByTime(CAMERA_LINGER_MS);

    expect(qualities()).toEqual([["", "720p"]]);
    expect(changed).toHaveBeenCalledTimes(1);
  });

  it("keeps a camera and its id when a page shows it again during the linger", () => {
    const res = watch();
    const id = idOf();
    changed.mockClear();

    res.emit("close");
    vi.advanceTimersByTime(CAMERA_LINGER_MS - 1000);
    const again = watch();
    vi.advanceTimersByTime(CAMERA_LINGER_MS);

    expect(feeds.captures()).toEqual([
      { id, device: "", label: "", quality: "720p" },
    ]);
    expect(changed).not.toHaveBeenCalled();
    key(0, "K");
    expect(again.messages()).toEqual([H264, "key 0 K"]);
  });

  it("waits the linger from the last page that closed", () => {
    const one = watch();
    const two = watch();

    one.emit("close");
    vi.advanceTimersByTime(3000);
    two.emit("close");
    vi.advanceTimersByTime(3000);
    expect(feeds.captures()).toHaveLength(1);

    vi.advanceTimersByTime(2000);
    expect(feeds.captures()).toEqual([]);
  });

  it("drops a response that errors, without throwing", () => {
    const res = watch();

    expect(() => res.emit("error", new Error("EPIPE"))).not.toThrow();
    key(0, "K");
    expect(res.chunks).toEqual([]);
  });

  it("gives a camera that comes back after the linger a new id, and no GOP", () => {
    const res = watch();
    const id = idOf();
    key(0, "K");
    res.emit("close");
    vi.advanceTimersByTime(CAMERA_LINGER_MS);

    const again = watch();

    expect(idOf()).not.toBe(id);
    expect(again.chunks).toEqual([]);
  });

  it("ends every stream and drops every capture at once", () => {
    const one = watch();
    const two = watch(CAM, "1080p");
    changed.mockClear();

    feeds.closeAll();

    expect([one.ended, two.ended]).toEqual([true, true]);
    expect(feeds.captures()).toEqual([]);
    expect(changed).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(CAMERA_LINGER_MS);
    expect(changed).toHaveBeenCalledTimes(1);
  });
});
