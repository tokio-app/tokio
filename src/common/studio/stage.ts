/*
 * Overlay Studio's one renderer: the served page (/studio/<id>/) and the
 * editor both draw a StudioView with it, in the markup overlay.css describes.
 *
 * Type imports only: main inlines this file into its page through esbuild
 * without bundling it. Nothing newer than Chromium 103, OBS 30's browser.
 */
import type {
  StudioElementView,
  StudioReact,
  StudioView,
} from "../types/studio";

export type StageOptions = {
  // The editor's: every embed is an empty, stable element (slot) that React
  // portals its own preview into. Off, an embed is an iframe at its src.
  slots?: boolean;
  // The editor's: elements that wait for an event stay on screen, marked
  // with studio-waits, and a react replays their entrance or animation in
  // place.
  editing?: boolean;
};

// The canvas's scale and its offset inside the root, in the root's px
export type StageFit = { scale: number; left: number; top: number };

export type Stage = {
  // Draws the view, updating each element's node in place; null clears it
  update(view: StudioView | null): void;
  // Plays an element's reaction to its trigger, with the new text or picture
  react(r: StudioReact): void;
  // The node an embed's preview goes in, with slots
  slot(elementId: string): HTMLElement | null;
  // Where the canvas sits in the root now
  fit(): StageFit;
  // Removes everything it drew and frees its players
  destroy(): void;
};

type Entry = {
  element: StudioElementView;
  // The id of the layer it's in
  layer: string;
  el: HTMLDivElement;
  body: HTMLDivElement;
  // Hides an element that shows on an event, on stream
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
  { slots = false, editing = false }: StageOptions = {},
): Stage {
  const canvas = div("studio-canvas");
  // Each layer's node, the whole canvas, by layer id
  const layers = new Map<string, HTMLDivElement>();
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

  const hidden = (entry: Entry) =>
    entry.body.classList.contains("studio-hidden");

  // Videos play only while their element shows
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

  // Puts the element's content in its body, made on first use
  const fill = ({ element, el, body }: Entry) => {
    el.style.left = `${element.x}px`;
    el.style.top = `${element.y}px`;
    el.style.width = `${element.width}px`;
    el.style.height = `${element.height}px`;
    el.style.zIndex = String(element.z);
    el.style.opacity = String(element.opacity);

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
      case "media":
        if (element.video) {
          setVideo(only(body, HTMLVideoElement, newVideo), element.src);
        } else {
          setPicture(only(body, HTMLImageElement, newPicture), element.src);
        }
        break;
      case "gift":
      case "emote":
        setPicture(only(body, HTMLImageElement, newPicture), element.src);
        break;
      case "shape":
        el.style.setProperty("--studio-color", element.color);
        el.style.setProperty("--studio-radius", `${element.radius}px`);
        break;
      case "viewer": {
        const avatar = only(body, HTMLDivElement, newAvatar);
        const side = Math.min(element.width, element.height);
        avatar.style.width = `${side}px`;
        avatar.style.height = `${side}px`;
        avatar.style.fontSize = `${side * 0.45}px`;
        setViewer(avatar, element.src, element.name);
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

  const hide = (entry: Entry) => {
    clearTimeout(entry.timer);
    entry.timer = undefined;
    entry.shown = false;
    clearMotion(entry.body);
    entry.body.classList.add("studio-hidden");
    playback(entry);
  };

  // An element that shows on an event comes in, for its seconds on stream
  const show = (entry: Entry) => {
    entry.body.classList.remove("studio-hidden");
    restart(entry.body, `studio-enter-${entry.element.entrance}`);
    playback(entry, true);
    if (editing) return;
    clearTimeout(entry.timer);
    entry.shown = true;
    entry.timer = setTimeout(() => hide(entry), entry.element.seconds * 1000);
  };

  const remove = (entry: Entry) => {
    clearTimeout(entry.timer);
    entry.body.querySelectorAll("video").forEach(release);
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
    body.addEventListener("animationend", (event) => {
      if (event.target === body) clearMotion(body);
    });
    el.appendChild(body);
    parent.appendChild(el);
    const entry = { element, layer, el, body, timer: undefined, shown: false };
    entries.set(element.id, entry);
    return entry;
  };

  // The layer's node, made on first use and appended: z-index stacks them
  const layerNode = (id: string, z: number) => {
    let node = layers.get(id);
    if (!node) {
      node = div("studio-layer");
      node.dataset.layer = id;
      canvas.appendChild(node);
      layers.set(id, node);
    }
    node.style.zIndex = String(z);
    return node;
  };

  const update = (view: StudioView | null) => {
    const shown = view?.layers ?? [];
    const ids = new Set(shown.flatMap((l) => l.elements.map((e) => e.id)));
    for (const entry of Array.from(entries.values())) {
      if (!ids.has(entry.element.id)) remove(entry);
    }
    // After the elements, so the videos in a layer that goes are freed
    const layerIds = new Set(shown.map((layer) => layer.id));
    for (const [id, node] of Array.from(layers)) {
      if (layerIds.has(id)) continue;
      node.remove();
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
      const parent = layerNode(layer.id, layer.z);
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

        const waits = element.when === "event";
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
    }
  };

  const react = (r: StudioReact) => {
    const entry = entries.get(r.element);
    if (!entry) return;
    const { element } = entry;
    if (element.kind === "text" && r.text !== undefined) {
      entry.element = { ...element, text: r.text };
    } else if (element.kind === "viewer") {
      entry.element = {
        ...element,
        src: r.picture ?? element.src,
        name: r.name ?? element.name,
      };
    }
    fill(entry);
    if (element.when === "event") show(entry);
    else if (element.when === "animate") {
      restart(entry.body, `studio-play-${element.animation}`);
    }
  };

  return {
    update,
    react,
    slot: (elementId) =>
      entries
        .get(elementId)
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
