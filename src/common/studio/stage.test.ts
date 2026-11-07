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
import { createStage, Stage } from "./stage";

type TextView = Extract<StudioElementView, { kind: "text" }>;

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
        ...PICTURE,
        src: "/m/a.mp4",
        video: true,
      }),
    );
    const video = root.querySelector("video")!;
    expect(video.muted && video.loop && video.autoplay).toBe(true);

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

describe("in the editor", () => {
  beforeEach(() => {
    stage = createStage(root, { slots: true, editing: true });
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
