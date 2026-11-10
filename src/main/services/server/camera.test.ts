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
  CAMERA_GOP_MAX_BYTES,
  CAMERA_GOP_MAX_MESSAGES,
  CAMERA_LINGER_MS,
  CameraFeeds,
} from "./camera";
import { initSegment } from "./mp4";

const H264: CameraConfig = {
  codec: "avc1.42e01f",
  width: 1280,
  height: 720,
  description: new Uint8Array([1, 0x42, 0xe0, 0x1f, 0xff, 0xe1, 0, 0]),
  colors: null,
};
const HD: CameraConfig = { ...H264, codec: "avc1.640028", height: 1080 };
const INITS = new Map([
  [initSegment(H264).toString("hex"), "H264"],
  [initSegment(HD).toString("hex"), "HD"],
]);

// Where fragment() puts a fragment's fields: the moof is 100 bytes
const SEQUENCE = 20;
const DECODE_TIME = 60;
const DURATION = 88;
const FLAGS = 96;
const MDAT = 108;

// A response that records what it was sent
class FakeResponse extends EventEmitter {
  writableNeedDrain = false;
  head: [number, Record<string, string>] | null = null;
  chunks: Buffer[] = [];
  ended = false;
  writeHead(status: number, headers: Record<string, string>) {
    this.head = [status, headers];
    return this;
  }
  write(chunk: Buffer) {
    this.chunks.push(chunk);
    return true;
  }
  end() {
    this.ended = true;
    this.emit("close");
    return this;
  }
  // What it got, as "init H264", "key K" or "delta A"
  messages() {
    return this.chunks.map((b) => {
      if (b.toString("latin1", 4, 8) === "ftyp") {
        return `init ${INITS.get(b.toString("hex"))}`;
      }
      const kind = b.readUInt32BE(FLAGS) === 0x02000000 ? "key" : "delta";
      return `${kind} ${b.subarray(MDAT).toString("latin1")}`;
    });
  }
  // Each fragment's sequence number, decode time and duration
  timing() {
    return this.chunks
      .filter((b) => b.toString("latin1", 4, 8) === "moof")
      .map((b) => [
        b.readUInt32BE(SEQUENCE),
        Number(b.readBigUInt64BE(DECODE_TIME)),
        b.readUInt32BE(DURATION),
      ]);
  }
}

// The fake stands in for Node's type
// oxlint-disable-next-line typescript/no-unsafe-type-assertion
const asResponse = (res: FakeResponse) => res as unknown as ServerResponse;

const DEFAULT = { device: "", label: "" };
const CAM = { device: "abc", label: "HD Webcam" };

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

  it("holds the headers until the camera's config, which names the codec", () => {
    const res = watch();
    expect(res.head).toBeNull();

    delta(0, "A");
    feeds.frame(chunk(1, "K", { key: true }));
    expect(res.head).toBeNull();
    expect(res.chunks).toEqual([]);

    key(2, "K");
    expect(res.head).toEqual([
      200,
      {
        "Content-Type": 'video/mp4; codecs="avc1.42e01f"',
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    ]);
    expect(res.messages()).toEqual(["init H264", "key K"]);
  });

  it("sends a fragment to its camera's pages only, one buffer for all", () => {
    const one = watch();
    const two = watch();
    const other = watch(CAM);

    key(0, "K");
    delta(1, "A");

    expect(one.messages()).toEqual(["init H264", "key K", "delta A"]);
    expect(two.messages()).toEqual(["init H264", "key K", "delta A"]);
    expect(one.chunks[1]).toBe(two.chunks[1]);
    expect(other.head).toBeNull();
    expect(other.chunks).toEqual([]);
  });

  it("numbers the fragments and times them from the chunks' timestamps", () => {
    const res = watch();

    key(1_000_000, "K");
    delta(1_033_333, "A");
    delta(1_033_333, "B");
    delta(3_000_000, "C");
    key(2_000_000, "K");

    expect(res.timing()).toEqual([
      // 1/30 s for the first, then 33.333 ms, 1 ms at least, 200 at most
      [1, 0, 3000],
      [2, 3000, 3000],
      [3, 6000, 90],
      [4, 6090, 18000],
      [5, 24090, 90],
    ]);
  });

  it("gives a new page the headers, the init and the GOP at once", () => {
    watch();
    key(0, "K1");
    delta(1, "A");
    key(2, "K2");
    delta(3, "B");
    delta(4, "C");

    const late = watch();

    expect(late.head?.[0]).toBe(200);
    expect(late.messages()).toEqual([
      "init H264",
      "key K2",
      "delta B",
      "delta C",
    ]);
    delta(5, "D");
    expect(late.messages().at(-1)).toBe("delta D");
  });

  it("keeps the GOP while the camera lingers with no page", () => {
    const res = watch();
    key(0, "K");
    res.emit("close");
    delta(1, "A");

    const again = watch();

    expect(again.messages()).toEqual(["init H264", "key K", "delta A"]);
  });

  it("ends the pages that started with a config that changes, so they reconnect", () => {
    const started = watch();
    key(0, "K1");
    const fresh = watch(DEFAULT, "1080p");
    // A copy of the same config changes nothing
    key(1, "K2", { ...H264, description: new Uint8Array(H264.description) });
    expect(started.ended).toBe(false);

    const third = watch(DEFAULT, "1080p");
    changed.mockClear();
    key(2, "K3", HD);

    expect(started.ended).toBe(true);
    expect(started.messages()).toEqual(["init H264", "key K1", "key K2"]);
    expect(fresh.ended).toBe(true);
    expect(third.ended).toBe(true);
    // The camera stays while its pages come back
    expect(qualities()).toEqual([["", "1080p"]]);
    expect(changed).not.toHaveBeenCalled();

    const back = watch();
    expect(back.head?.[1]["Content-Type"]).toBe(
      'video/mp4; codecs="avc1.640028"',
    );
    expect(back.messages()).toEqual(["init HD", "key K3"]);
  });

  it("starts a page still waiting for its headers with the new config", () => {
    const res = watch();
    feeds.frame(chunk(0, "K", { key: true }));

    key(1, "K", HD);

    expect(res.ended).toBe(false);
    expect(res.messages()).toEqual(["init HD", "key K"]);
  });

  it("ends a page whose only description changed", () => {
    const res = watch();
    key(0, "K1");

    key(1, "K2", { ...H264, description: new Uint8Array([1, 2, 3, 4]) });

    expect(res.ended).toBe(true);
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
    key(5, "K3");
    delta(6, "D");

    expect(slow.messages()).toEqual([
      "init H264",
      "key K1",
      "key K3",
      "delta D",
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
    expect(late.messages()).toEqual(["init H264"]);
    // The pages already following still get every delta
    expect(res.messages()).toHaveLength(CAMERA_GOP_MAX_MESSAGES + 3);

    key(1000, "K2");
    expect(late.messages()).toEqual(["init H264", "key K2"]);
  });

  it("caps the GOP's bytes too", () => {
    watch();
    key(0, "K");
    delta(1, "x".repeat(CAMERA_GOP_MAX_BYTES));

    expect(watch().messages()).toEqual(["init H264"]);
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
    expect(again.messages()).toEqual(["init H264", "key K"]);
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
    expect(again.head).toBeNull();
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
