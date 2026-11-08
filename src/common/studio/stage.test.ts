// @vitest-environment jsdom
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  MockInstance,
  vi,
} from "vitest";
import type {
  StudioElementView,
  StudioLayerView,
  StudioView,
} from "../types/studio";
import { createStage, Figure, shapePath, Stage } from "./stage";

type TextView = Extract<StudioElementView, { kind: "text" }>;
type ShapeView = Extract<StudioElementView, { kind: "shape" }>;

const BASE: Omit<TextView, "id" | "kind" | keyof typeof TEXT> = {
  x: 10,
  y: 20,
  width: 300,
  height: 200,
  rotation: 0,
  flip_x: false,
  flip_y: false,
  z: 0,
  opacity: 1,
  when: "always",
  seconds: 5,
  entrance: "pop",
  animation: "bounce",
};

const TEXT = {
  text: "Hi",
  font: "",
  size: 64,
  color: "#f1f5f9",
  align: "center",
  bold: true,
  halo: true,
} as const;

// What a picture element draws when it keeps all of itself
const PICTURE = { crop: null, rounding: 0 };
// A shape element's rectangle
const RECTANGLE = { shape: "rectangle", sides: 3, points: 5 } as const;

// A media element's whole video, looping at full volume
const MEDIA = { start: 0, end: null, loop: true, volume: 100 };

const text = (id: string, fields: Partial<TextView> = {}): TextView => ({
  ...BASE,
  ...TEXT,
  id,
  kind: "text",
  ...fields,
});

// A canvas of layers, back to front
const layered = (...layers: StudioLayerView[]): StudioView => ({
  width: 1080,
  height: 1920,
  layers,
});

// A canvas of one layer holding the elements
const view = (...elements: StudioElementView[]): StudioView =>
  layered({ id: "l", z: 0, opacity: 1, elements });

let root: HTMLElement;
let stage: Stage;
const el = (id: string) =>
  root.querySelector<HTMLElement>(`[data-element="${id}"]`)!;
const layerNode = (id: string) =>
  root.querySelector<HTMLElement>(`[data-layer="${id}"]`)!;
const draw = (v: StudioView | null) => stage.update(v);

const body = (id: string) => el(id).querySelector<HTMLElement>(".studio-body")!;

let play: MockInstance;
let load: MockInstance;

beforeEach(() => {
  play = vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue();
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
  load = vi
    .spyOn(HTMLMediaElement.prototype, "load")
    .mockImplementation(() => {});
  root = document.createElement("div");
  document.body.append(root);
});

afterEach(() => {
  stage.destroy();
  root.remove();
  vi.useRealTimers();
});

describe("on stream", () => {
  beforeEach(() => {
    stage = createStage(root);
  });

  it("draws each element in its box, stacked by z", () => {
    draw(
      view(
        {
          ...BASE,
          id: "shape",
          kind: "shape",
          ...RECTANGLE,
          color: "#18181b",
          radius: 24,
          border: null,
        },
        text("text", { z: 1, opacity: 0.5, text: "<b>{username}</b>" }),
      ),
    );

    const shape = el("shape");
    expect(shape).toHaveProperty("className", "studio-element studio-shape");
    expect(shape.style.left).toBe("10px");
    expect(shape.style.getPropertyValue("--studio-radius")).toBe("24px");
    const label = el("text");
    expect(label.style.zIndex).toBe("1");
    expect(label.style.opacity).toBe("0.5");
    const words = label.querySelector<HTMLElement>(".studio-text")!;
    expect(words.textContent).toBe("<b>{username}</b>");
    expect(words.querySelector("b")).toBeNull();
    expect(words.className).toBe("studio-text studio-bold studio-halo");
  });

  it("turns an element around its center, and back", () => {
    draw(view(text("t", { rotation: 30 })));
    expect(el("t").style.transform).toBe("rotate(30deg)");

    draw(view(text("t")));
    expect(el("t").style.transform).toBe("");
  });

  it("flips an element along its own sides, before it turns", () => {
    draw(view(text("t", { flip_x: true })));
    expect(el("t").style.transform).toBe("scale(-1, 1)");

    draw(view(text("t", { flip_y: true, rotation: 30 })));
    expect(el("t").style.transform).toBe("rotate(30deg) scale(1, -1)");

    draw(view(text("t")));
    expect(el("t").style.transform).toBe("");
  });

  it("sets a font as one quoted name, Archivo for none", () => {
    draw(view(text("named", { font: 'Comic"; color: red' }), text("plain")));

    const font = (id: string) =>
      el(id).querySelector<HTMLElement>(".studio-text")!.style.fontFamily;
    expect(font("named")).toContain('"Comic\\"; color: red"');
    expect(font("plain")).toContain("Archivo Variable");
  });

  it("stacks each layer over the whole canvas, its elements inside it", () => {
    draw(
      layered(
        { id: "back", z: 0, opacity: 1, elements: [text("a")] },
        {
          id: "front",
          z: 2,
          opacity: 1,
          elements: [text("b"), text("c", { z: 1 })],
        },
      ),
    );

    expect(layerNode("back").style.zIndex).toBe("0");
    expect(layerNode("front").style.zIndex).toBe("2");
    expect(layerNode("front").className).toBe("studio-layer");
    expect(el("a").parentElement).toBe(layerNode("back"));
    expect(el("c").parentElement).toBe(layerNode("front"));
    expect(el("c").style.zIndex).toBe("1");
  });

  it("moves an element into its new layer, and a layer that goes takes its elements", () => {
    const clip: StudioElementView = {
      ...BASE,
      id: "clip",
      kind: "media",
      ...MEDIA,
      ...PICTURE,
      src: "/m/a.mp4",
      video: true,
    };
    draw(
      layered(
        { id: "back", z: 0, opacity: 1, elements: [text("a")] },
        { id: "front", z: 1, opacity: 1, elements: [clip] },
      ),
    );
    const a = el("a");

    draw(
      layered(
        { id: "back", z: 0, opacity: 1, elements: [] },
        { id: "front", z: 1, opacity: 1, elements: [clip, text("a")] },
      ),
    );
    expect(el("a")).toBe(a);
    expect(a.parentElement).toBe(layerNode("front"));

    const video = root.querySelector("video")!;
    draw(layered({ id: "back", z: 0, opacity: 1, elements: [] }));

    expect(root.querySelector("[data-layer='front']")).toBeNull();
    expect(root.querySelectorAll(".studio-element")).toHaveLength(0);
    expect(video.hasAttribute("src")).toBe(false);
  });

  it("keeps each element and an embed's iframe through updates and reorders", () => {
    const jar: StudioElementView = {
      ...BASE,
      id: "jar",
      kind: "overlay",
      source: { type: "installed", id: "gift-jar" },
      src: "/gift-jar/",
      label: "Gift Jar",
    };
    draw(view(jar, text("text", { z: 1 })));
    const frame = root.querySelector("iframe")!;
    const before = el("jar");

    draw(view(text("text", { z: 0, text: "Moved" }), { ...jar, z: 1 }));

    expect(root.querySelector("iframe")).toBe(frame);
    expect(el("jar")).toBe(before);
    expect(frame.getAttribute("src")).toBe("/gift-jar/");
    expect(before.style.zIndex).toBe("1");
  });

  it("draws an embed that can't load as nothing, and makes a new element for a new kind", () => {
    draw(
      view({
        ...BASE,
        id: "a",
        kind: "overlay",
        source: null,
        src: null,
        label: "",
      }),
    );
    expect(root.querySelector("iframe")).toBeNull();
    const before = el("a");

    draw(view(text("a")));

    expect(root.querySelector(".studio-element")).not.toBe(before);
    expect(root.querySelectorAll(".studio-element")).toHaveLength(1);
  });

  it("hides a picture that fails, and shows a new one", () => {
    draw(
      view({
        ...BASE,
        id: "g",
        kind: "gift",
        ...PICTURE,
        src: "https://g/rose.png",
      }),
    );
    const img = root.querySelector("img")!;

    img.dispatchEvent(new Event("error"));
    expect(img.classList).toContain("studio-failed");

    draw(
      view({
        ...BASE,
        id: "g",
        kind: "gift",
        ...PICTURE,
        src: "https://g/lion.png",
      }),
    );
    expect(img.classList).not.toContain("studio-failed");
    expect(img.getAttribute("src")).toBe("https://g/lion.png");
  });

  it("shows a viewer's initial without a picture or once it fails", () => {
    const viewer = (src: string, name = "🌸sora"): StudioElementView => ({
      ...BASE,
      id: "v",
      kind: "viewer",
      ...PICTURE,
      src,
      name,
    });
    draw(view(viewer("")));
    const avatar = root.querySelector<HTMLElement>(".studio-avatar")!;

    expect(avatar.querySelector(".studio-initial")!.textContent).toBe("🌸");
    expect(avatar.classList).not.toContain("studio-has-picture");
    expect(avatar.style.width).toBe("200px");

    draw(view(viewer("https://p/sora.webp", "sora")));
    // The initial until the picture loads
    expect(avatar.classList).not.toContain("studio-has-picture");
    avatar.querySelector("img")!.dispatchEvent(new Event("load"));
    expect(avatar.classList).toContain("studio-has-picture");
    avatar.querySelector("img")!.dispatchEvent(new Event("error"));
    expect(avatar.classList).not.toContain("studio-has-picture");
    expect(avatar.querySelector(".studio-initial")!.textContent).toBe("S");
  });

  it("frees a video's player when its element goes", () => {
    draw(
      view({
        ...BASE,
        id: "clip",
        kind: "media",
        ...MEDIA,
        ...PICTURE,
        src: "/m/a.mp4",
        video: true,
      }),
    );
    const video = root.querySelector("video")!;
    expect(video.getAttribute("src")).toBe("/m/a.mp4");

    draw(view());

    expect(video.hasAttribute("src")).toBe(false);
    expect(load).toHaveBeenCalled();
  });

  it("shows an element on its event for its seconds, then hides it", () => {
    vi.useFakeTimers();
    draw(view(text("t", { when: "event", seconds: 3, entrance: "slide" })));
    expect(body("t").classList).toContain("studio-hidden");

    stage.react({ element: "t", text: "Thanks Sora" });
    expect(body("t").className).toBe("studio-body studio-enter-slide");
    expect(el("t").textContent).toBe("Thanks Sora");

    // Another event restarts its time, with the new text
    vi.advanceTimersByTime(2000);
    stage.react({ element: "t", text: "Thanks Kai" });
    vi.advanceTimersByTime(2000);
    expect(body("t").classList).not.toContain("studio-hidden");
    expect(el("t").textContent).toBe("Thanks Kai");

    // Updates while it shows keep it on screen
    draw(view(text("t", { when: "event", seconds: 3, text: "Thanks Kai" })));
    expect(body("t").classList).not.toContain("studio-hidden");

    vi.advanceTimersByTime(1000);
    expect(body("t").className).toBe("studio-body studio-hidden");
  });

  it("starts a video over each time its element shows", () => {
    draw(
      view({
        ...BASE,
        id: "clip",
        kind: "media",
        ...MEDIA,
        ...PICTURE,
        src: "/m/a.mp4",
        video: true,
        when: "event",
      }),
    );
    const video = root.querySelector("video")!;
    video.currentTime = 4;

    stage.react({ element: "clip" });

    expect(video.currentTime).toBe(0);
    expect(play).toHaveBeenCalled();
  });

  it("plays a moving element's animation again on each event, with the new picture", () => {
    draw(
      view({
        ...BASE,
        id: "v",
        kind: "viewer",
        ...PICTURE,
        src: "",
        name: "",
        when: "animate",
        animation: "shake",
      }),
    );

    stage.react({ element: "v", picture: "https://p/kai.webp", name: "Kai" });
    expect(body("v").className).toBe("studio-body studio-play-shake");
    expect(root.querySelector("img")!.getAttribute("src")).toBe(
      "https://p/kai.webp",
    );

    body("v").classList.add("studio-enter-pop");
    stage.react({ element: "v" });
    expect(body("v").className).toBe("studio-body studio-play-shake");
    expect(body("v").classList).not.toContain("studio-hidden");
  });

  it("fades a group's layer by its opacity", () => {
    draw(layered({ id: "g", z: 0, opacity: 0.5, elements: [text("t")] }));

    expect(layerNode("g").style.opacity).toBe("0.5");
  });

  it("draws a shape's border inside it, and no fill when it has none", () => {
    draw(
      view({
        ...BASE,
        id: "s",
        kind: "shape",
        ...RECTANGLE,
        color: null,
        radius: 0,
        border: { color: "#445566", width: 8 },
      }),
    );

    expect(el("s").style.getPropertyValue("--studio-color")).toBe(
      "transparent",
    );
    expect(el("s").style.getPropertyValue("--studio-border")).toBe(
      "8px solid #445566",
    );
  });

  it("draws an ellipse as its painted body, and the other shapes as one path", () => {
    const shape = (fields: Partial<ShapeView>): ShapeView => ({
      ...BASE,
      id: "s",
      kind: "shape",
      ...RECTANGLE,
      color: "#18181b",
      radius: 24,
      border: null,
      ...fields,
    });
    draw(view(shape({ shape: "ellipse" })));
    expect(el("s").style.getPropertyValue("--studio-radius")).toBe("50%");
    expect(el("s").querySelector("svg")).toBeNull();

    // A triangle in its 300 × 200 box, bordered inside its edge
    draw(
      view(
        shape({
          shape: "polygon",
          sides: 3,
          border: { color: "#445566", width: 8 },
        }),
      ),
    );
    const figure = el("s").querySelector("svg")!;
    const path = figure.querySelector("path")!;
    expect(figure.getAttribute("class")).toBe("studio-figure");
    expect(figure.getAttribute("viewBox")).toBe("0 0 300 200");
    expect(path.getAttribute("d")).toBe("M150 0L300 200L0 200Z");
    expect(path.getAttribute("fill")).toBe("#18181b");
    expect(path.getAttribute("stroke")).toBe("#445566");
    expect(path.getAttribute("stroke-width")).toBe("16");
    expect(figure.style.clipPath).toBe('path("M150 0L300 200L0 200Z")');
    // The body's own paint stays off
    expect(el("s").style.getPropertyValue("--studio-color")).toBe(
      "transparent",
    );
    expect(el("s").style.getPropertyValue("--studio-border")).toBe("none");

    draw(view(shape({ shape: "heart", color: null })));
    expect(el("s").querySelector("svg")).toBe(figure);
    expect(path.getAttribute("fill")).toBe("none");
    expect(path.getAttribute("stroke")).toBe("none");

    draw(view(shape({ shape: "rectangle" })));
    expect(el("s").querySelector("svg")).toBeNull();
    expect(el("s").style.getPropertyValue("--studio-radius")).toBe("24px");
  });

  it("shows on an emote element the emote its event sent", () => {
    draw(
      view({
        ...BASE,
        id: "e",
        kind: "emote",
        ...PICTURE,
        src: null,
        when: "event",
      }),
    );

    stage.react({ element: "e", picture: "https://e/1.png" });
    expect(root.querySelector("img")!.getAttribute("src")).toBe(
      "https://e/1.png",
    );
  });

  it("shows on a gift element the gift its event sent", () => {
    draw(
      view({
        ...BASE,
        id: "g",
        kind: "gift",
        ...PICTURE,
        src: null,
        when: "event",
      }),
    );

    stage.react({ element: "g", picture: "https://g/lion.png" });
    expect(root.querySelector("img")!.getAttribute("src")).toBe(
      "https://g/lion.png",
    );
  });

  it("scales the canvas to fit the root, centered, and again on resize", () => {
    const size = { width: 540, height: 1080 };
    Object.defineProperty(root, "clientWidth", { get: () => size.width });
    Object.defineProperty(root, "clientHeight", { get: () => size.height });
    draw(view());

    expect(stage.fit()).toEqual({ scale: 0.5, left: 0, top: 60 });

    size.width = 1000;
    window.dispatchEvent(new Event("resize"));

    expect(stage.fit()).toEqual({ scale: 0.5625, left: 196.25, top: 0 });
    expect(root.querySelector<HTMLElement>(".studio-canvas")!.style).toEqual(
      expect.objectContaining({
        width: "1080px",
        transform: "translate(196.25px, 0px) scale(0.5625)",
      }),
    );
  });

  it("clears for a null view, and destroy takes everything away", () => {
    draw(view(text("t")));
    draw(null);
    expect(root.querySelectorAll(".studio-layer")).toHaveLength(0);
    expect(root.querySelectorAll(".studio-element")).toHaveLength(0);

    stage.destroy();
    expect(root.innerHTML).toBe("");
    expect(root.classList).not.toContain("studio-stage");
  });
});

describe("cropped and rounded pictures", () => {
  beforeEach(() => {
    stage = createStage(root);
  });

  // A picture's own size, as it reads once it loads
  const ownSize = (media: Element, width: number, height: number) => {
    const [w, h] =
      media instanceof HTMLVideoElement
        ? ["videoWidth", "videoHeight"]
        : ["naturalWidth", "naturalHeight"];
    Object.defineProperty(media, w, { value: width, configurable: true });
    Object.defineProperty(media, h, { value: height, configurable: true });
  };
  // Its left half and its bottom half cut away, in a 300 × 200 box
  const CROP = { left: 0.25, top: 0, right: 0.25, bottom: 0.5 };
  const placed = (media: HTMLElement) => {
    const { left, top, width, height, clipPath, visibility } = media.style;
    return { left, top, width, height, clipPath, visibility };
  };

  it("lays a cropped picture out once its size is read, clipped to what it keeps", () => {
    draw(
      view({
        ...BASE,
        id: "m",
        kind: "media",
        ...MEDIA,
        src: "/media/m.png",
        video: false,
        crop: CROP,
        rounding: 10,
      }),
    );
    const img = el("m").querySelector("img")!;

    // Never uncut, not even before it loads
    expect(img.classList).toContain("studio-cut");
    expect(img.style.visibility).toBe("hidden");
    expect(stage.picture("m")).toBeNull();

    ownSize(img, 400, 200);
    img.dispatchEvent(new Event("load"));
    // The 200 × 100 it keeps, at 1.5 to fit 300 wide, 25 down to center it
    expect(placed(img)).toEqual({
      left: "-150px",
      top: "25px",
      width: "600px",
      height: "300px",
      clipPath: "inset(0px 150px 150px 150px round 15px)",
      visibility: "",
    });
    expect(stage.picture("m")).toEqual({ width: 400, height: 200 });

    // Uncut again, the stylesheet's contain
    draw(
      view({
        ...BASE,
        id: "m",
        kind: "media",
        ...MEDIA,
        src: "/media/m.png",
        video: false,
        ...PICTURE,
      }),
    );
    expect(img.classList).not.toContain("studio-cut");
    expect(img.hasAttribute("style")).toBe(false);
  });

  it("rounds a whole picture's corners, and lays out a video once it knows its size", () => {
    draw(
      view({
        ...BASE,
        id: "v",
        kind: "media",
        ...MEDIA,
        src: "/media/v.webm",
        video: true,
        crop: null,
        rounding: 50,
      }),
    );
    const video = el("v").querySelector("video")!;
    ownSize(video, 200, 200);
    video.dispatchEvent(new Event("loadedmetadata"));

    // Square in a 300 × 200 box: 200 wide, 50 in, a circle
    expect(placed(video)).toMatchObject({
      left: "50px",
      top: "0px",
      width: "200px",
      clipPath: "inset(0px 0px 0px 0px round 100px)",
    });
  });

  it("lays a gift out again when the one a viewer sends loads", () => {
    draw(
      view({
        ...BASE,
        id: "g",
        kind: "gift",
        src: null,
        when: "event",
        crop: CROP,
        rounding: 0,
      }),
    );
    const img = el("g").querySelector("img")!;
    stage.react({ element: "g", picture: "https://g/lion.png" });
    expect(img.style.visibility).toBe("hidden");

    ownSize(img, 200, 200);
    img.dispatchEvent(new Event("load"));
    // 100 × 100 kept, at 2 to fit 200 tall, centered 50 in
    expect(placed(img)).toMatchObject({
      left: "-50px",
      top: "0px",
      width: "400px",
      height: "400px",
    });
  });

  it("rounds a viewer's circle by its rounding, and covers it with what it keeps", () => {
    draw(
      view({
        ...BASE,
        id: "v",
        kind: "viewer",
        src: "https://p/sora.webp",
        name: "sora",
        crop: { left: 0.5, top: 0, right: 0, bottom: 0 },
        rounding: 25,
      }),
    );
    const avatar = root.querySelector<HTMLElement>(".studio-avatar")!;
    const img = avatar.querySelector("img")!;
    // A quarter of its 200 px side
    expect(avatar.style.borderRadius).toBe("50px");

    ownSize(img, 100, 100);
    img.dispatchEvent(new Event("load"));
    // Its right half, 50 × 100, covering 200 × 200 at 4
    expect(placed(img)).toMatchObject({
      left: "-200px",
      top: "-100px",
      width: "400px",
      height: "400px",
    });
  });
});

// What the stage reads of a video's playback, which play, pause and a seek
// change as a browser would
type Playback = {
  paused: boolean;
  ended: boolean;
  duration: number;
  currentTime: number;
};
const playbacks = new WeakMap<HTMLMediaElement, Playback>();
const playbackOf = (media: HTMLMediaElement) => {
  let state = playbacks.get(media);
  if (!state) {
    state = { paused: true, ended: false, duration: NaN, currentTime: 0 };
    playbacks.set(media, state);
  }
  return state;
};

const fakePlayers = () => {
  for (const key of ["paused", "ended", "duration"] as const) {
    vi.spyOn(HTMLMediaElement.prototype, key, "get").mockImplementation(
      function (this: HTMLMediaElement) {
        return playbackOf(this)[key];
      },
    );
  }
  vi.spyOn(HTMLMediaElement.prototype, "currentTime", "get").mockImplementation(
    function (this: HTMLMediaElement) {
      return playbackOf(this).currentTime;
    },
  );
  vi.spyOn(HTMLMediaElement.prototype, "currentTime", "set").mockImplementation(
    function (this: HTMLMediaElement, time: number) {
      Object.assign(playbackOf(this), { currentTime: time, ended: false });
    },
  );
  play.mockImplementation(function (this: HTMLMediaElement) {
    Object.assign(playbackOf(this), { paused: false, ended: false });
    return Promise.resolve();
  });
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(function (
    this: HTMLMediaElement,
  ) {
    playbackOf(this).paused = true;
  });
};

type MediaView = Extract<StudioElementView, { kind: "media" }>;

// A video element, its src by its id
const clip = (id: string, fields: Partial<MediaView> = {}): MediaView => ({
  ...BASE,
  ...MEDIA,
  ...PICTURE,
  id,
  kind: "media",
  src: `/m/${id}.webm`,
  video: true,
  ...fields,
});

const videoOf = (id: string) => el(id).querySelector("video")!;

// Its length read, then playing, as the browser tells it
const loaded = (video: HTMLVideoElement, duration: number) => {
  playbackOf(video).duration = duration;
  video.dispatchEvent(new Event("loadedmetadata"));
  video.dispatchEvent(new Event("playing"));
};

// At its own end: paused there, then `ended`
const ends = (video: HTMLVideoElement) => {
  const state = playbackOf(video);
  Object.assign(state, {
    currentTime: state.duration,
    paused: true,
    ended: true,
  });
  video.dispatchEvent(new Event("ended"));
};

describe("videos", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    fakePlayers();
    stage = createStage(root);
  });

  it("starts at its cut, and plays it again at its end, by its own clock", () => {
    draw(view(clip("c", { start: 2, end: 5 })));
    const video = videoOf("c");
    expect(video.currentTime).toBe(2);
    // The browser's own loop would go back to 0
    expect(video.loop).toBe(false);

    loaded(video, 10);
    // Its clock lags behind the timer: it waits for the rest
    playbackOf(video).currentTime = 4.5;
    vi.advanceTimersByTime(3000);
    expect(video.currentTime).toBe(4.5);

    playbackOf(video).currentTime = 5;
    vi.advanceTimersByTime(500);
    expect(video.currentTime).toBe(2);
    expect(video.paused).toBe(false);
  });

  it("loops an uncut video as the browser does, and a cut to its end on ended", () => {
    draw(view(clip("c")));
    const video = videoOf("c");
    expect(video.loop).toBe(true);

    draw(view(clip("c", { start: 3 })));
    expect(video.loop).toBe(false);
    loaded(video, 10);
    // Its end is the video's own, so no timer waits for it
    expect(vi.getTimerCount()).toBe(0);

    ends(video);
    expect(video.currentTime).toBe(3);
    expect(video.paused).toBe(false);
  });

  it("times nothing for a video of unknown length", () => {
    draw(view(clip("c", { start: 1 })));
    loaded(videoOf("c"), Infinity);

    expect(vi.getTimerCount()).toBe(0);
  });

  it("without loop, stops at its cut's end until the cut or loop changes", () => {
    draw(view(clip("c", { start: 1, end: 4, loop: false })));
    const video = videoOf("c");
    loaded(video, 10);
    playbackOf(video).currentTime = 4;
    vi.advanceTimersByTime(3000);
    expect(video.paused).toBe(true);
    expect(video.currentTime).toBe(4);

    // Every update leaves it there
    play.mockClear();
    draw(view(clip("c", { start: 1, end: 4, loop: false })));
    expect(play).not.toHaveBeenCalled();

    draw(view(clip("c", { start: 1, end: 3, loop: false })));
    expect(video.currentTime).toBe(1);
    expect(play).toHaveBeenCalledTimes(1);

    ends(video);
    draw(view(clip("c", { start: 1, end: 3 })));
    expect(video.currentTime).toBe(1);
    expect(play).toHaveBeenCalledTimes(2);
  });

  it("shows an event's video without loop until its cut ends, past its seconds", () => {
    draw(view(clip("c", { when: "event", seconds: 2, end: 6, loop: false })));
    const video = videoOf("c");
    playbackOf(video).duration = 10;
    video.dispatchEvent(new Event("loadedmetadata"));
    expect(body("c").classList).toContain("studio-hidden");
    expect(video.paused).toBe(true);

    stage.react({ element: "c" });
    video.dispatchEvent(new Event("playing"));
    vi.advanceTimersByTime(2000);
    expect(body("c").classList).not.toContain("studio-hidden");

    playbackOf(video).currentTime = 6;
    vi.advanceTimersByTime(4000);
    expect(body("c").classList).toContain("studio-hidden");
    expect(video.paused).toBe(true);
  });

  it("keeps an event's video shown when its last end arrives after a react", () => {
    draw(view(clip("c", { when: "event", seconds: 30, loop: false })));
    const video = videoOf("c");
    stage.react({ element: "c" });
    loaded(video, 10);

    // At its end, a react seeks it back before `ended` arrives
    Object.assign(playbackOf(video), { currentTime: 10, ended: true });
    stage.react({ element: "c" });
    video.dispatchEvent(new Event("ended"));

    expect(body("c").classList).not.toContain("studio-hidden");
    expect(video.currentTime).toBe(0);
    expect(video.paused).toBe(false);
  });

  it("hides an event's video without loop after its seconds if it never played", () => {
    play.mockImplementation(() => Promise.resolve());
    draw(view(clip("c", { when: "event", seconds: 2, loop: false })));

    stage.react({ element: "c" });
    vi.advanceTimersByTime(2000);

    expect(body("c").classList).toContain("studio-hidden");
  });

  it("plays a moving element's video without loop again on each event", () => {
    draw(view(clip("c", { when: "animate", start: 2, end: 4, loop: false })));
    const video = videoOf("c");
    loaded(video, 10);
    playbackOf(video).currentTime = 4;
    vi.advanceTimersByTime(2000);
    expect(video.paused).toBe(true);

    stage.react({ element: "c" });

    expect(video.currentTime).toBe(2);
    expect(video.paused).toBe(false);
  });

  it("plays the whole video when its start is past its length", () => {
    draw(view(clip("c", { start: 30, loop: false })));
    const video = videoOf("c");
    expect(video.currentTime).toBe(30);

    // The browser stops the seek at its end
    playbackOf(video).currentTime = 10;
    loaded(video, 10);

    expect(video.currentTime).toBe(0);
    expect(video.paused).toBe(false);
  });

  it("plays its sound at its volume", () => {
    draw(view(clip("c", { volume: 40 })));
    const video = videoOf("c");

    expect(video.volume).toBe(0.4);
    expect(video.muted).toBe(false);
  });

  it("plays muted when the browser refuses sound, until a click", async () => {
    play.mockRejectedValueOnce(new DOMException("", "NotAllowedError"));
    draw(view(clip("a")));
    const a = videoOf("a");
    await vi.waitFor(() => expect(a.muted).toBe(true));
    expect(play).toHaveBeenCalledTimes(2);

    // The page's policy: the next one starts muted
    draw(view(clip("a"), clip("b")));
    expect(videoOf("b").muted).toBe(true);

    window.dispatchEvent(new MouseEvent("click"));
    expect(a.muted).toBe(false);
    expect(videoOf("b").muted).toBe(false);
  });
});

describe("in the editor", () => {
  beforeEach(() => {
    stage = createStage(root, { slots: true, editing: true });
  });

  it("keeps its videos silent until its sound is on", () => {
    draw(view(clip("a")));
    expect(videoOf("a").muted).toBe(true);

    stage.sound(true);
    expect(videoOf("a").muted).toBe(false);
    draw(view(clip("a"), clip("b")));
    expect(videoOf("b").muted).toBe(false);

    stage.sound(false);
    expect(videoOf("a").muted).toBe(true);
    expect(videoOf("b").muted).toBe(true);
  });

  it("holds a video on a cut's frame while its handle moves, then plays its cut again", () => {
    vi.useFakeTimers();
    fakePlayers();
    draw(view(clip("c", { start: 1, end: 3 })));
    const video = videoOf("c");
    loaded(video, 10);

    // The end dragged to 3.5: held there, its new cut drawn on that frame
    stage.hold("c", 3.5);
    draw(view(clip("c", { start: 1, end: 3.5 })));
    expect(video.paused).toBe(true);
    expect(video.currentTime).toBe(3.5);

    // Each move holds it a while longer
    vi.advanceTimersByTime(400);
    stage.hold("c", 3.2);
    draw(view(clip("c", { start: 1, end: 3.2 })));
    vi.advanceTimersByTime(400);
    expect(video.paused).toBe(true);
    expect(video.currentTime).toBe(3.2);

    vi.advanceTimersByTime(200);
    expect(video.currentTime).toBe(1);
    expect(video.paused).toBe(false);
  });

  it("plays a video without loop again when asked, once it stopped at its end", () => {
    vi.useFakeTimers();
    fakePlayers();
    draw(view(clip("c", { start: 1, end: 3, loop: false })));
    const video = videoOf("c");
    loaded(video, 10);
    playbackOf(video).currentTime = 3;
    vi.advanceTimersByTime(2000);
    expect(video.paused).toBe(true);

    stage.replay("c");

    expect(video.currentTime).toBe(1);
    expect(video.paused).toBe(false);
  });

  it("keeps an event's video without loop on screen at its end, and Test plays it again", () => {
    vi.useFakeTimers();
    fakePlayers();
    draw(view(clip("c", { when: "event", end: 3, loop: false })));
    const video = videoOf("c");
    loaded(video, 10);

    stage.react({ element: "c" });
    video.dispatchEvent(new Event("playing"));
    playbackOf(video).currentTime = 3;
    vi.advanceTimersByTime(3000);
    expect(video.paused).toBe(true);
    expect(body("c").classList).not.toContain("studio-hidden");

    stage.react({ element: "c" });
    expect(video.currentTime).toBe(0);
    expect(video.paused).toBe(false);
  });

  it("gives every embed a stable slot, and no iframe", () => {
    const embed = (src: string | null): StudioElementView => ({
      ...BASE,
      id: "timer",
      kind: "overlay",
      source: { type: "timer" },
      src,
      label: "Timer",
    });
    draw(view(embed("/timer/")));
    const slot = stage.slot("timer");

    draw(view(embed(null)));

    expect(slot).toHaveProperty("className", "studio-slot");
    expect(stage.slot("timer")).toBe(slot);
    expect(root.querySelector("iframe")).toBeNull();
    expect(stage.slot("nope")).toBeNull();
  });

  it("keeps an element that waits for an event on screen, marked, and replays it in place", () => {
    vi.useFakeTimers();
    draw(view(text("t", { when: "event", entrance: "fade" })));

    expect(el("t").classList).toContain("studio-waits");
    expect(body("t").classList).not.toContain("studio-hidden");

    stage.react({ element: "t", text: "Thanks Sora" });
    expect(body("t").className).toBe("studio-body studio-enter-fade");

    vi.advanceTimersByTime(60_000);
    expect(body("t").classList).not.toContain("studio-hidden");
  });
});

describe("shapePath", () => {
  const COUNTS = { sides: 6, points: 5, radius: 24 };
  // The smallest and largest x and y a path's numbers reach, read in pairs
  const bounds = (d: string) => {
    const numbers = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
    const xs = numbers.filter((_, i) => i % 2 === 0);
    const ys = numbers.filter((_, i) => i % 2 === 1);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  };

  it("fills its box edge to edge", () => {
    const shapes: Figure[] = ["polygon", "star", "arrow", "heart"];
    for (const shape of shapes) {
      expect(bounds(shapePath(shape, 300, 200, COUNTS))).toEqual([
        0, 0, 300, 200,
      ]);
    }
  });

  it("draws a polygon's and a star's corners, the first pointing up", () => {
    expect(shapePath("polygon", 100, 100, { ...COUNTS, sides: 4 })).toBe(
      "M50 0L100 50L50 100L0 50Z",
    );
    // Outer and inner in turn
    expect(shapePath("star", 100, 100, COUNTS).split("L")).toHaveLength(10);
  });

  it("keeps an arrow's head as long as the box is tall in a wider box", () => {
    expect(shapePath("arrow", 600, 100, COUNTS)).toBe(
      "M0 25L500 25L500 0L600 50L500 100L500 75L0 75Z",
    );
  });

  it("drops a speech bubble's tail from under its body, its corners no rounder than it", () => {
    // A 50 px tail under a 150 px body
    const bubble = shapePath("bubble", 300, 200, COUNTS);
    expect(bubble.startsWith("M24 0")).toBe(true);
    expect(bubble).toContain("L45 200");

    const round = shapePath("bubble", 300, 200, { ...COUNTS, radius: 500 });
    expect(round.startsWith("M75 0")).toBe(true);
    expect(round).toContain("L75 200");
  });
});
