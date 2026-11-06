/*
 * Overlay Studio's one renderer: the served page (/studio/<id>/) and the
 * editor both draw a StudioView with it, in the markup overlay.css describes.
 *
 * Type imports only: main inlines this file into its page through esbuild
 * without bundling it. Nothing newer than Chromium 103, OBS 30's browser.
 */
import type { StudioLayerView, StudioReact, StudioView } from "../types/studio";

export type StageOptions = {
  // The editor's: every embed is an empty, stable element (slot) that React
  // portals its own preview into. Off, an embed is an iframe at its src.
  slots?: boolean;
  // The editor's: layers that wait for an event stay on screen, marked with
  // studio-waits, and a react replays their entrance or animation in place.
  editing?: boolean;
};

// The canvas's scale and its offset inside the root, in the root's px
export type StageFit = { scale: number; left: number; top: number };

export type Stage = {
  // Draws the view, updating each layer's element in place; null clears it
  update(view: StudioView | null): void;
  // Plays a layer's reaction to its trigger, with the new text or picture
  react(r: StudioReact): void;
  // The element an embed's preview goes in, with slots
  slot(layerId: string): HTMLElement | null;
  // Where the canvas sits in the root now
  fit(): StageFit;
  // Removes everything it drew and frees its players
  destroy(): void;
};

type Entry = {
  layer: StudioLayerView;
  el: HTMLDivElement;
  body: HTMLDivElement;
  // Hides a layer that shows on an event, on stream
  timer: ReturnType<typeof setTimeout> | undefined;
  shown: boolean;
};

const ARCHIVO = '"Archivo Variable", sans-serif';
const MOTION = /^studio-(enter|play)-/;

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

const clearMotion = (body: HTMLElement) => {
  for (const name of Array.from(body.classList)) {
    if (MOTION.test(name)) body.classList.remove(name);
  }
};

// Plays the animation from its start, even mid-animation
const restart = (body: HTMLElement, className: string) => {
  clearMotion(body);
  void body.offsetWidth;
  body.classList.add(className);
};

const play = (video: HTMLVideoElement) => {
  const playing = video.play() as Promise<void> | undefined;
  playing?.catch(() => {});
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

const newVideo = () => {
  const video = document.createElement("video");
  video.className = "studio-fill";
  video.muted = true;
  video.loop = true;
  video.autoplay = true;
  video.playsInline = true;
  video.setAttribute("muted", "");
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
function only<T extends HTMLElement>(
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
    avatar.classList.add("studio-has-picture");
    img.src = src;
  }
};

const newAvatar = () => {
  const avatar = div("studio-avatar");
  const img = picture("");
  img.addEventListener("error", () =>
    avatar.classList.remove("studio-has-picture"),
  );
  avatar.append(img, div("studio-initial"));
  return avatar;
};

/**
 * Draws studio overlays into root, its canvas scaled to fit and centered. It
 * keeps one element per layer id and never moves, re-inserts or re-creates
 * one, nor resets an iframe's src, unless that layer's kind or source changed:
 * Chromium reloads a moved iframe, and the view comes again on every autosave
 * and every few hundred ms of live numbers.
 */
export function createStage(
  root: HTMLElement,
  { slots = false, editing = false }: StageOptions = {},
): Stage {
  const canvas = div("studio-canvas");
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

  const hidden = (entry: Entry) =>
    entry.body.classList.contains("studio-hidden");

  // Videos play only while their layer shows
  const playback = (entry: Entry, fromStart = false) => {
    const video = entry.body.querySelector("video");
    if (!video) return;
    if (hidden(entry)) {
      video.pause();
      return;
    }
    if (fromStart) video.currentTime = 0;
    if (video.paused && video.hasAttribute("src")) play(video);
  };

  // Puts the layer's content in its body, made on first use
  const fill = ({ layer, el, body }: Entry) => {
    el.style.left = `${layer.x}px`;
    el.style.top = `${layer.y}px`;
    el.style.width = `${layer.width}px`;
    el.style.height = `${layer.height}px`;
    el.style.zIndex = String(layer.z);
    el.style.opacity = String(layer.opacity);

    switch (layer.kind) {
      case "text": {
        const text = only(body, HTMLDivElement, () => div("studio-text"));
        if (text.textContent !== layer.text) text.textContent = layer.text;
        text.style.fontFamily = fontFamily(layer.font);
        text.style.fontSize = `${layer.size}px`;
        text.style.textAlign = layer.align;
        text.classList.toggle("studio-bold", layer.bold);
        text.classList.toggle("studio-halo", layer.halo);
        el.style.setProperty("--studio-color", layer.color);
        break;
      }
      case "media":
        if (layer.video) {
          setVideo(only(body, HTMLVideoElement, newVideo), layer.src);
        } else {
          setPicture(only(body, HTMLImageElement, newPicture), layer.src);
        }
        break;
      case "gift":
      case "emote":
        setPicture(only(body, HTMLImageElement, newPicture), layer.src);
        break;
      case "shape":
        el.style.setProperty("--studio-color", layer.color);
        el.style.setProperty("--studio-radius", `${layer.radius}px`);
        break;
      case "viewer": {
        const avatar = only(body, HTMLDivElement, newAvatar);
        const side = Math.min(layer.width, layer.height);
        avatar.style.width = `${side}px`;
        avatar.style.height = `${side}px`;
        avatar.style.fontSize = `${side * 0.45}px`;
        setViewer(avatar, layer.src, layer.name);
        break;
      }
      case "overlay":
        if (slots) {
          only(body, HTMLDivElement, () => div("studio-slot"));
        } else if (!layer.src) {
          body.firstElementChild?.remove();
        } else {
          const frame = only(body, HTMLIFrameElement, newFrame);
          if (frame.getAttribute("src") !== layer.src) frame.src = layer.src;
        }
        break;
    }
  };

  const hide = (entry: Entry) => {
    clearTimeout(entry.timer);
    entry.timer = undefined;
    entry.shown = false;
    clearMotion(entry.body);
    entry.body.classList.add("studio-hidden");
    playback(entry);
  };

  // A layer that shows on an event comes in, for its seconds on stream
  const show = (entry: Entry) => {
    entry.body.classList.remove("studio-hidden");
    restart(entry.body, `studio-enter-${entry.layer.entrance}`);
    playback(entry, true);
    if (editing) return;
    clearTimeout(entry.timer);
    entry.shown = true;
    entry.timer = setTimeout(() => hide(entry), entry.layer.seconds * 1000);
  };

  const remove = (entry: Entry) => {
    clearTimeout(entry.timer);
    entry.body.querySelectorAll("video").forEach(release);
    entry.el.remove();
    entries.delete(entry.layer.id);
  };

  const create = (layer: StudioLayerView): Entry => {
    const el = div(`studio-layer studio-${layer.kind}`);
    // For the editor to find the layer under the pointer
    el.dataset.layer = layer.id;
    const body = div("studio-body");
    body.addEventListener("animationend", (event) => {
      if (event.target === body) clearMotion(body);
    });
    el.appendChild(body);
    canvas.appendChild(el);
    const entry = { layer, el, body, timer: undefined, shown: false };
    entries.set(layer.id, entry);
    return entry;
  };

  const update = (view: StudioView | null) => {
    const layers = view?.layers ?? [];
    const ids = new Set(layers.map((layer) => layer.id));
    for (const entry of Array.from(entries.values())) {
      if (!ids.has(entry.layer.id)) remove(entry);
    }

    const next = view ?? { width: 0, height: 0 };
    if (next.width !== size.width || next.height !== size.height) {
      size = { width: next.width, height: next.height };
      canvas.style.width = `${size.width}px`;
      canvas.style.height = `${size.height}px`;
      refit();
    }

    for (const layer of layers) {
      let entry = entries.get(layer.id);
      if (entry && entry.layer.kind !== layer.kind) {
        remove(entry);
        entry = undefined;
      }
      entry ??= create(layer);
      entry.layer = layer;
      fill(entry);

      const waits = layer.when === "event";
      entry.el.classList.toggle("studio-waits", editing && waits);
      if (!editing && !waits) {
        clearTimeout(entry.timer);
        entry.shown = false;
        entry.body.classList.remove("studio-hidden");
      } else if (!editing && !entry.shown) {
        entry.body.classList.add("studio-hidden");
      }
      playback(entry);
    }
  };

  const react = (r: StudioReact) => {
    const entry = entries.get(r.layer);
    if (!entry) return;
    const { layer } = entry;
    if (layer.kind === "text" && r.text !== undefined) {
      entry.layer = { ...layer, text: r.text };
    } else if (layer.kind === "viewer") {
      entry.layer = {
        ...layer,
        src: r.picture ?? layer.src,
        name: r.name ?? layer.name,
      };
    }
    fill(entry);
    if (layer.when === "event") show(entry);
    else if (layer.when === "animate") {
      restart(entry.body, `studio-play-${layer.animation}`);
    }
  };

  return {
    update,
    react,
    slot: (layerId) =>
      entries
        .get(layerId)
        ?.body.querySelector<HTMLElement>(":scope > .studio-slot") ?? null,
    fit,
    destroy: () => {
      if (observer) observer.disconnect();
      else window.removeEventListener("resize", refit);
      update(null);
      canvas.remove();
      root.classList.remove("studio-stage");
    },
  };
}
