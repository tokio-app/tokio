import type { StudioCameraQuality } from "@/common/schemas";
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
import { CAMERA_LINGER_MS, CameraFeeds } from "./camera";

const PART = "--tokio-camera-frame\r\nContent-Type: image/jpeg\r\n\r\n";

// A response that records what it was sent
class FakeResponse extends EventEmitter {
  writableNeedDrain = false;
  head: [number, Record<string, string>] | null = null;
  chunks: string[] = [];
  ended = false;
  writeHead(status: number, headers: Record<string, string>) {
    this.head = [status, headers];
    return this;
  }
  write(chunk: string | Uint8Array) {
    this.chunks.push(Buffer.from(chunk).toString("latin1"));
    return true;
  }
  end() {
    this.ended = true;
    this.emit("close");
    return this;
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

  beforeEach(() => {
    vi.useFakeTimers();
    feeds = new CameraFeeds();
    changed = vi.fn<() => void>();
    feeds.onChange(changed);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts a multipart stream with the first part's headers", () => {
    const res = watch();

    expect(res.head).toEqual([
      200,
      {
        "Content-Type":
          "multipart/x-mixed-replace; boundary=tokio-camera-frame",
        "Cache-Control": "no-store",
      },
    ]);
    expect(res.chunks).toEqual([PART]);
  });

  it("follows each frame with the next part's headers, to its camera's pages only", () => {
    const one = watch();
    const two = watch();
    const other = watch(CAM);
    const [capture] = feeds.captures();

    feeds.frame(capture.id, Buffer.from("JPEG"));

    expect(one.chunks).toEqual([PART, `JPEG\r\n${PART}`]);
    expect(two.chunks).toEqual([PART, `JPEG\r\n${PART}`]);
    expect(other.chunks).toEqual([PART]);
  });

  it("skips a page that can't keep up, then sends it the next frame", () => {
    const slow = watch();
    const [{ id }] = feeds.captures();

    slow.writableNeedDrain = true;
    feeds.frame(id, Buffer.from("A"));
    slow.writableNeedDrain = false;
    feeds.frame(id, Buffer.from("B"));

    expect(slow.chunks).toEqual([PART, `B\r\n${PART}`]);
  });

  it("ignores frames for a capture it doesn't hold", () => {
    const res = watch();
    feeds.frame("99", Buffer.from("JPEG"));
    expect(res.chunks).toEqual([PART]);
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
    const [{ id }] = feeds.captures();
    changed.mockClear();

    res.emit("close");
    vi.advanceTimersByTime(CAMERA_LINGER_MS - 1000);
    const again = watch();
    vi.advanceTimersByTime(CAMERA_LINGER_MS);

    expect(feeds.captures()).toEqual([
      { id, device: "", label: "", quality: "720p" },
    ]);
    expect(changed).not.toHaveBeenCalled();
    feeds.frame(id, Buffer.from("JPEG"));
    expect(again.chunks).toEqual([PART, `JPEG\r\n${PART}`]);
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
    const [{ id }] = feeds.captures();

    expect(() => res.emit("error", new Error("EPIPE"))).not.toThrow();
    feeds.frame(id, Buffer.from("JPEG"));
    expect(res.chunks).toEqual([PART]);
  });

  it("gives a camera that comes back after the linger a new id", () => {
    const res = watch();
    const [{ id }] = feeds.captures();
    res.emit("close");
    vi.advanceTimersByTime(CAMERA_LINGER_MS);

    watch();

    expect(feeds.captures()[0].id).not.toBe(id);
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
