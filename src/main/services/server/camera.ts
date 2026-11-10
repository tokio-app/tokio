import { STUDIO_CAMERA_QUALITIES, StudioCameraQuality } from "@/common/schemas";
import type {
  CameraCapture,
  CameraChunk,
  CameraColors,
  CameraConfig,
} from "@/common/types";
import type { ServerResponse } from "node:http";
import { fragment, initSegment, MP4_TIMESCALE } from "./mp4";

// A camera that no page shows any more, or that pages ask for at a lower
// quality, keeps its capture this long, so an OBS source reloading doesn't
// turn the camera off and on.
export const CAMERA_LINGER_MS = 5000;

// A fragment lasts as long as since the chunk before, within these, in the
// fragments' clock; the first one 1/30 s. Pages play in MediaSource's
// sequence mode, so decode times only have to increase.
const MIN_DURATION = MP4_TIMESCALE / 1000;
const MAX_DURATION = MP4_TIMESCALE / 5;
const DEFAULT_DURATION = MP4_TIMESCALE / 30;

const rank = (quality: StudioCameraQuality) =>
  STUDIO_CAMERA_QUALITIES.indexOf(quality);

const sameColors = (a: CameraColors | null, b: CameraColors | null) =>
  a?.primaries === b?.primaries &&
  a?.transfer === b?.transfer &&
  a?.matrix === b?.matrix &&
  a?.fullRange === b?.fullRange;

const sameConfig = (a: CameraConfig, b: CameraConfig | null) =>
  a.codec === b?.codec &&
  a.width === b.width &&
  a.height === b.height &&
  Buffer.from(a.description).equals(b.description) &&
  sameColors(a.colors, b.colors);

type Watcher = {
  quality: StudioCameraQuality;
  // The init segment it started with, null while it waits for a config
  // (its headers name the codec)
  init: Buffer | null;
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
  init: Buffer | null;
  sequence: number;
  // The next fragment's decode time, and the last chunk's timestamp (µs)
  decodeTime: number;
  timestamp: number | null;
  // The window was asked for a keyframe that hasn't come yet
  asked: boolean;
};

/**
 * The camera streams pages have open, one feed per camera, each the
 * window's H.264 as fragmented MP4, which pages play through MediaSource.
 */
export class CameraFeeds {
  private _feeds = new Map<string, Feed>();
  private _count = 0;
  private _listeners: (() => void)[] = [];
  private _keyframeListeners: ((id: string) => void)[] = [];

  /**
   * Streams a camera's video to the response, until it closes. Its headers
   * wait for the camera's config.
   */
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
        init: null,
        sequence: 0,
        decodeTime: 0,
        timestamp: null,
        asked: false,
      };
      this._feeds.set(feed.id, feed);
    }
    const watched = feed;
    const watcher: Watcher = { quality, init: null, waiting: true };
    this._start(watched, res, watcher);
    const drop = () => {
      if (!watched.responses.delete(res)) return;
      this._update(watched);
    };
    res.on("close", drop);
    // Unhandled, a broken pipe would throw in main
    res.on("error", drop);
    watched.responses.set(res, watcher);
    this._update(watched);
    // It starts at a new keyframe, which the window sends at once: from the
    // last one, it would show the camera up to 2 s late
    this._ask(watched);
  }

  /** Sends a chunk to every page that streams the capture with its id. */
  public frame(chunk: CameraChunk) {
    const feed = this._feeds.get(chunk.id);
    if (!feed) return;
    if (chunk.key) this._keyframe(feed, chunk);
    else this._delta(feed, chunk);
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

  /**
   * Called with a capture's id when a page waits for its next keyframe,
   * which the window should then send at once.
   */
  public onKeyframe(listener: (id: string) => void) {
    this._keyframeListeners.push(listener);
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

  // Sends the headers and the init segment, once the feed has a config
  private _start(feed: Feed, res: ServerResponse, watcher: Watcher) {
    if (!feed.config || !feed.init || watcher.init) return;
    res.writeHead(200, {
      // The codec string passed CAMERA_FRAME's check, so it can't break
      // out of the quotes
      "Content-Type": `video/mp4; codecs="${feed.config.codec}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.write(feed.init);
    watcher.init = feed.init;
  }

  private _fragment(feed: Feed, chunk: CameraChunk) {
    const since =
      feed.timestamp === null
        ? null
        : ((chunk.timestamp - feed.timestamp) * MP4_TIMESCALE) / 1e6;
    const duration =
      since === null
        ? DEFAULT_DURATION
        : Math.min(MAX_DURATION, Math.max(MIN_DURATION, Math.round(since)));
    feed.timestamp = chunk.timestamp;
    const sent = fragment(
      ++feed.sequence,
      feed.decodeTime,
      duration,
      chunk.key,
      chunk.frame,
    );
    feed.decodeTime += duration;
    return sent;
  }

  private _keyframe(feed: Feed, chunk: CameraChunk) {
    const { config } = chunk;
    if (config && !sameConfig(config, feed.config)) {
      const { codec, width, height, description, colors } = config;
      feed.config = { codec, width, height, description, colors };
      feed.init = initSegment(feed.config);
      // A page can't take another init mid-stream: ending it makes it
      // reconnect, and the new stream starts with this one
      const ended = [...feed.responses].filter(([, w]) => w.init);
      for (const [res] of ended) {
        feed.responses.delete(res);
        res.end();
      }
      if (ended.length > 0) this._update(feed);
    }
    // Nothing could decode it
    if (!feed.init) return;
    feed.asked = false;
    const sent = this._fragment(feed, chunk);
    for (const [res, watcher] of feed.responses) {
      this._start(feed, res, watcher);
      // A page that can't keep up, like a slow PC on Wi-Fi, skips to a
      // later keyframe instead of piling frames up
      if (res.writableNeedDrain) {
        watcher.waiting = true;
        continue;
      }
      res.write(sent);
      watcher.waiting = false;
    }
  }

  private _delta(feed: Feed, chunk: CameraChunk) {
    if (!feed.init) return;
    const sent = this._fragment(feed, chunk);
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

  // Once per keyframe, and not before the first: a capture starts with one
  private _ask(feed: Feed) {
    if (!feed.init || feed.asked) return;
    feed.asked = true;
    for (const listener of this._keyframeListeners) listener(feed.id);
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
