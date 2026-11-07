import { translate } from "@/common/i18n";
import {
  StudioElement,
  StudioElementSchema,
  StudioGroup,
  StudioItem,
} from "@/common/schemas";
import { EMOTE_TRIGGER, TOKIO_EVENTS } from "@/common/types";
import { newStudioElement, newStudioGroup, studioView } from "@/common/util";
import { gift, studioOverlay } from "@test/fixtures";
import { describe, expect, it } from "vitest";
import {
  alignTo,
  bounds,
  copyItem,
  cornerOf,
  elementName,
  guideAt,
  metLines,
  nearGuide,
  snapBox,
  snapLines,
  snapPoint,
  stickCorner,
  withGuide,
  findElement,
  moveElement,
  extent,
  flipInFrame,
  groupFrame,
  reframe,
  pickElement,
  fitText,
  resizeBox,
  rotateCursor,
  stepElement,
  turnTo,
  toCanvas,
  moveItem,
  roundBox,
  sampleReact,
  Samples,
  sourceOf,
  sourceValue,
  rulerTicks,
  whenText,
  withView,
  zoomStep,
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

describe("moveItem", () => {
  it("moves one item, and nothing out of range", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
    const same = ["a", "b"];
    expect(moveItem(same, 1, 2)).toBe(same);
    expect(moveItem(same, 0, -1)).toBe(same);
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

describe("rotateCursor", () => {
  it("turns the cursor in steps of 5 degrees, around its middle", () => {
    expect(rotateCursor(-90)).toContain(
      encodeURIComponent("rotate(270 16 16)"),
    );
    expect(rotateCursor(362)).toBe(rotateCursor(0));
    expect(rotateCursor(43)).toBe(rotateCursor(45));
  });

  it("draws it at 1x and 2x, held at its middle, grab without it", () => {
    expect(rotateCursor(0)).toMatch(
      /^image-set\(url\("data:image\/svg\+xml,.+"\) 1x, url\(".+"\) 2x\) 16 16, grab$/,
    );
  });
});

describe("fitText", () => {
  const box = { x: 100, y: 200, width: 300, height: 100, rotation: 0 };
  const lines = (height: number) => () => height;

  it("leaves a box its words fit", () => {
    expect(fitText(box, "center", 200, lines(100))).toBeNull();
  });

  it("grows around where its words show: across from their side, from the middle", () => {
    expect(fitText(box, "center", 400, lines(160))).toEqual({
      x: 50,
      y: 170,
      width: 400,
      height: 160,
    });
    expect(fitText(box, "left", 400, lines(160))).toMatchObject({
      x: 100,
      y: 170,
    });
    expect(fitText(box, "right", 400, lines(160))).toMatchObject({
      x: 0,
      y: 170,
    });
  });

  it("grows from the middle by whole px on each side", () => {
    expect(fitText(box, "center", 301, lines(101))).toEqual({
      x: 99,
      y: 199,
      width: 302,
      height: 102,
    });
    expect(fitText(box, "left", 301, lines(100))).toEqual({
      x: 100,
      y: 200,
      width: 301,
      height: 100,
    });
  });

  it("asks the height at the width it gets", () => {
    const asked: number[] = [];
    fitText(box, "center", 500, (width) => {
      asked.push(width);
      return 1;
    });

    expect(asked).toEqual([500]);
  });

  it("keeps a turned box's own side where it was", () => {
    // A quarter turn: its left side is its top on the canvas, at 250, 100
    const grown = fitText({ ...box, rotation: 90 }, "left", 400, lines(100))!;

    expect(grown).toEqual({ x: 50, y: 250, width: 400, height: 100 });
    expect(grown.y + grown.height / 2 - grown.width / 2).toBe(100);
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

  it("keeps an even box's proportions, along its diagonal", () => {
    expect(resizeBox(box, "se", 30, 0, { even: true })).toEqual({
      x: 100,
      y: 200,
      width: 327,
      height: 109,
    });
    expect(resizeBox(box, "nw", 60, 20, { even: true })).toEqual({
      x: 160,
      y: 220,
      width: 240,
      height: 80,
    });
    // As small as it gets, still three times as wide
    expect(resizeBox(box, "se", -1000, -1000, { even: true })).toMatchObject({
      width: 3,
      height: 1,
    });
    expect(
      resizeBox(box, "se", -1000, -1000, { even: true, minWidth: 150 }),
    ).toMatchObject({ width: 150, height: 50 });
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

describe("groupFrame, reframe and flipInFrame", () => {
  const a = { x: 0, y: 0, width: 100, height: 50, rotation: 0 };
  const b = { x: 200, y: 100, width: 100, height: 100, rotation: 0 };

  it("frames the elements, turned by the group's rotation", () => {
    expect(groupFrame([a, b], 0)).toEqual({
      x: 0,
      y: 0,
      width: 300,
      height: 200,
      rotation: 0,
    });
    expect(groupFrame([], 0)).toBeNull();
    // A quarter turn: its sides swap
    const turned = groupFrame([a, b], 90)!;
    expect(roundBox(turned)).toEqual({
      x: 50,
      y: -50,
      width: 200,
      height: 300,
    });
    expect(turned.rotation).toBe(90);
  });

  it("scales the elements with the frame, each in its place", () => {
    const from = groupFrame([a, b], 0)!;

    expect(reframe([a, b], from, { ...from, width: 600, height: 400 })).toEqual(
      [
        { x: 0, y: 0, width: 200, height: 100, rotation: 0 },
        { x: 400, y: 200, width: 200, height: 200, rotation: 0 },
      ],
    );
  });

  it("turns the elements around the frame's center", () => {
    const from = groupFrame([a, b], 0)!;

    // Around (150, 100): a's center (50, 25) goes to (225, 0)
    expect(reframe([a], from, { ...from, rotation: 90 })).toEqual([
      { x: 175, y: -25, width: 100, height: 50, rotation: 90 },
    ]);
  });

  it("mirrors the elements across the frame, flipping each", () => {
    const from = groupFrame([a, b], 0)!;
    const flips = { flip_x: false, flip_y: false };

    expect(
      flipInFrame(
        [
          { ...a, ...flips },
          { ...b, ...flips },
        ],
        from,
        "flip_x",
      ),
    ).toEqual([
      { ...a, x: 200, flip_x: true, flip_y: false },
      { ...b, x: 0, flip_x: true, flip_y: false },
    ]);
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

// A group holding shapes with these ids, back to front
const groupOf = (id: string, ...ids: string[]): StudioGroup => ({
  ...newStudioGroup(id),
  id,
  elements: ids.map(shapeOf),
});
const shapeOf = (id: string): StudioElement => ({ ...element("shape"), id });
// Each item's id, a group's with its elements'
const ids = (items: StudioItem[]) =>
  items.map((item) =>
    item.kind === "group"
      ? [item.id, ...item.elements.map((e) => e.id)]
      : item.id,
  );

describe("moveElement and stepElement", () => {
  const items: StudioItem[] = [
    groupOf("back", "a", "b"),
    shapeOf("alone"),
    groupOf("front", "c"),
  ];

  it("finds an element in its group, or on its own", () => {
    expect(findElement(items, "b")).toEqual({ group: 0, index: 1 });
    expect(findElement(items, "alone")).toEqual({ group: null, index: 1 });
    expect(findElement(items, "back")).toBeNull();
  });

  it("moves an element into another group, which unfolds, or on its own", () => {
    const folded = [items[0], items[1], { ...items[2], folded: true }];
    const moved = moveElement(folded, "a", "front", 1);

    expect(ids(moved)).toEqual([["back", "b"], "alone", ["front", "c", "a"]]);
    expect(moved[2]).toMatchObject({ folded: false });
    expect(ids(moveElement(items, "b", null, 3))).toEqual([
      ["back", "a"],
      "alone",
      ["front", "c"],
      "b",
    ]);
    expect(ids(moveElement(items, "alone", "back", 0))).toEqual([
      ["back", "alone", "a", "b"],
      ["front", "c"],
    ]);
    // Nowhere to go
    expect(moveElement(items, "a", "gone", 0)).toBe(items);
    expect(moveElement(items, "a", "alone", 0)).toBe(items);
  });

  it("steps within its group, then out of it, right next to it", () => {
    expect(ids(stepElement(items, "a", 1))).toEqual([
      ["back", "b", "a"],
      "alone",
      ["front", "c"],
    ]);
    expect(ids(stepElement(items, "b", 1))).toEqual([
      ["back", "a"],
      "b",
      "alone",
      ["front", "c"],
    ]);
    expect(ids(stepElement(items, "c", -1))).toEqual([
      ["back", "a", "b"],
      "alone",
      "c",
      ["front"],
    ]);
  });

  it("steps on its own past an element, and into a group at its near edge", () => {
    // Toward the front, the group's back-most
    expect(ids(stepElement(items, "alone", 1))).toEqual([
      ["back", "a", "b"],
      ["front", "alone", "c"],
    ]);
    // Toward the back, its front-most
    expect(ids(stepElement(items, "alone", -1))).toEqual([
      ["back", "a", "b", "alone"],
      ["front", "c"],
    ]);
    const two = [shapeOf("x"), shapeOf("y")];
    expect(ids(stepElement(two, "x", 1))).toEqual(["y", "x"]);
    // Past the edge, nothing moves
    expect(stepElement(two, "y", 1)).toBe(two);
    expect(stepElement(two, "x", -1)).toBe(two);
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
    rulers: false,
    guides: { x: [], y: [], locked: false },
    items: [
      { ...newStudioGroup("Back"), id: "back", elements: [box("under", 0, 0)] },
      {
        ...newStudioGroup("Front"),
        id: "front",
        elements: [box("low", 50, 50), box("high", 60, 60, 20)],
      },
    ],
  };
  // A shape on its own in front of both groups
  const alone = {
    ...overlay,
    items: [...overlay.items, box("alone", 0, 0, 30)],
  };
  const deps = {
    gifts: [],
    served: () => true,
    mediaURL: (file: string) => file,
    embedPath: () => "",
    text: () => "",
    viewer: () => ({ src: "", name: "" }),
    sent: () => "",
    label: () => "",
  };
  const view = studioView(overlay, deps);

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
      layers: [{ id: "only", z: 0, opacity: 1, elements: [bar] }],
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

  it("goes through a locked group to what's under it", () => {
    expect(pickElement(view, new Set(["front"]), { x: 65, y: 65 })).toBe(
      "under",
    );
  });

  it("picks an element on its own, and goes through it locked", () => {
    const shown = studioView(alone, deps);
    expect(pickElement(shown, new Set(), { x: 10, y: 10 })).toBe("alone");
    expect(pickElement(shown, new Set(["alone"]), { x: 10, y: 10 })).toBe(
      "under",
    );
  });

  it("boxes a group's elements", () => {
    expect(bounds(overlay.items[1].elements)).toEqual({
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

describe("the history and the view", () => {
  it("keeps each group folded as it is now, in a step it goes back to", () => {
    const shape = StudioElementSchema.parse(
      newStudioElement("shape", "portrait"),
    );
    const open = { ...newStudioGroup("Open"), elements: [shape] };
    const shut = { ...newStudioGroup("Shut"), folded: true };
    const was = studioOverlay("Main", { items: [open, shut] });
    const now = studioOverlay("Main", {
      items: [{ ...open, folded: true, name: "Renamed" }],
    });

    const back = withView(was, now);
    expect(back.items).toEqual([{ ...open, folded: true }, shut]);
    // Nothing to change, the same overlay's items
    expect(withView(was, was).items[1]).toBe(shut);
  });

  it("keeps the rulers as they are now, in a step it goes back to", () => {
    const was = studioOverlay("Main", { rulers: false, name: "Old" });
    const now = studioOverlay("Main", { rulers: true });

    expect(withView(was, now)).toMatchObject({ rulers: true, name: "Old" });
  });

  it("copies an element or a group with new ids, moved down and right", () => {
    const shape = StudioElementSchema.parse({
      ...newStudioElement("shape", "portrait"),
      x: 100,
      y: 50,
      label: "Badge",
    });
    const copy = copyItem(shape, 20);
    expect(copy).toEqual({ ...shape, id: copy.id, x: 120, y: 70 });
    expect(copy.id).not.toBe(shape.id);

    const group = { ...newStudioGroup("Frame"), elements: [shape] };
    const pasted = copyItem(group, 0);
    if (pasted.kind !== "group") throw new Error("not a group");
    expect(pasted).toMatchObject({ name: "Frame", rotation: group.rotation });
    expect(pasted.id).not.toBe(group.id);
    expect(pasted.elements[0]).toEqual({
      ...shape,
      id: pasted.elements[0].id,
    });
    expect(pasted.elements[0].id).not.toBe(shape.id);
  });

  it("steps the zoom through its stops, from wherever it is", () => {
    expect(zoomStep(0.32, 1)).toBe(0.5);
    expect(zoomStep(0.32, -1)).toBe(0.25);
    expect(zoomStep(1, 1)).toBe(1.5);
    expect(zoomStep(1, -1)).toBe(0.75);
    expect(zoomStep(4, 1)).toBeNull();
    expect(zoomStep(0.1, -1)).toBeNull();
    // Under the first, the first; past the last, the last
    expect(zoomStep(0.05, 1)).toBe(0.1);
    expect(zoomStep(5, -1)).toBe(4);
  });

  it("numbers a ruler at least 60 px apart, with a tick every tenth", () => {
    // Fitted at a third: a number every 200 canvas px, 66 screen px apart
    const ticks = rulerTicks(40, 1 / 3, 400);
    const numbers = ticks.filter((tick) => tick.size === "number");
    expect(numbers.map((tick) => tick.value)).toEqual([
      0, 200, 400, 600, 800, 1000,
    ]);
    expect(numbers[0].at).toBe(40);
    expect(ticks[0].at).toBeGreaterThanOrEqual(0);
    expect(ticks.at(-1)!.at).toBeLessThanOrEqual(400);
    // A tick every 20 from the ruler's start, the longer one halfway
    expect(ticks.slice(0, 7).map((tick) => [tick.value, tick.size])).toEqual([
      [-120, "tick"],
      [-100, "half"],
      [-80, "tick"],
      [-60, "tick"],
      [-40, "tick"],
      [-20, "tick"],
      [0, "number"],
    ]);

    // At 400%, every 20 px; at 10%, every 1000
    expect(
      rulerTicks(0, 4, 200)
        .filter((t) => t.size === "number")
        .map((t) => t.value),
    ).toEqual([0, 20, 40]);
    expect(
      rulerTicks(0, 0.1, 290)
        .filter((t) => t.size === "number")
        .map((t) => t.value),
    ).toEqual([0, 1000, 2000]);
    // Scrolled past the canvas's edge
    expect(
      rulerTicks(-500, 1, 100).find((t) => t.size === "number")?.value,
    ).toBe(500);
    expect(rulerTicks(0, 0, 100)).toEqual([]);
  });
});

describe("sticking and guides", () => {
  const canvas = { width: 1080, height: 1920 };
  const turned = (x: number, y: number, width: number, height: number) => ({
    x,
    y,
    width,
    height,
    rotation: 0,
  });
  // A box at 100–300 across and 200–300 down, and a guide at x 700
  const lines = snapLines(canvas, [turned(100, 200, 200, 100)], {
    x: [700],
    y: [],
    locked: false,
  });

  it("lines up the canvas's edges and middle, each box's, and the guides", () => {
    expect(lines.x.map((line) => line.at)).toEqual([
      0, 540, 1080, 100, 200, 300, 700,
    ]);
    expect(lines.y.map((line) => line.at)).toEqual([
      0, 960, 1920, 200, 250, 300,
    ]);
    // Each runs along what it's from, a guide across everything
    expect(lines.x[0]).toEqual({ at: 0, from: 0, to: 1920 });
    expect(lines.x[3]).toEqual({ at: 100, from: 200, to: 300 });
    expect(lines.x[6]).toEqual({ at: 700, from: -Infinity, to: Infinity });
  });

  it("moves a box to the nearest line its edges or middle are near", () => {
    // Its left edge 7 from the guide
    expect(snapBox(turned(693, 1000, 100, 50), lines, 10)).toEqual({
      x: 7,
      y: 0,
    });
    expect(snapBox(turned(693, 1000, 100, 50), lines, 5)).toEqual({
      x: 0,
      y: 0,
    });
    // Its middle, 535, to the canvas's
    expect(snapBox(turned(485, 1000, 100, 50), lines, 6).x).toBe(5);
    // Of its left edge 4 away and its right edge 2 away, the right one
    expect(snapBox(turned(104, 1000, 594, 50), lines, 6).x).toBe(2);
    // Down, its top to the canvas's middle
    expect(snapBox(turned(600, 963, 10, 10), lines, 6).y).toBe(-3);
  });

  it("goes by how a turned box shows", () => {
    // Upright, it shows 102–122 across: its left edge 2 from the line at 100
    const bar = { ...turned(12, 500, 200, 20), rotation: 90 };
    expect(snapBox(bar, lines, 5).x).toBeCloseTo(-2);
  });

  it("moves a point to the nearest line on each axis", () => {
    expect(snapPoint({ x: 538, y: 1915 }, lines, 6)).toEqual({ x: 2, y: 5 });
    expect(snapPoint({ x: 620, y: 600 }, lines, 6)).toEqual({ x: 0, y: 0 });
  });

  it("draws a line where a box meets others, across all of them", () => {
    const met = snapLines(
      canvas,
      [turned(100, 200, 200, 100), turned(100, 1000, 50, 50)],
      { x: [], y: [450], locked: false },
    );
    // Its left edge on both boxes', its middle down on the guide
    expect(metLines(turned(100, 400, 80, 100), met)).toEqual([
      { axis: "x", at: 100, from: 200, to: 1050 },
      { axis: "y", at: 450, from: -Infinity, to: Infinity },
    ]);
    expect(metLines(turned(400, 600, 80, 100), met)).toEqual([]);
  });

  it("finds a corner where it shows, turned too", () => {
    const box = turned(10, 20, 100, 50);
    expect(cornerOf(box, "nw")).toEqual({ x: 10, y: 20 });
    expect(cornerOf(box, "se")).toEqual({ x: 110, y: 70 });
    // A quarter turn clockwise around its middle (60, 45)
    const nw = cornerOf({ ...box, rotation: 90 }, "nw");
    expect(nw.x).toBeCloseTo(85);
    expect(nw.y).toBeCloseTo(-5);
  });

  it("sticks a dragged corner, along the diagonal with Link on", () => {
    const near = snapLines(canvas, [turned(200, 600, 10, 10)], null);
    const box = turned(0, 0, 100, 100);
    const resized = { ...resizeBox(box, "se", 95, 40), rotation: 0 };
    // Its corner at 195 across, 5 from the box at 200
    expect(
      stickCorner(box, resized, "se", { x: 95, y: 40 }, near, 6, false),
    ).toEqual({ x: 100, y: 40 });

    const wide = turned(0, 0, 100, 50);
    const linked = {
      ...resizeBox(wide, "se", 96, 48, { even: true }),
      rotation: 0,
    };
    // At 196 × 98, 4 short of 200 across: the diagonal takes it there
    const move = stickCorner(
      wide,
      linked,
      "se",
      { x: 96, y: 48 },
      near,
      6,
      true,
    );
    expect(move.x).toBeCloseTo(100);
    expect(move.y).toBeCloseTo(50);
    expect(resizeBox(wide, "se", move.x, move.y, { even: true })).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 100,
    });
  });

  it("finds the guide nearest a point", () => {
    const guides = { x: [100, 300], y: [205], locked: false };
    expect(nearGuide({ x: 103, y: 200 }, guides, 4)).toEqual({
      axis: "x",
      index: 0,
    });
    expect(nearGuide({ x: 290, y: 204 }, guides, 4)).toEqual({
      axis: "y",
      index: 0,
    });
    expect(nearGuide({ x: 500, y: 500 }, guides, 4)).toBeNull();
  });

  it("moves, adds and removes a guide", () => {
    const guides = { x: [100, 300], y: [205], locked: true };
    expect(withGuide(guides, "x", 1, 320)).toEqual({
      ...guides,
      x: [100, 320],
    });
    expect(withGuide(guides, "y", null, 960)).toEqual({
      ...guides,
      y: [205, 960],
    });
    expect(withGuide(guides, "x", 0, null)).toEqual({ ...guides, x: [300] });
    // Off the view before it was ever dropped: nothing
    expect(withGuide(guides, "y", null, null)).toEqual(guides);
  });

  it("places a dragged guide on whole px, stuck to a line near it", () => {
    expect(guideAt(537.6, lines.x, 6)).toBe(540);
    expect(guideAt(620.4, lines.x, 6)).toBe(620);
    expect(Object.is(guideAt(-0.4, [], 6), 0)).toBe(true);
  });
});
