import { translate } from "@/common/i18n";
import {
  StudioElement,
  StudioElementSchema,
  StudioLayer,
} from "@/common/schemas";
import { EMOTE_TRIGGER, TOKIO_EVENTS } from "@/common/types";
import { newStudioElement, newStudioLayer, studioView } from "@/common/util";
import { gift } from "@test/fixtures";
import { describe, expect, it } from "vitest";
import {
  alignTo,
  bounds,
  elementName,
  findElement,
  moveElement,
  extent,
  pickElement,
  resizeBox,
  stepElement,
  turnTo,
  toCanvas,
  moveLayer,
  roundBox,
  sampleReact,
  Samples,
  sourceOf,
  sourceValue,
  whenText,
} from "./helper";

const t = (
  key: Parameters<typeof translate>[1],
  params?: Record<string, string>,
) => translate("en", key, params);
const context = {
  gifts: [gift(5655, "Rose")],
  emotes: [{ value: "e1", label: "Emote 1", img: "https://x/e1.png" }],
  label: () => "Gift jar",
  t,
};
const element = <K extends StudioElement["kind"]>(
  kind: K,
  patch: Partial<Extract<StudioElement, { kind: K }>> = {},
) =>
  StudioElementSchema.parse({
    ...newStudioElement(kind, "portrait"),
    ...patch,
  });

describe("elementName", () => {
  it("names an element by what it shows", () => {
    expect(
      elementName(
        element("text", { text: " Thanks\nfor the follow" }),
        context,
      ),
    ).toBe("Thanks");
    expect(elementName(element("media", { name: "Party" }), context)).toBe(
      "Party",
    );
    expect(elementName(element("gift", { gift: 5655 }), context)).toBe("Rose");
    expect(
      elementName(
        element("emote", { emote: { id: "e1", image: "https://x/e1.png" } }),
        context,
      ),
    ).toBe("Emote 1");
    expect(
      elementName(
        element("overlay", { source: { type: "games", column: null } }),
        context,
      ),
    ).toBe("Gift jar");
  });

  it("falls back to its kind", () => {
    expect(elementName(element("text"), context)).toBe("Text");
    expect(elementName(element("gift", { gift: 1 }), context)).toBe("Gift");
    expect(elementName(element("shape"), context)).toBe("Shape");
    expect(elementName(element("viewer"), context)).toBe("Viewer's picture");
    expect(elementName(element("overlay"), context)).toBe("Overlay");
  });
});

describe("whenText", () => {
  it("says when an element shows, with its trigger", () => {
    expect(whenText(element("shape"), t)).toBe("always on screen");
    expect(whenText(element("viewer"), t)).toBe("shows on Follow");
    expect(
      whenText(
        element("shape", {
          when: "animate",
          trigger: {
            ...newStudioElement("shape", "portrait").trigger,
            type: TOKIO_EVENTS.GIFT,
          },
        }),
        t,
      ),
    ).toBe("moves on Gift");
  });
});

describe("sourceValue and sourceOf", () => {
  it("round-trips every source", () => {
    for (const source of [
      { type: "installed", id: "gift-jar" },
      { type: "alert", id: "a:1" },
      { type: "timer" },
      { type: "games", column: null },
      { type: "games", column: 2 },
    ] as const) {
      expect(sourceOf(sourceValue(source)!)).toEqual(source);
    }
    expect(sourceValue(null)).toBeUndefined();
  });
});

describe("moveLayer", () => {
  it("moves one item, and nothing out of range", () => {
    expect(moveLayer(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveLayer(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    const same = ["a", "b"];
    expect(moveLayer(same, 1, 2)).toBe(same);
    expect(moveLayer(same, 0, -1)).toBe(same);
  });
});

describe("roundBox", () => {
  it("keeps whole px and a size of at least 1", () => {
    expect(roundBox({ x: 1.4, y: -2.6, width: 0.2, height: -40 })).toEqual({
      x: 1,
      y: -3,
      width: 1,
      height: 1,
    });
  });
});

describe("resizeBox", () => {
  const box = { x: 100, y: 200, width: 300, height: 100 };

  it("resizes from each corner, keeping the opposite one", () => {
    expect(resizeBox(box, "se", 20.4, -10)).toEqual({
      x: 100,
      y: 200,
      width: 320,
      height: 90,
    });
    expect(resizeBox(box, "nw", 20, 10)).toEqual({
      x: 120,
      y: 210,
      width: 280,
      height: 90,
    });
    expect(resizeBox(box, "ne", 20, 10)).toEqual({
      x: 100,
      y: 210,
      width: 320,
      height: 90,
    });
    expect(resizeBox(box, "sw", -20, 10)).toEqual({
      x: 80,
      y: 200,
      width: 320,
      height: 110,
    });
  });

  it("resizes a turned box along its own sides, its opposite corner kept", () => {
    // A quarter turn: the pointer going down stretches its width
    const turned = roundBox(resizeBox(box, "se", 0, 50, { rotation: 90 }));

    expect(turned).toEqual({ x: 75, y: 225, width: 350, height: 100 });
    // Its own top left corner is where it was on the canvas: 300, 100
    const corner = (b: typeof turned) => ({
      x: b.x + b.width / 2 + b.height / 2,
      y: b.y + b.height / 2 - b.width / 2,
    });
    expect(corner(turned)).toEqual(corner(box));
  });

  it("stops at the least size, the dragged corner held there", () => {
    // Past the opposite corner: 1 px wide, and as tall as the text
    const heights: number[] = [];
    const words = (width: number) => {
      heights.push(width);
      return 60;
    };

    expect(resizeBox(box, "nw", 500, 500, { minHeight: words })).toEqual({
      x: 399,
      y: 240,
      width: 1,
      height: 60,
    });
    expect(resizeBox(box, "se", -500, -500)).toMatchObject({
      width: 1,
      height: 1,
    });
    // Asked at the width it gets
    expect(heights).toEqual([1]);
  });

  it("stops at the least width, a text's longest word, its height asked there", () => {
    const heights: number[] = [];
    const words = (width: number) => {
      heights.push(width);
      return 150;
    };

    // From the left, the right side kept at 400
    expect(
      resizeBox(box, "sw", 500, 0, { minWidth: 120, minHeight: words }),
    ).toEqual({ x: 280, y: 200, width: 120, height: 150 });
    expect(heights).toEqual([120]);
  });
});

describe("alignTo", () => {
  const canvas = { width: 1080, height: 1920 };
  const box = { x: 100, y: 200, width: 300, height: 100, rotation: 0 };

  it("lines a box up with each edge and middle, the other way kept", () => {
    expect(alignTo(box, canvas, "left")).toEqual({ x: 0, y: 200 });
    expect(alignTo(box, canvas, "center")).toEqual({ x: 390, y: 200 });
    expect(alignTo(box, canvas, "right")).toEqual({ x: 780, y: 200 });
    expect(alignTo(box, canvas, "top")).toEqual({ x: 100, y: 0 });
    expect(alignTo(box, canvas, "middle")).toEqual({ x: 100, y: 910 });
    expect(alignTo(box, canvas, "bottom")).toEqual({ x: 100, y: 1820 });
  });

  it("lines a turned box up by how it shows", () => {
    // A quarter turn: it shows 100 wide and 300 tall, from 200, 100
    const turned = { ...box, rotation: 90 };

    expect(alignTo(turned, canvas, "left")).toEqual({ x: -100, y: 200 });
    expect(alignTo(turned, canvas, "top")).toEqual({ x: 100, y: 100 });
    expect(alignTo(turned, canvas, "bottom")).toEqual({ x: 100, y: 1720 });
  });
});

describe("turnTo and extent", () => {
  const center = { x: 0, y: 0 };

  it("turns a box's top toward the pointer, in whole degrees", () => {
    expect(turnTo(center, { x: 0, y: -10 })).toBe(0);
    expect(turnTo(center, { x: 10, y: 0 })).toBe(90);
    expect(turnTo(center, { x: 0, y: 10 })).toBe(180);
    expect(turnTo(center, { x: -10, y: 0 })).toBe(-90);
    expect(turnTo(center, { x: 10, y: -10.4 })).toBe(44);
  });

  it("snaps to steps of 15", () => {
    expect(turnTo(center, { x: 10, y: -10.4 }, true)).toBe(45);
    // Never -0, which main would save as 0
    expect(turnTo(center, { x: -1, y: -10 }, true)).toBe(0);
  });

  it("boxes a turned box", () => {
    expect(
      roundBox(
        extent({ x: 100, y: 200, width: 300, height: 100, rotation: 90 }),
      ),
    ).toEqual({ x: 200, y: 100, width: 100, height: 300 });
    expect(extent({ x: 1, y: 2, width: 3, height: 4, rotation: 0 })).toEqual({
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    });
  });
});

describe("Samples", () => {
  it("makes each trigger's sample once, an emote's from chat", () => {
    const samples = new Samples();

    expect(samples.of(TOKIO_EVENTS.FOLLOW)).toBe(
      samples.of(TOKIO_EVENTS.FOLLOW),
    );
    expect(samples.of(EMOTE_TRIGGER)).toHaveProperty("comment");
  });

  it("plays a text with its trigger's values and a viewer with its picture", () => {
    const samples = new Samples();
    const text = element("text", { text: "Hi {username}", when: "event" });
    const viewer = element("viewer");
    const follow = samples.of(TOKIO_EVENTS.FOLLOW);
    const username =
      typeof follow === "object" && follow && "user" in follow
        ? follow.user.username
        : "";

    expect(username).not.toBe("");
    expect(sampleReact(text, samples, "en")).toEqual({
      element: text.id,
      text: `Hi ${username}`,
    });
    expect(sampleReact(viewer, samples, "en")).toMatchObject({
      element: viewer.id,
      name: username,
    });
    expect(sampleReact(element("shape"), samples, "en")).toEqual({
      element: expect.any(String),
    });
  });
});

// A layer holding shapes with these ids, back to front
const layerOf = (id: string, ...ids: string[]): StudioLayer => ({
  ...newStudioLayer(id),
  id,
  elements: ids.map((e) => ({ ...element("shape"), id: e })),
});
const ids = (layers: StudioLayer[]) =>
  layers.map((l) => [l.id, ...l.elements.map((e) => e.id)]);

describe("moveElement and stepElement", () => {
  const layers = [layerOf("back", "a", "b"), layerOf("front", "c")];

  it("finds an element's layer and place", () => {
    expect(findElement(layers, "b")).toEqual({ layer: 0, index: 1 });
    expect(findElement(layers, "back")).toBeNull();
  });

  it("moves an element into another layer, which unfolds", () => {
    const folded = [layers[0], { ...layers[1], folded: true }];
    const moved = moveElement(folded, "a", "front", 1);

    expect(ids(moved)).toEqual([
      ["back", "b"],
      ["front", "c", "a"],
    ]);
    expect(moved[1].folded).toBe(false);
    // Nowhere to go
    expect(moveElement(layers, "a", "gone", 0)).toBe(layers);
  });

  it("steps within its layer, then across the edge into the next", () => {
    expect(ids(stepElement(layers, "a", 1))).toEqual([
      ["back", "b", "a"],
      ["front", "c"],
    ]);
    // Toward the front, it's the next layer's back-most
    expect(ids(stepElement(layers, "b", 1))).toEqual([
      ["back", "a"],
      ["front", "b", "c"],
    ]);
    // Toward the back, the next layer's front-most
    expect(ids(stepElement(layers, "c", -1))).toEqual([
      ["back", "a", "b", "c"],
      ["front"],
    ]);
    // Past the last layer, nothing moves
    expect(stepElement(layers, "c", 1)).toBe(layers);
    expect(stepElement(layers, "a", -1)).toBe(layers);
  });
});

describe("the canvas's geometry", () => {
  const box = (id: string, x: number, y: number, size = 100) => ({
    ...element("shape"),
    id,
    x,
    y,
    width: size,
    height: size,
  });
  const overlay = {
    id: "o",
    name: "",
    size: "portrait" as const,
    layers: [
      { ...newStudioLayer("Back"), id: "back", elements: [box("under", 0, 0)] },
      {
        ...newStudioLayer("Front"),
        id: "front",
        elements: [box("low", 50, 50), box("high", 60, 60, 20)],
      },
    ],
  };
  const view = studioView(overlay, {
    gifts: [],
    served: () => true,
    mediaURL: (file) => file,
    embedPath: () => "",
    text: () => "",
    viewer: () => ({ src: "", name: "" }),
    label: () => "",
  });

  it("turns screen px into the canvas's", () => {
    expect(
      toCanvas(
        { x: 110, y: 70 },
        { left: 10, top: 20 },
        { scale: 0.5, left: 50, top: 0 },
      ),
    ).toEqual({ x: 100, y: 100 });
  });

  it("picks a turned element where it shows, and goes through a locked one", () => {
    // A bar 200 wide and 20 tall, turned upright around its center (100, 10)
    const [under] = view.layers[0].elements;
    const bar = { ...under, id: "bar", width: 200, height: 20, rotation: 90 };
    const turned = {
      ...view,
      layers: [{ id: "only", z: 0, elements: [bar] }],
    };

    expect(pickElement(turned, new Set(), { x: 100, y: 80 })).toBe("bar");
    expect(pickElement(turned, new Set(), { x: 150, y: 10 })).toBeNull();
    expect(pickElement(view, new Set(["high"]), { x: 65, y: 65 })).toBe("low");
  });

  it("picks the front-most element under the point", () => {
    expect(pickElement(view, new Set(), { x: 65, y: 65 })).toBe("high");
    expect(pickElement(view, new Set(), { x: 90, y: 90 })).toBe("low");
    expect(pickElement(view, new Set(), { x: 10, y: 10 })).toBe("under");
    expect(pickElement(view, new Set(), { x: 500, y: 500 })).toBeNull();
  });

  it("goes through a locked layer to what's under it", () => {
    expect(pickElement(view, new Set(["front"]), { x: 65, y: 65 })).toBe(
      "under",
    );
  });

  it("boxes a layer's elements", () => {
    expect(bounds(overlay.layers[1].elements)).toEqual({
      x: 50,
      y: 50,
      width: 100,
      height: 100,
    });
    expect(bounds([box("a", -10, 5, 10), box("b", 30, 40, 10)])).toEqual({
      x: -10,
      y: 5,
      width: 50,
      height: 45,
    });
    expect(bounds([])).toBeNull();
  });
});
