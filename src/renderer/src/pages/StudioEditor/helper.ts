import { MessageKey } from "@/common/i18n";
import {
  StudioAlign,
  StudioElement,
  StudioElementKind,
  StudioElementOf,
  StudioItem,
  StudioSource,
  Trigger,
} from "@/common/schemas";
import type { StageFit } from "@/common/studio/stage";
import {
  ALERT_TRIGGER_LABELS,
  AppEvents,
  CustomGift,
  EMOTE_TRIGGER,
  StudioReact,
  StudioView,
  TokioEventMap,
} from "@/common/types";
import {
  fillStudioText,
  generateEmoteChatSample,
  generateTikTokEventSample,
  SAMPLE_NUMBERS,
  sentPicture,
  studioEventVariables,
} from "@/common/util";
import { EmoteOption } from "@/components";

export const KIND_NAMES: Record<StudioElementKind, MessageKey> = {
  text: "studio.kinds.text",
  media: "studio.kinds.media",
  gift: "studio.kinds.gift",
  emote: "studio.kinds.emote",
  shape: "studio.kinds.shape",
  viewer: "studio.kinds.viewer",
  overlay: "studio.kinds.overlay",
};

type Sample = TokioEventMap[AppEvents];

/**
 * Each trigger's sample, made the first time an element asks for it, so its
 * names don't change on every render. Test starts a new one.
 */
export class Samples {
  private made = new Map<Trigger["type"], Sample>();

  of(type: Trigger["type"]): Sample {
    let sample = this.made.get(type);
    if (!sample) {
      // An emote comes in a chat message
      sample =
        type === EMOTE_TRIGGER
          ? generateEmoteChatSample()
          : generateTikTokEventSample(type).data;
      this.made.set(type, sample);
    }
    return sample;
  }
}

// The viewer who set the sample off, as main takes them from an event
function sampleViewer(sample: Sample) {
  const user =
    typeof sample === "object" && sample !== null && "user" in sample
      ? sample.user
      : null;
  return { src: user?.profilePictures[0] ?? "", name: user?.username ?? "" };
}

const sampleOf = (element: StudioElement, samples: Samples) =>
  element.when === "always" ? null : samples.of(element.trigger.type);

/** The picture of the gift or emote its trigger's sample sent, "" for none. */
export const sampleSentOf = (element: StudioElement, samples: Samples) =>
  sentPicture(element, sampleOf(element, samples));

/** A text element's text with the sample numbers and its trigger's sample. */
export const sampleText = (
  element: StudioElementOf<"text">,
  samples: Samples,
  language: string,
) =>
  fillStudioText(element.text, {
    numbers: SAMPLE_NUMBERS,
    values: sampleOf(element, samples),
    variables: studioEventVariables(element),
    language,
  });

/** The picture and name a viewer element shows, its trigger's sample's. */
export const sampleViewerOf = (element: StudioElement, samples: Samples) =>
  sampleViewer(samples.of(element.trigger.type));

/** What Test plays on the stage for an element that reacts to an event. */
export function sampleReact(
  element: StudioElement,
  samples: Samples,
  language: string,
): StudioReact {
  if (element.kind === "text") {
    const text = sampleText(element, samples, language);
    return { element: element.id, text };
  }
  if (element.kind === "viewer") {
    const { src, name } = sampleViewerOf(element, samples);
    return { element: element.id, picture: src, name };
  }
  if (
    (element.kind === "gift" && element.gift === null) ||
    (element.kind === "emote" && element.emote === null)
  ) {
    return { element: element.id, picture: sampleSentOf(element, samples) };
  }
  return { element: element.id };
}

// An embed's source as a Select's value ("games:2" for one column), and back
export function sourceValue(source: StudioSource | null) {
  if (!source) return undefined;
  if ("id" in source) return `${source.type}:${source.id}`;
  if (source.type === "games" && source.column !== null) {
    return `games:${source.column}`;
  }
  return source.type;
}

export function sourceOf(value: string): StudioSource {
  if (value === "timer") return { type: value };
  if (value === "games") return { type: value, column: null };
  const at = value.indexOf(":");
  const type = value.slice(0, at);
  if (type === "games") {
    return { type, column: Number(value.slice(at + 1)) };
  }
  return {
    type: type === "alert" ? "alert" : "installed",
    id: value.slice(at + 1),
  };
}

type NameContext = {
  gifts: CustomGift[];
  emotes: EmoteOption[];
  // An embed's name
  label: (source: StudioSource) => string;
  t: (key: MessageKey) => string;
};

/**
 * What the layers list calls an element with no label: what it shows (its
 * text, file, gift, emote or embed), else its kind.
 */
export function elementName(
  element: StudioElement,
  context: NameContext,
): string {
  const shown = (() => {
    switch (element.kind) {
      case "text":
        return element.text.trim().split("\n")[0];
      case "media":
        return element.name;
      case "gift":
        return context.gifts.find((g) => g.value === element.gift)?.label;
      case "emote":
        return context.emotes.find((e) => e.value === element.emote?.id)?.label;
      case "overlay":
        return element.source && context.label(element.source);
      default:
        return "";
    }
  })();
  return shown || context.t(KIND_NAMES[element.kind]);
}

/** Its When, as the layers list says it under the name. */
export function whenText(
  element: StudioElement,
  t: (key: MessageKey, params?: Record<string, string>) => string,
) {
  if (element.when === "always") return t("studio.rows.always");
  const trigger = t(ALERT_TRIGGER_LABELS[element.trigger.type]);
  return t(
    element.when === "event" ? "studio.rows.event" : "studio.rows.animate",
    { trigger },
  );
}

/**
 * The items with one moved from `from` to `to`, both indexes back to front.
 * Out of range moves nothing.
 */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || to >= items.length) return items;
  const next = [...items];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

/**
 * Where an element is, back to front: its group's index and its own in it,
 * or its own among the items (`group` null) when it stands on its own.
 */
export function findElement(items: StudioItem[], id: string) {
  for (const [at, item] of items.entries()) {
    if (item.kind !== "group") {
      if (item.id === id) return { group: null, index: at };
      continue;
    }
    const index = item.elements.findIndex((e) => e.id === id);
    if (index !== -1) return { group: at, index };
  }
  return null;
}

/** The items with every element, grouped or not, changed. */
export const mapElements = (
  items: StudioItem[],
  change: (element: StudioElement) => StudioElement,
): StudioItem[] =>
  items.map((item) =>
    item.kind === "group"
      ? { ...item, elements: item.elements.map(change) }
      : change(item),
  );

/**
 * The items with an element moved into the group `to` (its id), or to the
 * top level with `to` null, at `at`: an index back to front of that group's
 * elements, or of the items, once the element is taken out. The group it
 * goes into unfolds.
 */
export function moveElement(
  items: StudioItem[],
  id: string,
  to: string | null,
  at: number,
): StudioItem[] {
  const element = items
    .flatMap((item) => (item.kind === "group" ? item.elements : [item]))
    .find((e) => e.id === id);
  if (!element) return items;
  if (to !== null && !items.some((i) => i.kind === "group" && i.id === to)) {
    return items;
  }
  const rest = items.flatMap((item): StudioItem[] => {
    if (item.id === id) return [];
    return item.kind === "group" && item.elements.some((e) => e.id === id)
      ? [{ ...item, elements: item.elements.filter((e) => e.id !== id) }]
      : [item];
  });
  const place = Math.max(0, at);
  if (to === null) {
    rest.splice(place, 0, element);
    return rest;
  }
  return rest.map((item) => {
    if (item.kind !== "group" || item.id !== to) return item;
    const elements = [...item.elements];
    elements.splice(place, 0, element);
    return { ...item, folded: false, elements };
  });
}

/**
 * The items with an element one step toward the front (`by` 1) or the back
 * (-1). Past its group's edge it stands right in front of or behind the
 * group. On its own, it steps past an element, or into a group at the edge
 * it comes in from: the back going toward the front.
 */
export function stepElement(
  items: StudioItem[],
  id: string,
  by: 1 | -1,
): StudioItem[] {
  const from = findElement(items, id);
  if (!from) return items;
  const group = from.group === null ? null : items[from.group];
  if (from.group !== null && group?.kind === "group") {
    const to = from.index + by;
    if (to >= 0 && to < group.elements.length) {
      return moveElement(items, id, group.id, to);
    }
    return moveElement(items, id, null, by === 1 ? from.group + 1 : from.group);
  }
  const next = items[from.index + by] as StudioItem | undefined;
  if (!next) return items;
  if (next.kind === "group") {
    return moveElement(items, id, next.id, by === 1 ? 0 : next.elements.length);
  }
  return moveItem(items, from.index, from.index + by);
}

export type Box = Pick<StudioElement, "x" | "y" | "width" | "height">;
export type Point = { x: number; y: number };

// The selection's corners, each a handle that resizes from there
export const CORNERS = ["nw", "ne", "sw", "se"] as const;
export type Corner = (typeof CORNERS)[number];

// A box turned clockwise around its center, in degrees
export type Turned = Box & { rotation: number };

// The room a text's words take, measured on the stage in px of the canvas:
// its longest word's width, and their height at its width or at another
export type Words = {
  id: string;
  width: number;
  height: number;
  heightAt: (width: number) => number;
};

// A point (from the center) turned by the angle, clockwise on screen
const turn = ({ x, y }: Point, degrees: number): Point => {
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
};

/**
 * The box with a corner dragged by (dx, dy) px of the canvas, the opposite
 * corner kept where it is on the canvas: whole width and height, at least
 * `minWidth` wide (a text's longest word) and `minHeight(width)` tall (the
 * height its words take at that width). A turned box resizes along its own
 * sides, and an `even` one keeps its proportions.
 */
export function resizeBox(
  box: Box,
  corner: Corner,
  dx: number,
  dy: number,
  {
    minWidth = 1,
    minHeight = () => 1,
    rotation = 0,
    even = false,
  }: {
    minWidth?: number;
    minHeight?: (width: number) => number;
    rotation?: number;
    even?: boolean;
  } = {},
): Box {
  const west = corner.endsWith("w");
  const north = corner.startsWith("n");
  // The pointer's move along the box's own sides, out from the corner
  const along = turn({ x: dx, y: dy }, -rotation);
  let grow = { x: west ? -along.x : along.x, y: north ? -along.y : along.y };
  if (even) {
    // Along its diagonal, as far as it can shrink
    const scale = Math.max(
      (grow.x * box.width + grow.y * box.height) /
        (box.width ** 2 + box.height ** 2),
      minWidth / box.width - 1,
      1 / box.height - 1,
    );
    grow = { x: box.width * scale, y: box.height * scale };
  }
  const width = Math.max(minWidth, Math.round(box.width + grow.x));
  const height = Math.max(minHeight(width), Math.round(box.height + grow.y));
  // The opposite corner, from the center, stays put on the canvas
  const side = (w: number, h: number) =>
    turn({ x: (west ? w : -w) / 2, y: (north ? h : -h) / 2 }, rotation);
  const was = side(box.width, box.height);
  const now = side(width, height);
  return {
    x: box.x + box.width / 2 + was.x - now.x - width / 2,
    y: box.y + box.height / 2 + was.y - now.y - height / 2,
    width,
    height,
  };
}

/**
 * A text's box grown to its words: at least `minWidth` wide (its longest
 * word) and `minHeight(width)` tall (its words at that width), around where
 * they show so they stay put: across from the side they line up with, and
 * from the middle down and up, where they sit. Null when they fit.
 */
export function fitText(
  box: Turned,
  align: StudioAlign,
  minWidth: number,
  minHeight: (width: number) => number,
): Box | null {
  // By whole px on each side where it grows from the middle, so a size
  // dragged up a step at a time doesn't creep half a px a step
  const even = (px: number) => 2 * Math.ceil(px / 2);
  const short = Math.max(0, minWidth - box.width);
  const wider = align === "center" ? even(short) : short;
  const width = box.width + wider;
  const taller = even(Math.max(0, minHeight(width) - box.height));
  if (!wider && !taller) return null;
  // Its middle moves along its own width, away from the side it keeps
  const along =
    align === "left" ? wider / 2 : align === "right" ? -wider / 2 : 0;
  const moved = turn({ x: along, y: 0 }, box.rotation);
  return roundBox({
    x: box.x + moved.x - wider / 2,
    y: box.y + moved.y - taller / 2,
    width,
    height: box.height + taller,
  });
}

/**
 * The turn that points a box's top at the point, as its rotate handle
 * drags it, in whole degrees from -180 to 180: steps of 15 with `snap`.
 */
export function turnTo(center: Point, point: Point, snap = false): number {
  const angle =
    (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI + 90;
  const step = snap ? 15 : 1;
  const rounded = Math.round(angle / step) * step;
  // Never -0: saved as JSON, it comes back as 0
  return (rounded > 180 ? rounded - 360 : rounded) || 0;
}

/** The smallest unturned box around a turned one. */
export function extent({ x, y, width, height, rotation }: Turned): Box {
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
}

// The canvas's edges and middles an element lines up with
export type AlignTo = "left" | "center" | "right" | "top" | "middle" | "bottom";

/**
 * Where a box goes, in whole px, to line up with an edge of the canvas or
 * its middle: a turned box by how it shows, its extent.
 */
export function alignTo(
  box: Turned,
  canvas: { width: number; height: number },
  to: AlignTo,
): Point {
  const shown = extent(box);
  const across = canvas.width - shown.width;
  const down = canvas.height - shown.height;
  // Where what shows goes, its top left corner
  const x =
    to === "left"
      ? 0
      : to === "center"
        ? across / 2
        : to === "right"
          ? across
          : shown.x;
  const y =
    to === "top"
      ? 0
      : to === "middle"
        ? down / 2
        : to === "bottom"
          ? down
          : shown.y;
  return {
    x: Math.round(box.x + x - shown.x),
    y: Math.round(box.y + y - shown.y),
  };
}

// Whether a turned box holds a point: the point turned back into its sides
export const holdsTurned = (box: Turned, point: Point) => {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const local = turn({ x: point.x - cx, y: point.y - cy }, -box.rotation);
  return holds(box, { x: local.x + cx, y: local.y + cy });
};

// Whole px, the size at least 1, as the schema keeps them
export const roundBox = ({ x, y, width, height }: Box): Box => ({
  x: Math.round(x),
  y: Math.round(y),
  width: Math.max(1, Math.round(width)),
  height: Math.max(1, Math.round(height)),
});

/**
 * A point on screen in px of the canvas, from where the stage's root sits
 * on screen and where the canvas fits in it.
 */
export const toCanvas = (
  client: Point,
  root: { left: number; top: number },
  fit: StageFit,
): Point => ({
  x: (client.x - root.left - fit.left) / fit.scale,
  y: (client.y - root.top - fit.top) / fit.scale,
});

const holds = (box: Box, { x, y }: Point) =>
  x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height;

/** The smallest box around the boxes, null for none. */
export function bounds(boxes: Box[]): Box | null {
  if (boxes.length === 0) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  return {
    x,
    y,
    width: Math.max(...boxes.map((b) => b.x + b.width)) - x,
    height: Math.max(...boxes.map((b) => b.y + b.height)) - y,
  };
}

// Whole degrees from -180 to 180, never -0
const angle = (degrees: number) =>
  Math.round(((((degrees + 180) % 360) + 360) % 360) - 180) || 0;

const centerOf = (box: Box): Point => ({
  x: box.x + box.width / 2,
  y: box.y + box.height / 2,
});

/**
 * A group's frame: the smallest box, turned by the group's rotation, around
 * its elements as they show. Null without any.
 */
export function groupFrame(
  elements: Turned[],
  rotation: number,
): Turned | null {
  if (elements.length === 0) return null;
  // Every element's corners, turned back into the frame's sides
  const corners = elements.flatMap((e) => {
    const center = centerOf(e);
    return [-1, 1].flatMap((sx) =>
      [-1, 1].map((sy) => {
        const p = turn(
          { x: (sx * e.width) / 2, y: (sy * e.height) / 2 },
          e.rotation,
        );
        return turn({ x: center.x + p.x, y: center.y + p.y }, -rotation);
      }),
    );
  });
  const xs = corners.map((p) => p.x);
  const ys = corners.map((p) => p.y);
  const [left, right] = [Math.min(...xs), Math.max(...xs)];
  const [top, bottom] = [Math.min(...ys), Math.max(...ys)];
  const center = turn(
    { x: (left + right) / 2, y: (top + bottom) / 2 },
    rotation,
  );
  const width = right - left;
  const height = bottom - top;
  return {
    x: center.x - width / 2,
    y: center.y - height / 2,
    width,
    height,
    rotation,
  };
}

/**
 * The elements moved, scaled and turned from one frame of their group to
 * another, in whole px and degrees: each keeps its place in the frame, and
 * its sides scale as much as the frame's do along them.
 */
export function reframe<E extends Turned>(
  elements: E[],
  from: Turned,
  to: Turned,
): E[] {
  const sx = from.width ? to.width / from.width : 1;
  const sy = from.height ? to.height / from.height : 1;
  const was = centerOf(from);
  const now = centerOf(to);
  return elements.map((e) => {
    const center = centerOf(e);
    const local = turn(
      { x: center.x - was.x, y: center.y - was.y },
      -from.rotation,
    );
    const at = turn({ x: local.x * sx, y: local.y * sy }, to.rotation);
    // Its own sides, turned in the frame
    const own = ((e.rotation - from.rotation) * Math.PI) / 180;
    const cos = Math.cos(own);
    const sin = Math.sin(own);
    const width = e.width * Math.hypot(sx * cos, sy * sin);
    const height = e.height * Math.hypot(sx * sin, sy * cos);
    return {
      ...e,
      ...roundBox({
        x: now.x + at.x - width / 2,
        y: now.y + at.y - height / 2,
        width,
        height,
      }),
      rotation: angle(e.rotation + to.rotation - from.rotation),
    };
  });
}

/**
 * The elements mirrored across their group's frame, left to right or top to
 * bottom along its sides: each flips that way, and turns the other way.
 */
export function flipInFrame<
  E extends Turned & { flip_x: boolean; flip_y: boolean },
>(elements: E[], frame: Turned, key: "flip_x" | "flip_y"): E[] {
  const middle = centerOf(frame);
  return elements.map((e) => {
    const center = centerOf(e);
    const local = turn(
      { x: center.x - middle.x, y: center.y - middle.y },
      -frame.rotation,
    );
    const at = turn(
      key === "flip_x"
        ? { x: -local.x, y: local.y }
        : { x: local.x, y: -local.y },
      frame.rotation,
    );
    const next = {
      ...e,
      x: Math.round(middle.x + at.x - e.width / 2),
      y: Math.round(middle.y + at.y - e.height / 2),
      rotation: angle(2 * frame.rotation - e.rotation),
    };
    next[key] = !e[key];
    return next;
  });
}

/**
 * What a click on the canvas picks: the front-most element whose box, turned,
 * holds the point, skipping the locked groups and elements (`locked` holds
 * both ids), null for none. Hidden ones aren't in the view.
 */
export function pickElement(
  view: StudioView,
  locked: ReadonlySet<string>,
  point: Point,
): string | null {
  for (const layer of [...view.layers].reverse()) {
    if (locked.has(layer.id)) continue;
    const element = [...layer.elements]
      .reverse()
      .find((e) => !locked.has(e.id) && holdsTurned(e, point));
    if (element) return element.id;
  }
  return null;
}
