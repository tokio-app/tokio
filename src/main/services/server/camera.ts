import { STUDIO_CAMERA_QUALITIES, StudioCameraQuality } from "@/common/schemas";
import type { CameraCapture, CameraChunk, CameraConfig } from "@/common/types";
import type { ServerResponse } from "node:http";

// A camera that no page shows any more, or that pages ask for at a lower
// quality, keeps its capture this long, so an OBS source reloading doesn't
// turn the camera off and on.
export const CAMERA_LINGER_MS = 5000;

// A stream's messages: a type byte, the payload's length (4 bytes, big
// endian), then the payload. A config's is its JSON, a keyframe's and a
// delta's the chunk's timestamp (a big-endian float64) then its bytes.
// src/common/studio/stage.ts keeps its own copy (it may import only types),
// so they change together.
export const CAMERA_CONFIG = 1;
export const CAMERA_KEYFRAME = 2;
export const CAMERA_DELTA = 3;

// The window sends a keyframe every 2 s, so a GOP this big means a stuck
// encoder: past it, new pages wait for the next keyframe
export const CAMERA_GOP_MAX_MESSAGES = 600;
export const CAMERA_GOP_MAX_BYTES = 16 * 1024 * 1024;

const rank = (quality: StudioCameraQuality) =>
  STUDIO_CAMERA_QUALITIES.indexOf(quality);

// One buffer per message, written whole to every page
const message = (type: number, ...parts: Uint8Array[]) => {
  const header = Buffer.alloc(5);
  header[0] = type;
  header.writeUInt32BE(
    parts.reduce((size, part) => size + part.byteLength, 0),
    1,
  );
  return Buffer.concat([header, ...parts]);
};

type Watcher = {
  quality: StudioCameraQuality;
  // The config message it was last sent, so it gets each one once
  config: Buffer | null;
  // It can't decode until the next keyframe: it's new, or missed a frame
  waiting: boolean;
};

type Feed = {
  id: string;
  device: string;
  label: string;
  // Each open stream and the quality its page asked for
  responses: Map<ServerResponse, Watcher>;
  // The quality captured, which a drop reaches only after the linger
  quality: StudioCameraQuality | null;
  linger: NodeJS.Timeout | null;
  config: CameraConfig | null;
  configMessage: Buffer | null;
  // The messages since the last keyframe, that keyframe first, so a new
  // page shows the camera at once: null before the first keyframe, empty
  // past the cap
  gop: Buffer[] | null;
  gopBytes: number;
};

/**
 * The camera streams pages have open, one feed per camera, each a stream
 * of the window's encoded video (see CAMERA_CONFIG).
 */
export class CameraFeeds {
  private _feeds = new Map<string, Feed>();
  private _count = 0;
  private _listeners: (() => void)[] = [];

  /** Streams a camera's video to the response, until it closes. */
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
        config: null,
        configMessage: null,
        gop: null,
        gopBytes: 0,
      };
      this._feeds.set(feed.id, feed);
    }
    const watched = feed;
    res.writeHead(200, {
      "Content-Type": "application/octet-stream",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      // The editor fetches it from file:// (or the dev server); the key
      // still guards it
      "Access-Control-Allow-Origin": "*",
    });
    // Node holds the headers until the first write, which may wait for a
    // keyframe, and the page's fetch until the headers
    res.flushHeaders();
    const watcher: Watcher = { quality, config: null, waiting: true };
    if (watched.configMessage && watched.gop?.length) {
      res.write(watched.configMessage);
      for (const sent of watched.gop) res.write(sent);
      watcher.config = watched.configMessage;
      watcher.waiting = false;
    }
    const drop = () => {
      if (!watched.responses.delete(res)) return;
      this._update(watched);
    };
    res.on("close", drop);
    // Unhandled, a broken pipe would throw in main
    res.on("error", drop);
    watched.responses.set(res, watcher);
    this._update(watched);
  }

  /** Sends a chunk to every page that streams the capture with its id. */
  public frame(chunk: CameraChunk) {
    // A feed lingering with no page still keeps its GOP, so a page that
    // reloads shows the camera at once
    const feed = this._feeds.get(chunk.id);
    if (!feed) return;
    const time = Buffer.alloc(8);
    time.writeDoubleBE(chunk.timestamp);
    if (chunk.key) this._keyframe(feed, chunk, time);
    else this._delta(feed, chunk, time);
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

  private _keyframe(feed: Feed, chunk: CameraChunk, time: Buffer) {
    const { config } = chunk;
    if (
      config &&
      (config.codec !== feed.config?.codec ||
        config.width !== feed.config.width ||
        config.height !== feed.config.height)
    ) {
      const { codec, width, height } = config;
      feed.config = { codec, width, height };
      feed.configMessage = message(
        CAMERA_CONFIG,
        Buffer.from(JSON.stringify(feed.config)),
      );
    }
    // Nothing could decode it
    if (!feed.configMessage) return;
    const sent = message(CAMERA_KEYFRAME, time, chunk.frame);
    feed.gop = [sent];
    feed.gopBytes = sent.byteLength;
    for (const [res, watcher] of feed.responses) {
      // A page that can't keep up, like a slow PC on Wi-Fi, skips to a
      // later keyframe instead of piling frames up
      if (res.writableNeedDrain) {
        watcher.waiting = true;
        continue;
      }
      if (watcher.config !== feed.configMessage) {
        res.write(feed.configMessage);
        watcher.config = feed.configMessage;
      }
      res.write(sent);
      watcher.waiting = false;
    }
  }

  private _delta(feed: Feed, chunk: CameraChunk, time: Buffer) {
    if (!feed.gop) return;
    const sent = message(CAMERA_DELTA, time, chunk.frame);
    // Past the cap the GOP stays empty until the next keyframe, and the
    // pages already following still get each delta
    if (feed.gop.length > 0) {
      feed.gop.push(sent);
      feed.gopBytes += sent.byteLength;
    }
    if (
      feed.gop.length > CAMERA_GOP_MAX_MESSAGES ||
      feed.gopBytes > CAMERA_GOP_MAX_BYTES
    ) {
      feed.gop = [];
      feed.gopBytes = 0;
    }
    for (const [res, watcher] of feed.responses) {
      if (watcher.waiting) continue;
      // A delta missed breaks every frame until the next keyframe
      if (res.writableNeedDrain) {
        watcher.waiting = true;
        continue;
      }
      res.write(sent);
    }
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
    for (const { quality } of feed.responses.values()) {
      if (best === null || rank(quality) > rank(best)) best = quality;
    }
    return best;
  }

  private _changed() {
    for (const listener of this._listeners) listener();
  }
}
