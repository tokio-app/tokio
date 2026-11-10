/*
 * Overlay Studio's one renderer: the served page (/studio/<id>/) and the
 * editor both draw a StudioView with it, in the markup overlay.css describes.
 *
 * Type imports only: main inlines this file into its page through esbuild
 * without bundling it. Nothing newer than Chromium 103, OBS 30's browser.
 */
import type { StudioMotion, StudioShape } from "../schemas/studio";
import type {
  StudioElementView,
  StudioLayerView,
  StudioReact,
  StudioView,
} from "../types/studio";

export type StageOptions = {
  // The editor's: every embed is an empty, stable element (slot) that React
  // portals its own preview into. Off, an embed is an iframe at its src.
  slots?: boolean;
  // The editor's: elements and groups that wait for an event stay on
  // screen, marked with studio-waits. A react plays their entrance, their
  // seconds and their exit, and they come back as they wait.
  editing?: boolean;
  // The editor's: shows a camera element's camera in its video until the
  // returned function stops it, in place of playing its stream. The window
  // that edits captures the cameras itself.
  camera?: (video: HTMLVideoElement, src: string) => () => void;
};

// The canvas's scale and its offset inside the root, in the root's px
export type StageFit = { scale: number; left: number; top: number };

export type Stage = {
  // Draws the view, updating each element's node in place; null clears it
  update(view: StudioView | null): void;
  // Plays an element's or a group's reaction to its trigger, with an
  // element's new text or picture
  react(r: StudioReact): void;
  // The node an embed's preview goes in, with slots
  slot(elementId: string): HTMLElement | null;
  // Where the canvas sits in the root now
  fit(): StageFit;
  // An element's picture's own size, null until it's read or for none
  picture(elementId: string): { width: number; height: number } | null;
  // The editor's: its videos play their sound, which it mutes until then
  sound(on: boolean): void;
  // The editor's: holds an element's video still at those seconds while a
  // cut's handle moves, and a moment after the last, plays its part again
  hold(elementId: string, seconds: number): void;
  // The editor's: plays an element's video's part again from its start, as
  // one without loop stops at its end
  replay(elementId: string): void;
  // Removes everything it drew and frees its players
  destroy(): void;
};

// What a picture keeps of itself: fractions cut from each side
type Crop = { left: number; top: number; right: number; bottom: number };

const NO_CROP: Crop = { left: 0, top: 0, right: 0, bottom: 0 };

/**
 * What moves: an element's body or a group's wrapper. Each keeps its own
 * motion, so a group comes in and leaves as one while its elements keep
 * theirs.
 */
type Mover = {
  node: HTMLDivElement;
  // How the last view said it moves, undefined before the first
  motion: StudioMotion | undefined;
  // The element it moves, none for a group's wrapper
  entry: Entry | undefined;
  // Ends its seconds on screen, then its exit
  timer: ReturnType<typeof setTimeout> | undefined;
  // It came in on an event and hasn't finished leaving
  shown: boolean;
  // Its exit plays, which only a react or a new When cuts short
  leaving: boolean;
};

// A layer's node, the whole canvas, and a group's wrapper in it, whose box's
// corner its elements are placed from (0, 0 for an element on its own)
type Layer = { node: HTMLDivElement; group?: Mover; x: number; y: number };

type Entry = {
  element: StudioElementView;
  // The id of the layer it's in
  layer: string;
  el: HTMLDivElement;
  body: HTMLDivElement;
  // Its body's motion
  mover: Mover;
  // Wakes its video at the end of the part it plays (watch)
  cue: ReturnType<typeof setTimeout> | undefined;
  // Its video, without loop, played its part and stays where it stopped
  done: boolean;
  // The source and cut its video last started from, so a change starts it
  // over
  cut: string | undefined;
  // The editor's: the seconds its video is held still at (hold), and the
  // timer that lets it go
  still: number | undefined;
  letGo: ReturnType<typeof setTimeout> | undefined;
  // A camera's player, for the stream it plays
  camera: { src: string; stop: () => void } | undefined;
};

// How long a held video stays still after a cut's handle last moved
const HOLD_MS = 600;

// How long a camera's stream waits to open again, as served pages reconnect
const CAMERA_RETRY_MS = 2000;
// How far behind its stream's end a camera may play before it skips ahead,
// and where it aims: the skip decodes from the last keyframe, up to 2 s of
// frames, so it lands further behind, which playing faster makes up
const CAMERA_BEHIND = 1;
const CAMERA_LEAD = 0.1;
// Behind by more than CAMERA_LATE, it plays faster until it's within
// CAMERA_CAUGHT_UP: frames that come in a burst, as a new capture's first
// ones do, would leave it late for good. A steady 30 fps stays under
// CAMERA_LATE: speeding up there drops frames.
const CAMERA_LATE = 0.15;
const CAMERA_CAUGHT_UP = 0.07;
const CAMERA_FAST = 1.5;
// What a camera keeps behind where it plays: MediaSource's quota fills in
// minutes at 4 Mbps
const CAMERA_KEEP = 30;
const CAMERA_TRIMMED = 10;

const ARCHIVO = '"Archivo Variable", sans-serif';
const MOTION = /^studio-(enter|exit|play|loop)-/;

// How long every exit plays: each studio-exit-* in overlay.css lasts this
export const EXIT_MS = 450;

// Splits a name into what shows as one character, a flag or emoji included
const characters = new Intl.Segmenter();

const div = (className: string) => {
  const el = document.createElement("div");
  el.className = className;
  return el;
};

// One CSSOM property, so a name can't add any other style
const fontFamily = (font: string) =>
  font.trim() ? `${JSON.stringify(font.trim())}, ${ARCHIVO}` : ARCHIVO;

const clearMotion = (node: HTMLElement) => {
  for (const name of Array.from(node.classList)) {
    if (MOTION.test(name)) node.classList.remove(name);
  }
};

// Plays the animation from its start, even mid-animation
const restart = (node: HTMLElement, className: string) => {
  clearMotion(node);
  void node.offsetWidth;
  node.classList.add(className);
};

type Box = { x: number; y: number; width: number; height: number };

// The smallest unturned box around a turned one: the editor's extent
// (pages/StudioEditor/helper.ts), copied since this file imports only types
const extent = ({ x, y, width, height, rotation }: StudioElementView): Box => {
  if (!rotation) return { x, y, width, height };
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  const w = width * cos + height * sin;
  const h = width * sin + height * cos;
  return {
    x: x + (width - w) / 2,
    y: y + (height - h) / 2,
    width: w,
    height: h,
  };
};

// A group's box: the editor's bounds around its elements' extents, as they
// show. Empty, at the canvas's corner, without any.
const groupBox = (elements: StudioElementView[]): Box => {
  if (elements.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const boxes = elements.map(extent);
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
    height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
  };
};

/**
 * The seconds of a media element's video that play: cutPart's rule
 * (src/common/util/alerts.ts), copied since this file imports only types. A
 * part that doesn't fit plays the whole video, and a length not read yet, or
 * unknown, is endless.
 */
const partOf = (element: StudioElementView, duration: number) => {
  const length = Number.isFinite(duration) ? duration : Infinity;
  const cut = element.kind === "media" ? element : { start: 0, end: null };
  const start = Math.min(Math.max(0, cut.start), length);
  const stop = Math.min(cut.end ?? length, length);
  return stop > start ? { start, stop } : { start: 0, stop: length };
};

// A video that plays its part once, and stops there
const once = (element: StudioElementView) =>
  element.kind === "media" && !element.loop;

// A media element's video. A camera's plays its stream (playCamera), with
// no part, loop or sound.
const clipOf = (entry: Entry) =>
  entry.element.kind === "media" ? entry.body.querySelector("video") : null;

// The shapes a body's own paint can't draw, as SVG
export type Figure = Exclude<StudioShape, "rectangle" | "ellipse">;

type Point = [number, number];

const hundredths = (n: number) => Math.round(n * 100) / 100;

const polygonPath = (corners: Point[]) =>
  `M${corners.map(([x, y]) => `${hundredths(x)} ${hundredths(y)}`).join("L")}Z`;

// Corners around a middle, the first pointing up, each at its distance
const around = (count: number, distance: (i: number) => number): Point[] =>
  Array.from({ length: count }, (_, i) => {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / count;
    return [Math.cos(angle) * distance(i), Math.sin(angle) * distance(i)];
  });

// The corners stretched so their bounds fill the box
const fitted = (corners: Point[], width: number, height: number): Point[] => {
  const xs = corners.map(([x]) => x);
  const ys = corners.map(([, y]) => y);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const across = Math.max(...xs) - left;
  const down = Math.max(...ys) - top;
  return corners.map(([x, y]) => [
    ((x - left) / across) * width,
    ((y - top) / down) * height,
  ]);
};

// A star's inner corners, a share of the outer ones' distance, as Figma's
const STAR_RATIO = 0.382;

/**
 * A shape's outline in px of its box, filling it: a polygon's or a star's
 * corners touching its sides, an arrow pointing right, a heart, a speech
 * bubble with its tail at the bottom left. The editor's thumbnails draw it
 * too.
 */
export function shapePath(
  shape: Figure,
  width: number,
  height: number,
  { sides, points, radius }: { sides: number; points: number; radius: number },
): string {
  const w = width;
  const h = height;
  const at = (x: number, y: number) => `${hundredths(x)} ${hundredths(y)}`;
  switch (shape) {
    case "polygon":
      return polygonPath(
        fitted(
          around(sides, () => 1),
          w,
          h,
        ),
      );
    case "star":
      return polygonPath(
        fitted(
          around(points * 2, (i) => (i % 2 ? STAR_RATIO : 1)),
          w,
          h,
        ),
      );
    case "arrow": {
      // Its head as long as the box is tall, at most half its width
      const head = w - Math.min(h, w / 2);
      return polygonPath([
        [0, h / 4],
        [head, h / 4],
        [head, 0],
        [w, h / 2],
        [head, h],
        [head, (h * 3) / 4],
        [0, (h * 3) / 4],
      ]);
    }
    case "heart": {
      const p = (x: number, y: number) => at(x * w, y * h);
      return (
        `M${p(0.5, 1)}` +
        `C${p(0.2, 0.78)} ${p(0, 0.58)} ${p(0, 0.31)}` +
        `C${p(0, 0.12)} ${p(0.13, 0)} ${p(0.28, 0)}` +
        `C${p(0.39, 0)} ${p(0.47, 0.07)} ${p(0.5, 0.17)}` +
        `C${p(0.53, 0.07)} ${p(0.61, 0)} ${p(0.72, 0)}` +
        `C${p(0.87, 0)} ${p(1, 0.12)} ${p(1, 0.31)}` +
        `C${p(1, 0.58)} ${p(0.8, 0.78)} ${p(0.5, 1)}Z`
      );
    }
    // The bubble
    default: {
      // Its body over the tail, which drops from its bottom edge
      const tail = Math.min(h, w) * 0.25;
      const body = h - tail;
      const r = Math.max(0, Math.min(radius, w / 2, body / 2));
      const from = Math.max(r, w * 0.15);
      const across = Math.max(0, Math.min(tail, w - r - from));
      const arc = (x: number, y: number) => `A${at(r, r)} 0 0 1 ${at(x, y)}`;
      return (
        `M${at(r, 0)}H${hundredths(w - r)}${arc(w, r)}` +
        `V${hundredths(body - r)}${arc(w - r, body)}` +
        `H${hundredths(from + across)}L${at(from, h)}L${at(from, body)}` +
        `H${hundredths(r)}${arc(0, body - r)}V${hundredths(r)}${arc(r, 0)}Z`
      );
    }
  }
}

const SVG = "http://www.w3.org/2000/svg";

// A shape the body's paint can't draw: one path, in px of its box
const newFigure = () => {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("class", "studio-figure");
  svg.append(document.createElementNS(SVG, "path"));
  return svg;
};

// Chromium keeps a detached player that still has a source alive
const release = (video: HTMLVideoElement) => {
  video.pause();
  video.removeAttribute("src");
  video.load();
};

const picture = (className: string) => {
  const img = document.createElement("img");
  img.className = className;
  img.alt = "";
  img.draggable = false;
  img.addEventListener("error", () => img.classList.add("studio-failed"));
  return img;
};

const setPicture = (img: HTMLImageElement, src: string | null) => {
  if (!src) {
    img.removeAttribute("src");
    img.classList.add("studio-failed");
  } else if (img.getAttribute("src") !== src) {
    img.classList.remove("studio-failed");
    img.src = src;
  }
};

const setVideo = (video: HTMLVideoElement, src: string | null) => {
  if (!src) {
    if (video.hasAttribute("src")) release(video);
  } else if (video.getAttribute("src") !== src) {
    video.src = src;
  }
};

/**
 * Plays a camera's stream in the video until the returned function stops
 * it: fragmented MP4 main muxes, appended to a MediaSource as it comes, kept
 * at its live edge (faster while behind, skipping ahead when far behind) and
 * trimmed behind it. WebCodecs needs a secure context, which a browser
 * source at tokio-app.local or a LAN address isn't; MediaSource doesn't. It
 * opens again 2 s after the stream ends or fails, and gives up quietly on a
 * refused stream, or a browser that can't play it.
 */
function playCamera(video: HTMLVideoElement, src: string): () => void {
  let controller: AbortController | undefined;
  let url: string | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;

  const teardown = () => {
    if (controller) controller.abort();
    controller = undefined;
    if (url) URL.revokeObjectURL(url);
    url = undefined;
    release(video);
  };

  const open = async () => {
    if (typeof MediaSource !== "function") return;
    const aborter = new AbortController();
    controller = aborter;
    // Ended or failed, unless it was stopped
    const again = () => {
      if (aborter.signal.aborted) return;
      teardown();
      retry = setTimeout(open, CAMERA_RETRY_MS);
    };
    let res: Response;
    try {
      res = await fetch(src, { cache: "no-store", signal: aborter.signal });
    } catch {
      again();
      return;
    }
    const type = res.headers.get("Content-Type") || "";
    const body = res.body;
    if (!res.ok || !body || !MediaSource.isTypeSupported(type)) {
      aborter.abort();
      return;
    }
    const source = new MediaSource();
    url = URL.createObjectURL(source);
    video.src = url;
    video.play().catch(() => {});
    source.addEventListener(
      "sourceopen",
      () => {
        if (aborter.signal.aborted) return;
        const queue: Uint8Array<ArrayBuffer>[] = [];
        let buffer: SourceBuffer;
        // One append at a time, each after its live edge and trim
        const next = () => {
          if (aborter.signal.aborted || buffer.updating) return;
          try {
            const { buffered } = buffer;
            if (buffered.length) {
              const start = buffered.start(0);
              const end = buffered.end(buffered.length - 1);
              const behind = end - video.currentTime;
              // Not while a skip still decodes, which a slow PC could keep
              // starting over
              if (!video.seeking && behind > CAMERA_BEHIND) {
                // Its first frame too: its stream starts at main's timestamps
                video.currentTime = Math.max(start, end - CAMERA_LEAD);
              } else if (!video.seeking && behind > CAMERA_LATE) {
                video.playbackRate = CAMERA_FAST;
              } else if (behind < CAMERA_CAUGHT_UP) {
                video.playbackRate = 1;
              }
              // From where it keeps: its stream starts at main's timestamps
              if (video.currentTime - start > CAMERA_KEEP) {
                buffer.remove(0, video.currentTime - CAMERA_TRIMMED);
                return;
              }
            }
            const chunk = queue.shift();
            if (chunk) buffer.appendBuffer(chunk);
          } catch {
            // A decode error ended the source
            again();
          }
        };
        try {
          buffer = source.addSourceBuffer(type);
          buffer.mode = "sequence";
        } catch {
          again();
          return;
        }
        buffer.addEventListener("updateend", next);
        const reader = body.getReader();
        const read = async () => {
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) break;
              queue.push(value);
              next();
            }
          } catch {
            // Opened again below, unless it was stopped
          }
          again();
        };
        void read();
      },
      { once: true },
    );
  };

  void open();

  return () => {
    clearTimeout(retry);
    teardown();
  };
}

// The stage mutes, loops and plays it (makeVideo, fill, playback)
const newVideo = () => {
  const video = document.createElement("video");
  video.className = "studio-fill";
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  return video;
};

const newPicture = () => picture("studio-fill");

// Transparent, with no border or scrollbars, filling its box
const newFrame = () => {
  const frame = document.createElement("iframe");
  frame.className = "studio-embed";
  frame.setAttribute("scrolling", "no");
  return frame;
};

// The body's one child of that type, made in place of whatever was there
function only<T extends Element>(
  body: HTMLElement,
  type: { new (): T; prototype: T },
  make: () => T,
): T {
  const child = body.firstElementChild;
  if (child instanceof type) return child;
  if (child instanceof HTMLVideoElement) release(child);
  child?.remove();
  return body.appendChild(make());
}

const setViewer = (avatar: HTMLElement, src: string, name: string) => {
  const img = avatar.querySelector("img")!;
  const initial = avatar.querySelector<HTMLElement>(".studio-initial")!;
  const [first] = characters.segment(name.trim());
  initial.textContent = first ? first.segment.toUpperCase() : "";
  if (!src) {
    img.removeAttribute("src");
    avatar.classList.remove("studio-has-picture");
  } else if (img.getAttribute("src") !== src) {
    // The new viewer's initial shows until their picture loads, not an
    // empty circle
    avatar.classList.remove("studio-has-picture");
    img.src = src;
  }
};

const newAvatar = () => {
  const avatar = div("studio-avatar");
  const img = picture("");
  img.addEventListener("load", () =>
    avatar.classList.add("studio-has-picture"),
  );
  img.addEventListener("error", () =>
    avatar.classList.remove("studio-has-picture"),
  );
  avatar.append(img, div("studio-initial"));
  return avatar;
};

// A picture's own size, 0 by 0 until it's read
const ownSize = (media: HTMLImageElement | HTMLVideoElement) =>
  media instanceof HTMLVideoElement
    ? { width: media.videoWidth, height: media.videoHeight }
    : { width: media.naturalWidth, height: media.naturalHeight };

// Hidden until its own size is read, so it never shows uncut; false then
const sized = (media: HTMLImageElement | HTMLVideoElement) => {
  const own = ownSize(media);
  if (own.width && own.height) return own;
  media.style.visibility = "hidden";
  return null;
};

/**
 * A cropped or rounded media, gift or emote picture: the part it keeps fits
 * its box as contain fits a whole one, all of it placed around that part and
 * clipped to it, its corners rounded by a share of what shows. A plain one
 * keeps the stylesheet's contain.
 */
const layoutPicture = (
  media: HTMLImageElement | HTMLVideoElement,
  box: { width: number; height: number },
  crop: Crop | null,
  rounding: number,
) => {
  const cut = crop !== null || rounding > 0;
  media.classList.toggle("studio-cut", cut);
  if (!cut) {
    media.removeAttribute("style");
    return;
  }
  const own = sized(media);
  if (!own) return;
  const { left, top, right, bottom } = crop ?? NO_CROP;
  const kept = {
    width: (1 - left - right) * own.width,
    height: (1 - top - bottom) * own.height,
  };
  const scale = Math.min(box.width / kept.width, box.height / kept.height);
  const width = own.width * scale;
  const height = own.height * scale;
  // The part it keeps, centered in the box
  const x = (box.width - kept.width * scale) / 2;
  const y = (box.height - kept.height * scale) / 2;
  const round = (rounding / 100) * Math.min(kept.width, kept.height) * scale;
  media.style.visibility = "";
  media.style.left = `${x - left * width}px`;
  media.style.top = `${y - top * height}px`;
  media.style.width = `${width}px`;
  media.style.height = `${height}px`;
  media.style.clipPath = `inset(${top * height}px ${right * width}px ${bottom * height}px ${left * width}px round ${round}px)`;
};

/**
 * A viewer's cropped picture: the part it keeps covers the circle as cover
 * fits a whole one, which the circle clips. An uncropped one keeps the
 * stylesheet's cover.
 */
const layoutAvatar = (
  img: HTMLImageElement,
  side: number,
  crop: Crop | null,
) => {
  img.classList.toggle("studio-cut", crop !== null);
  if (!crop) {
    img.removeAttribute("style");
    return;
  }
  const own = sized(img);
  if (!own) return;
  const kept = {
    width: (1 - crop.left - crop.right) * own.width,
    height: (1 - crop.top - crop.bottom) * own.height,
  };
  const scale = Math.max(side / kept.width, side / kept.height);
  const width = own.width * scale;
  const height = own.height * scale;
  img.style.visibility = "";
  img.style.left = `${(side - kept.width * scale) / 2 - crop.left * width}px`;
  img.style.top = `${(side - kept.height * scale) / 2 - crop.top * height}px`;
  img.style.width = `${width}px`;
  img.style.height = `${height}px`;
};

/**
 * Draws studio overlays into root, its canvas scaled to fit and centered. It
 * keeps one node per layer and per element id, and never moves, re-inserts
 * or re-creates one, nor resets an iframe's src, unless that element's kind
 * or source changed, or it went to another layer: Chromium reloads a moved
 * iframe, and the view comes again on every autosave and every few hundred
 * ms of live numbers.
 */
export function createStage(
  root: HTMLElement,
  {
    slots = false,
    editing = false,
    camera: showCamera = playCamera,
  }: StageOptions = {},
): Stage {
  const canvas = div("studio-canvas");
  // Each layer's, by layer id
  const layers = new Map<string, Layer>();
  // Each element's, by element id
  const entries = new Map<string, Entry>();
  let size = { width: 0, height: 0 };

  root.classList.add("studio-stage");
  root.append(canvas);

  const fit = (): StageFit => {
    const { clientWidth: w, clientHeight: h } = root;
    const { width, height } = size;
    const scale = width && height ? Math.min(w / width, h / height) : 0;
    return {
      scale,
      left: (w - width * scale) / 2,
      top: (h - height * scale) / 2,
    };
  };

  const refit = () => {
    const { scale, left, top } = fit();
    canvas.style.transform = `translate(${left}px, ${top}px) scale(${scale})`;
  };

  const observer =
    typeof ResizeObserver === "function" ? new ResizeObserver(refit) : null;
  if (observer) observer.observe(root);
  else window.addEventListener("resize", refit);

  // Its own body, or the group it's in, waits or has left
  const hidden = (entry: Entry) =>
    entry.body.closest(".studio-hidden") !== null;

  // Draws its element again once its picture's own size is read, so a
  // cropped or rounded one is laid out: a gift a viewer sends, a new file
  const relayout = (event: Event) => {
    const media = event.currentTarget;
    if (!(media instanceof HTMLElement)) return;
    const id = media.closest<HTMLElement>("[data-element]")?.dataset.element;
    const entry = id === undefined ? undefined : entries.get(id);
    if (entry) fill(entry);
  };
  const makePicture = () => {
    const img = newPicture();
    img.addEventListener("load", relayout);
    return img;
  };
  // Muted, so it plays on its own, and laid out again once its size is read
  // or changes. Not a clip: playback and the editor's sound leave it be.
  const makeCamera = () => {
    const video = newVideo();
    video.muted = true;
    video.addEventListener("loadedmetadata", relayout);
    video.addEventListener("resize", relayout);
    return video;
  };
  const makeAvatar = () => {
    const avatar = newAvatar();
    avatar.querySelector("img")!.addEventListener("load", relayout);
    return avatar;
  };

  // The editor's canvas is silent until its sound is turned on
  let silent = editing;
  // A browser tab refuses sound before a click (OBS doesn't): its videos
  // play muted until then
  let quiet = false;

  // Refused sound, it plays muted, and so do the videos after it
  const play = (video: HTMLVideoElement) => {
    const playing = video.play() as Promise<void> | undefined;
    playing?.catch((error: unknown) => {
      if (
        video.muted ||
        !(error instanceof DOMException) ||
        error.name !== "NotAllowedError"
      ) {
        return;
      }
      quiet = true;
      video.muted = true;
      play(video);
    });
  };

  // Videos play only while their element shows, from their part's start
  // when they start over, and one that played its part once stays there
  const playback = (entry: Entry, fromStart = false) => {
    const video = clipOf(entry);
    if (!video) return;
    if (hidden(entry)) {
      video.pause();
      return;
    }
    // Held still while a cut's handle moves (hold)
    if (entry.still !== undefined) return;
    if (fromStart) {
      entry.done = false;
      video.currentTime = partOf(entry.element, video.duration).start;
    }
    // An ended one would start again at 0, not at its part: `ended` does it
    if (
      video.paused &&
      !video.ended &&
      !entry.done &&
      video.hasAttribute("src")
    ) {
      play(video);
    }
  };

  // A part that stops before the video's own end is timed by the video's
  // clock, as the alert overlay times its cut: the clock can lag behind a
  // timer, so it waits again for the rest. The video's own end is `ended`'s.
  const watch = (entry: Entry, video: HTMLVideoElement) => {
    clearTimeout(entry.cue);
    entry.cue = undefined;
    const rate = video.playbackRate;
    const { stop } = partOf(entry.element, video.duration);
    if (video.paused || !(rate > 0) || !(stop < video.duration)) return;
    const left = (stop - video.currentTime) / rate;
    if (left <= 0.02) atEnd(entry, video);
    else entry.cue = setTimeout(() => watch(entry, video), left * 1000);
  };

  // Its part played: it plays again from its start with loop, else it
  // stops there, and an element that showed on an event leaves
  const atEnd = (entry: Entry, video: HTMLVideoElement) => {
    if (!once(entry.element)) {
      video.currentTime = partOf(entry.element, video.duration).start;
      playback(entry);
      watch(entry, video);
      return;
    }
    entry.done = true;
    video.pause();
    if (entry.mover.shown) leave(entry.mover);
  };

  const makeVideo = (entry: Entry) => {
    const video = newVideo();
    video.muted = silent || quiet;
    // Made again (an image, then Undo), it starts its part over
    entry.done = false;
    entry.cut = undefined;
    video.addEventListener("loadedmetadata", () => {
      // A start past its length plays the whole video, as cutPart does
      const { start, stop } = partOf(entry.element, video.duration);
      const outside = video.currentTime < start || video.currentTime >= stop;
      if (entry.still === undefined && outside) {
        entry.done = false;
        video.currentTime = start;
      }
      // Laid out once its size is read, if it's cropped or rounded
      fill(entry);
      playback(entry);
    });
    video.addEventListener("playing", () => watch(entry, video));
    // Chromium can send it after a react already sought back
    video.addEventListener("ended", () => {
      if (video.ended) atEnd(entry, video);
    });
    return video;
  };

  // Puts the element's content in its body, made on first use
  const fill = (entry: Entry) => {
    const { element, el, body } = entry;
    // From its group's box, if it's in one
    const origin = layers.get(entry.layer);
    el.style.left = `${element.x - (origin?.x ?? 0)}px`;
    el.style.top = `${element.y - (origin?.y ?? 0)}px`;
    el.style.width = `${element.width}px`;
    el.style.height = `${element.height}px`;
    el.style.zIndex = String(element.z);
    el.style.opacity = String(element.opacity);
    // Around its center, entrances and animations with it. The flip comes
    // first, along its own sides, and turns with it.
    const turn = element.rotation ? `rotate(${element.rotation}deg)` : "";
    const flip =
      element.flip_x || element.flip_y
        ? `scale(${element.flip_x ? -1 : 1}, ${element.flip_y ? -1 : 1})`
        : "";
    el.style.transform = turn && flip ? `${turn} ${flip}` : turn || flip;

    switch (element.kind) {
      case "text": {
        const text = only(body, HTMLDivElement, () => div("studio-text"));
        if (text.textContent !== element.text) text.textContent = element.text;
        text.style.fontFamily = fontFamily(element.font);
        text.style.fontSize = `${element.size}px`;
        text.style.textAlign = element.align;
        text.classList.toggle("studio-bold", element.bold);
        text.classList.toggle("studio-halo", element.halo);
        el.style.setProperty("--studio-color", element.color);
        break;
      }
      case "media": {
        let media: HTMLImageElement | HTMLVideoElement;
        if (element.video) {
          const video = only(body, HTMLVideoElement, () => makeVideo(entry));
          setVideo(video, element.src);
          video.volume = element.volume / 100;
          // The browser's own loop goes back to 0: an uncut start's, as
          // seamless as before
          video.loop = element.loop && element.start === 0;
          const cut = `${element.src} ${element.start} ${element.end} ${element.loop}`;
          if (entry.cut !== cut) {
            // Before it loads, Chromium keeps it as where it starts. Held,
            // it stays on the frame a cut's handle moved to.
            entry.cut = cut;
            entry.done = false;
            video.currentTime =
              entry.still ?? partOf(element, video.duration).start;
            watch(entry, video);
          }
          media = video;
        } else {
          media = only(body, HTMLImageElement, makePicture);
          setPicture(media, element.src);
        }
        layoutPicture(media, element, element.crop, element.rounding);
        break;
      }
      case "camera": {
        const video = only(body, HTMLVideoElement, makeCamera);
        const { src } = element;
        if ((entry.camera?.src ?? null) !== src) {
          entry.camera?.stop();
          entry.camera = src
            ? { src, stop: showCamera(video, src) }
            : undefined;
          if (src) video.dataset.src = src;
          else delete video.dataset.src;
        }
        layoutPicture(video, element, element.crop, element.rounding);
        break;
      }
      case "gift":
      case "emote": {
        const img = only(body, HTMLImageElement, makePicture);
        setPicture(img, element.src);
        layoutPicture(img, element, element.crop, element.rounding);
        break;
      }
      case "shape": {
        // A rectangle or an ellipse is its painted body, its border inside
        // it; the others draw as SVG
        const { shape, color, border } = element;
        const painted = shape === "rectangle" || shape === "ellipse";
        el.style.setProperty(
          "--studio-color",
          painted && color ? color : "transparent",
        );
        el.style.setProperty(
          "--studio-radius",
          shape === "ellipse" ? "50%" : `${element.radius}px`,
        );
        el.style.setProperty(
          "--studio-border",
          painted && border
            ? `${border.width}px solid ${border.color}`
            : "none",
        );
        if (shape === "rectangle" || shape === "ellipse") {
          body.firstElementChild?.remove();
          break;
        }
        const figure = only(body, SVGSVGElement, newFigure);
        const path = figure.firstElementChild!;
        const d = shapePath(shape, element.width, element.height, element);
        figure.setAttribute(
          "viewBox",
          `0 0 ${element.width} ${element.height}`,
        );
        path.setAttribute("d", d);
        path.setAttribute("fill", color ?? "none");
        // At twice its width, cut to the shape: a border inside its edge
        path.setAttribute("stroke", border?.color ?? "none");
        path.setAttribute("stroke-width", String((border?.width ?? 0) * 2));
        figure.style.clipPath = `path("${d}")`;
        break;
      }
      case "viewer": {
        const avatar = only(body, HTMLDivElement, makeAvatar);
        const side = Math.min(element.width, element.height);
        avatar.style.width = `${side}px`;
        avatar.style.height = `${side}px`;
        avatar.style.fontSize = `${side * 0.45}px`;
        // Half its side at 50: a circle
        avatar.style.borderRadius = `${(element.rounding / 100) * side}px`;
        setViewer(avatar, element.src, element.name);
        layoutAvatar(avatar.querySelector("img")!, side, element.crop);
        break;
      }
      case "overlay":
        if (slots) {
          only(body, HTMLDivElement, () => div("studio-slot"));
        } else if (!element.src) {
          body.firstElementChild?.remove();
        } else {
          const frame = only(body, HTMLIFrameElement, newFrame);
          if (frame.getAttribute("src") !== element.src) {
            frame.src = element.src;
          }
        }
        break;
    }
  };

  // The elements whose videos show with the mover: its own, or its group's
  const under = (mover: Mover) =>
    Array.from(entries.values()).filter((entry) =>
      mover.node.contains(entry.body),
    );

  // Stops what it plays or would play next, an exit included
  const halt = (mover: Mover) => {
    clearTimeout(mover.timer);
    mover.timer = undefined;
    mover.shown = false;
    mover.leaving = false;
    clearMotion(mover.node);
  };

  // Its seconds ended: its exit plays, held at its end by its forwards fill
  // until the timer, then it's gone on stream and its videos pause. The
  // editor's comes back as it waits, outlined.
  const leave = (mover: Mover) => {
    if (mover.leaving || !mover.motion) return;
    clearTimeout(mover.timer);
    mover.leaving = true;
    restart(mover.node, `studio-exit-${mover.motion.exit}`);
    mover.timer = setTimeout(() => {
      if (!editing) mover.node.classList.add("studio-hidden");
      halt(mover);
      for (const entry of under(mover)) playback(entry);
    }, EXIT_MS);
  };

  // It comes in on its event, for its seconds, its videos from their part's
  // start; mid-exit, it comes in again
  const enter = (mover: Mover, motion: StudioMotion) => {
    clearTimeout(mover.timer);
    mover.shown = true;
    mover.leaving = false;
    mover.node.classList.remove("studio-hidden");
    restart(mover.node, `studio-enter-${motion.entrance}`);
    for (const entry of under(mover)) playback(entry, true);
    mover.timer = setTimeout(() => {
      // An element's video that plays once leaves when its part ends, while
      // it plays (atEnd)
      const { entry } = mover;
      const video = entry && clipOf(entry);
      if (
        entry &&
        once(entry.element) &&
        video &&
        !video.paused &&
        !video.error
      ) {
        return;
      }
      leave(mover);
    }, motion.seconds * 1000);
  };

  // What a react plays: an entrance or an animation. A loop has no trigger.
  const move = (mover: Mover) => {
    const { motion } = mover;
    if (motion?.when === "event") enter(mover, motion);
    else if (motion?.when === "animate") {
      restart(mover.node, `studio-play-${motion.animation}`);
    }
  };

  /**
   * Takes the view's motion, before the videos under it play. A new When
   * starts it over: on screen, waiting (hidden on stream, outlined in the
   * editor), or looping. A view that keeps it leaves it alone, mid-exit
   * too, since views come on every autosave and numbers push: a new
   * entrance, exit or animation plays at the next react.
   */
  const settle = (mover: Mover, motion: StudioMotion) => {
    const before = mover.motion;
    mover.motion = motion;
    if (before?.when !== motion.when) {
      halt(mover);
      mover.node.classList.toggle(
        "studio-hidden",
        !editing && motion.when === "event",
      );
    } else if (motion.when === "loop" && before?.idle !== motion.idle) {
      clearMotion(mover.node);
    }
    // Added only when it's missing, so it never starts over
    const loop = `studio-loop-${motion.idle}`;
    if (motion.when === "loop" && !mover.node.classList.contains(loop)) {
      mover.node.classList.add(loop);
    }
  };

  const newMover = (node: HTMLDivElement): Mover => {
    const mover: Mover = {
      node,
      motion: undefined,
      entry: undefined,
      timer: undefined,
      shown: false,
      leaving: false,
    };
    node.addEventListener("animationend", (event) => {
      // Not an element's inside a group's wrapper, and not an exit's, which
      // holds until its timer
      if (event.target === node && !mover.leaving) clearMotion(node);
    });
    return mover;
  };

  const remove = (entry: Entry) => {
    clearTimeout(entry.mover.timer);
    clearTimeout(entry.cue);
    clearTimeout(entry.letGo);
    entry.body.querySelectorAll("video").forEach(release);
    // Its stream keeps the camera on
    entry.camera?.stop();
    entry.el.remove();
    entries.delete(entry.element.id);
  };

  const create = (
    element: StudioElementView,
    layer: string,
    parent: HTMLElement,
  ): Entry => {
    const el = div(`studio-element studio-${element.kind}`);
    // For tests and devtools to find it
    el.dataset.element = element.id;
    const body = div("studio-body");
    el.appendChild(body);
    parent.appendChild(el);
    const entry: Entry = {
      element,
      layer,
      el,
      body,
      mover: newMover(body),
      cue: undefined,
      done: false,
      cut: undefined,
      still: undefined,
      letGo: undefined,
      camera: undefined,
    };
    entry.mover.entry = entry;
    entries.set(element.id, entry);
    return entry;
  };

  /**
   * The layer's node, made on first use and appended (z-index stacks them),
   * with a group's wrapper made with it. The wrapper takes its box and its
   * motion here, before its elements' videos play: a group that waits keeps
   * them paused.
   */
  const layerOf = (view: StudioLayerView): Layer => {
    let layer = layers.get(view.id);
    if (!layer) {
      const node = div("studio-layer");
      node.dataset.layer = view.id;
      canvas.appendChild(node);
      layer = { node, x: 0, y: 0 };
      if (view.group) {
        layer.group = newMover(div("studio-group"));
        node.appendChild(layer.group.node);
      }
      layers.set(view.id, layer);
    }
    layer.node.style.zIndex = String(view.z);
    layer.node.style.opacity = String(view.opacity);
    const { group } = layer;
    if (group && view.group) {
      const box = groupBox(view.elements);
      layer.x = box.x;
      layer.y = box.y;
      const { style, classList } = group.node;
      style.left = `${box.x}px`;
      style.top = `${box.y}px`;
      style.width = `${box.width}px`;
      style.height = `${box.height}px`;
      classList.toggle("studio-waits", editing && view.group.when === "event");
      settle(group, view.group);
    }
    return layer;
  };

  const update = (view: StudioView | null) => {
    const shown = view?.layers ?? [];
    const ids = new Set(shown.flatMap((l) => l.elements.map((e) => e.id)));
    for (const entry of Array.from(entries.values())) {
      if (!ids.has(entry.element.id)) remove(entry);
    }
    // After the elements, so the videos in a layer that goes are freed
    const layerIds = new Set(shown.map((layer) => layer.id));
    for (const [id, layer] of Array.from(layers)) {
      if (layerIds.has(id)) continue;
      clearTimeout(layer.group?.timer);
      layer.node.remove();
      layers.delete(id);
    }

    const next = view ?? { width: 0, height: 0 };
    if (next.width !== size.width || next.height !== size.height) {
      size = { width: next.width, height: next.height };
      canvas.style.width = `${size.width}px`;
      canvas.style.height = `${size.height}px`;
      refit();
    }

    for (const layer of shown) {
      const { node, group } = layerOf(layer);
      const parent = group?.node ?? node;
      for (const element of layer.elements) {
        let entry = entries.get(element.id);
        if (entry && entry.element.kind !== element.kind) {
          remove(entry);
          entry = undefined;
        }
        if (entry && entry.layer !== layer.id) {
          // Into another layer: the only move, which reloads an embed
          parent.appendChild(entry.el);
          entry.layer = layer.id;
        }
        entry ??= create(element, layer.id, parent);
        entry.element = element;
        fill(entry);
        entry.el.classList.toggle(
          "studio-waits",
          editing && element.when === "event",
        );
        settle(entry.mover, element);
        playback(entry);
      }
    }
  };

  const react = (r: StudioReact) => {
    const entry = entries.get(r.element);
    if (!entry) {
      // A group's, with no values. An element on its own has a layer of its
      // id, with no wrapper.
      const group = layers.get(r.element)?.group;
      if (group) move(group);
      return;
    }
    const { element } = entry;
    if (element.kind === "text" && r.text !== undefined) {
      entry.element = { ...element, text: r.text };
    } else if (element.kind === "viewer") {
      entry.element = {
        ...element,
        src: r.picture ?? element.src,
        name: r.name ?? element.name,
      };
    } else if (
      (element.kind === "gift" || element.kind === "emote") &&
      r.picture !== undefined
    ) {
      // The gift or emote the event sent
      entry.element = { ...element, src: r.picture || null };
    }
    fill(entry);
    move(entry.mover);
    // A moving element's video that plays once plays its part again
    if (element.when === "animate" && once(element)) playback(entry, true);
  };

  // Let in by a click, a browser tab plays the sound it refused
  const hear = () => {
    if (!quiet) return;
    quiet = false;
    for (const entry of Array.from(entries.values())) {
      const video = clipOf(entry);
      if (!video) continue;
      video.muted = silent;
      playback(entry);
    }
  };
  if (!editing) window.addEventListener("click", hear);

  return {
    update,
    react,
    slot: (elementId) =>
      entries
        .get(elementId)
        ?.body.querySelector<HTMLElement>(":scope > .studio-slot") ?? null,
    fit,
    picture: (elementId) => {
      const media = entries
        .get(elementId)
        ?.body.querySelector<HTMLImageElement | HTMLVideoElement>("img, video");
      const own = media ? ownSize(media) : null;
      return own?.width && own.height ? own : null;
    },
    sound: (on) => {
      silent = !on;
      for (const entry of Array.from(entries.values())) {
        const video = clipOf(entry);
        if (video) video.muted = silent || quiet;
      }
    },
    hold: (elementId, seconds) => {
      const entry = entries.get(elementId);
      const video = entry && clipOf(entry);
      if (!entry || !video) return;
      clearTimeout(entry.cue);
      clearTimeout(entry.letGo);
      entry.still = seconds;
      video.pause();
      video.currentTime = seconds;
      entry.letGo = setTimeout(() => {
        entry.still = undefined;
        playback(entry, true);
      }, HOLD_MS);
    },
    replay: (elementId) => {
      const entry = entries.get(elementId);
      if (entry) playback(entry, true);
    },
    destroy: () => {
      if (observer) observer.disconnect();
      else window.removeEventListener("resize", refit);
      window.removeEventListener("click", hear);
      update(null);
      canvas.remove();
      root.classList.remove("studio-stage");
    },
  };
}
