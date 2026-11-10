import { STUDIO_CAMERA_QUALITIES, StudioCameraQuality } from "@/common/schemas";
import type { CameraCapture } from "@/common/types";
import type { ServerResponse } from "node:http";

// A camera that no page shows any more, or that pages ask for at a lower
// quality, keeps its capture this long, so an OBS source reloading doesn't
// turn the camera off and on.
export const CAMERA_LINGER_MS = 5000;

const BOUNDARY = "tokio-camera-frame";
const PART = `--${BOUNDARY}\r\nContent-Type: image/jpeg\r\n\r\n`;
// Chromium shows a part only once the next part's headers arrive, so each
// frame is followed at once by the boundary and the next part's headers, and
// no part says its Content-Length.
const NEXT = Buffer.from(`\r\n${PART}`);

const rank = (quality: StudioCameraQuality) =>
  STUDIO_CAMERA_QUALITIES.indexOf(quality);

type Feed = {
  id: string;
  device: string;
  label: string;
  // Each open stream and the quality its page asked for
  responses: Map<ServerResponse, StudioCameraQuality>;
  // The quality captured, which a drop reaches only after the linger
  quality: StudioCameraQuality | null;
  linger: NodeJS.Timeout | null;
};

/**
 * The camera streams pages have open, one feed per camera, as MJPEG
 * (multipart/x-mixed-replace) responses that the window's frames go to.
 */
export class CameraFeeds {
  private _feeds = new Map<string, Feed>();
  private _count = 0;
  private _listeners: (() => void)[] = [];

  /** Streams a camera's frames to the response, until it closes. */
  public watch(
    res: ServerResponse,
    camera: { device: string; label: string },
    quality: StudioCameraQuality,
  ) {
    let feed = [...this._feeds.values()].find(
      (f) => f.device === camera.device && f.label === camera.label,
    );
    if (!feed) {
      feed = {
        id: String(++this._count),
        ...camera,
        responses: new Map(),
        quality: null,
        linger: null,
      };
      this._feeds.set(feed.id, feed);
    }
    const watched = feed;
    res.writeHead(200, {
      "Content-Type": `multipart/x-mixed-replace; boundary=${BOUNDARY}`,
      "Cache-Control": "no-store",
    });
    res.write(PART);
    const drop = () => {
      if (!watched.responses.delete(res)) return;
      this._update(watched);
    };
    res.on("close", drop);
    // Unhandled, a broken pipe would throw in main
    res.on("error", drop);
    watched.responses.set(res, quality);
    this._update(watched);
  }

  /** Sends a JPEG to every page that streams the capture with the id. */
  public frame(id: string, jpeg: Uint8Array) {
    const feed = this._feeds.get(id);
    if (!feed || feed.responses.size === 0) return;
    // One write, so a page gets a whole part or none
    const part = Buffer.concat([jpeg, NEXT]);
    for (const res of feed.responses.keys()) {
      // A page that can't keep up, like a slow PC on Wi-Fi, misses frames
      // instead of piling them up
      if (res.writableNeedDrain) continue;
      res.write(part);
    }
  }

  /** The cameras to capture, each at the largest quality a page wants. */
  public captures(): CameraCapture[] {
    return [...this._feeds.values()].flatMap(
      ({ id, device, label, quality }) =>
        quality ? [{ id, device, label, quality }] : [],
    );
  }

  /** Called whenever captures() changes. */
  public onChange(listener: () => void) {
    this._listeners.push(listener);
  }

  /** Ends every stream, as the server stops. */
  public closeAll() {
    const had = this.captures().length > 0;
    const feeds = [...this._feeds.values()];
    this._feeds.clear();
    for (const feed of feeds) {
      if (feed.linger) clearTimeout(feed.linger);
      for (const res of feed.responses.keys()) res.end();
    }
    if (had) this._changed();
  }

  // A new camera or a higher quality is captured at once, a drop after the
  // linger
  private _update(feed: Feed) {
    if (this._feeds.get(feed.id) !== feed) return;
    const wanted = this._wanted(feed);
    if (
      wanted !== null &&
      (feed.quality === null || rank(wanted) > rank(feed.quality))
    ) {
      this._settle(feed);
      return;
    }
    if (wanted === feed.quality) {
      if (feed.linger) clearTimeout(feed.linger);
      feed.linger = null;
      return;
    }
    if (feed.linger) clearTimeout(feed.linger);
    feed.linger = setTimeout(() => this._settle(feed), CAMERA_LINGER_MS);
  }

  private _settle(feed: Feed) {
    if (feed.linger) clearTimeout(feed.linger);
    feed.linger = null;
    if (this._feeds.get(feed.id) !== feed) return;
    const wanted = this._wanted(feed);
    if (wanted === null) this._feeds.delete(feed.id);
    if (wanted === feed.quality) return;
    feed.quality = wanted;
    this._changed();
  }

  private _wanted(feed: Feed): StudioCameraQuality | null {
    let best: StudioCameraQuality | null = null;
    for (const quality of feed.responses.values()) {
      if (best === null || rank(quality) > rank(best)) best = quality;
    }
    return best;
  }

  private _changed() {
    for (const listener of this._listeners) listener();
  }
}
