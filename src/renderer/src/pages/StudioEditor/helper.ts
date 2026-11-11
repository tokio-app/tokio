import { MessageKey } from "@/common/i18n";
import {
  StudioAlign,
  StudioCrop,
  StudioElement,
  StudioElementKind,
  StudioElementOf,
  StudioGuides,
  StudioItem,
  StudioOverlay,
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
  reactsToEvents,
  SAMPLE_NUMBERS,
  sentPicture,
  studioEventVariables,
} from "@/common/util";
import { EmoteOption } from "@/components";

export const KIND_NAMES: Record<StudioElementKind, MessageKey> = {
  text: "studio.kinds.text",
  media: "studio.kinds.media",
  camera: "studio.kinds.camera",
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
  reactsToEvents(element) ? samples.of(element.trigger.type) : null;

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
 * text, file, gift, emote, embed or shape), else its kind.
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
      case "camera":
        return element.camera?.label;
      case "gift":
        return context.gifts.find((g) => g.value === element.gift)?.label;
      case "emote":
        return context.emotes.find((e) => e.value === element.emote?.id)?.label;
      case "overlay":
        return element.source && context.label(element.source);
      case "shape":
        return context.t(`studio.shapes.${element.shape}`);
      default:
        return "";
    }
  })();
  return shown || context.t(KIND_NAMES[element.kind]);
}

/** An element's or a group's When, as the layers list says it. */
export function whenText(
  item: Pick<StudioElement, "when" | "trigger">,
  t: (key: MessageKey, params?: Record<string, string>) => string,
) {
  if (item.when === "always") return t("studio.rows.always");
  if (item.when === "loop") return t("studio.rows.loop");
  const trigger = t(ALERT_TRIGGER_LABELS[item.trigger.type]);
  return t(
    item.when === "event" ? "studio.rows.event" : "studio.rows.animate",
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
 * The items with a deleted media file taken off every element that shows
 * it, which stays, empty. The same items when none shows it.
 */
export function withoutMedia(items: StudioItem[], file: string): StudioItem[] {
  const shows = (e: StudioElement): e is StudioElementOf<"media"> =>
    e.kind === "media" && e.file === file;
  const any = items.some((item) =>
    item.kind === "group" ? item.elements.some(shows) : shows(item),
  );
  if (!any) return items;
  return mapElements(items, (e) =>
    shows(e) ? { ...e, file: "", name: "" } : e,
  );
}

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

// The rotate cursor: a curved arrow with a head at each end, black on a white
// halo like the system's cursors, in a 32 px box around its hotspot (16, 16)
const ROTATE_GLYPH =
  '<path d="M8.3 17.41A8.5 8.5 0 0 1 23.7 17.41" fill="none" stroke="#fff" stroke-width="5.6" stroke-linecap="round"/>' +
  '<path d="M5.93 22.48L4.92 15.17L12.18 18.55ZM26.07 22.48L19.82 18.55L27.08 15.17Z" fill="#fff" stroke="#fff" stroke-width="3" stroke-linejoin="round"/>' +
  '<path d="M8.3 17.41A8.5 8.5 0 0 1 23.7 17.41" fill="none" stroke="#000" stroke-width="2.4"/>' +
  '<path d="M5.93 22.48L4.92 15.17L12.18 18.55ZM26.07 22.48L19.82 18.55L27.08 15.17Z" fill="#000" stroke="#000" stroke-width="0.6" stroke-linejoin="round"/>';

// Each turn's cursor, made once
const rotateCursors = new Map<number, string>();

/**
 * The rotate cursor turned by `degrees`, in steps of 5, as a CSS cursor: at an
 * element's or a group's turn, it lies along the circle around its middle,
 * where the rotate handle is. Drawn at 1x and 2x, so it stays sharp on a dense
 * screen.
 */
export function rotateCursor(degrees: number): string {
  const step = (((Math.round(degrees / 5) * 5) % 360) + 360) % 360;
  let cursor = rotateCursors.get(step);
  if (!cursor) {
    const url = (px: number) =>
      `url("data:image/svg+xml,${encodeURIComponent(
        `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 32 32"><g transform="rotate(${step} 16 16)">${ROTATE_GLYPH}</g></svg>`,
      )}")`;
    cursor = `image-set(${url(32)} 1x, ${url(64)} 2x) 16 16, grab`;
    rotateCursors.set(step, cursor);
  }
  return cursor;
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

/**
 * The overlay as a step of the history had it, with the editor's view as it
 * is now, which Undo leaves alone: each of its groups folded as now, and its
 * rulers shown or not as now.
 */
export function withView(
  overlay: StudioOverlay,
  now: StudioOverlay,
): StudioOverlay {
  const folded = new Map(
    now.items.flatMap((item) =>
      item.kind === "group" ? [[item.id, item.folded] as const] : [],
    ),
  );
  return {
    ...overlay,
    rulers: now.rulers,
    items: overlay.items.map((item) => {
      if (item.kind !== "group") return item;
      const fold = folded.get(item.id) ?? item.folded;
      return fold === item.folded ? item : { ...item, folded: fold };
    }),
  };
}

/**
 * A copy of a group or an element to paste, with new ids (they're unique
 * across both), moved `by` px right and down: a group's elements with it.
 */
export function copyItem(item: StudioItem, by: number): StudioItem {
  const moved = (element: StudioElement): StudioElement => ({
    ...element,
    id: crypto.randomUUID(),
    x: element.x + by,
    y: element.y + by,
  });
  return item.kind === "group"
    ? { ...item, id: crypto.randomUUID(), elements: item.elements.map(moved) }
    : moved(item);
}

// The canvas's zooms, in screen px per canvas px, that its buttons and keys
// step through. Ctrl and the wheel go anywhere between the first and last.
const ZOOMS = [0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
const MIN_ZOOM = ZOOMS[0];
const MAX_ZOOM = ZOOMS[ZOOMS.length - 1];

export const clampZoom = (scale: number) =>
  Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));

/** The next zoom in (1) or out (-1) from a scale, null past the last. */
export function zoomStep(scale: number, by: 1 | -1): number | null {
  // A hair's room, so a scale on a step goes on to the next one
  const next =
    by > 0
      ? ZOOMS.find((zoom) => zoom > scale * 1.001)
      : [...ZOOMS].reverse().find((zoom) => zoom < scale / 1.001);
  return next ?? null;
}

// Canvas px between a ruler's numbers: the first of these that leaves this
// many screen px between them
const RULER_STEPS = [20, 50, 100, 200, 500, 1000];
const RULER_GAP = 60;

export type RulerTick = {
  // Screen px from the ruler's start
  at: number;
  // Canvas px from the canvas's edge
  value: number;
  // A number's tick is the longest, then the one halfway between numbers
  size: "number" | "half" | "tick";
};

/**
 * A ruler's ticks along its length, in screen px, with the canvas's edge
 * `origin` px from its start (negative once it scrolled past): a number every
 * so many canvas px, fewer the further it's zoomed out, and a tick every
 * tenth of that.
 */
export function rulerTicks(
  origin: number,
  scale: number,
  length: number,
): RulerTick[] {
  if (!(scale > 0) || length <= 0) return [];
  const step =
    RULER_STEPS.find((s) => s * scale >= RULER_GAP) ??
    RULER_STEPS[RULER_STEPS.length - 1];
  const gap = (step / 10) * scale;
  const ticks: RulerTick[] = [];
  for (let i = Math.ceil(-origin / gap) || 0; origin + i * gap <= length; i++) {
    ticks.push({
      at: origin + i * gap,
      value: (i * step) / 10,
      size: i % 10 === 0 ? "number" : i % 5 === 0 ? "half" : "tick",
    });
  }
  return ticks;
}

// A guide's axis: a vertical guide sits at an x, a horizontal one at a y
export type Axis = "x" | "y";
export const AXES = ["x", "y"] as const;

// A line a drag can stick to, in px of the canvas: where it crosses its
// axis, and how far it runs along the other one, for the rose line that
// shows it. A guide runs the whole view.
export type SnapLine = { at: number; from: number; to: number };
export type SnapLines = Record<Axis, SnapLine[]>;
// A rose line on the canvas: a line a box meets, across the box too
export type MetLine = SnapLine & { axis: Axis };

// A box's edges and middle on an axis, each running along the box
const linesOf = (box: Box, axis: Axis): SnapLine[] => {
  const [start, size, from, length] =
    axis === "x"
      ? [box.x, box.width, box.y, box.height]
      : [box.y, box.height, box.x, box.width];
  return [start, start + size / 2, start + size].map((at) => ({
    at,
    from,
    to: from + length,
  }));
};

/**
 * What a drag can stick to: the canvas's edges and middle, each box's as it
 * shows (a turned one by its extent), and the guides, null for none.
 */
export function snapLines(
  canvas: { width: number; height: number },
  boxes: Turned[],
  guides: StudioGuides | null,
): SnapLines {
  const shown = [{ x: 0, y: 0, ...canvas }, ...boxes.map(extent)];
  const lines = (axis: Axis) => [
    ...shown.flatMap((box) => linesOf(box, axis)),
    ...(guides?.[axis] ?? []).map((at) => ({
      at,
      from: -Infinity,
      to: Infinity,
    })),
  ];
  return { x: lines("x"), y: lines("y") };
}

// How far to move so the nearest of the points meets the nearest line, 0
// when none is within reach
function stick(points: number[], lines: SnapLine[], reach: number): number {
  let shift = 0;
  let nearest = reach;
  for (const { at } of lines) {
    for (const point of points) {
      const gap = Math.abs(at - point);
      if (gap <= nearest) {
        nearest = gap;
        shift = at - point;
      }
    }
  }
  return shift;
}

/**
 * How far to move a box, on each axis, for its nearest edge or middle as it
 * shows to meet a line within reach.
 */
export function snapBox(box: Turned, lines: SnapLines, reach: number): Point {
  const shown = extent(box);
  const at = (axis: Axis) => linesOf(shown, axis).map((line) => line.at);
  return {
    x: stick(at("x"), lines.x, reach),
    y: stick(at("y"), lines.y, reach),
  };
}

/** How far to move a point, on each axis, to meet a line within reach. */
export const snapPoint = (
  point: Point,
  lines: SnapLines,
  reach: number,
): Point => ({
  x: stick([point.x], lines.x, reach),
  y: stick([point.y], lines.y, reach),
});

/**
 * The rose lines for a box: each of its edges and middle, as it shows, that
 * meets a line within half a px, across the box and everything it meets
 * there.
 */
export function metLines(box: Turned, lines: SnapLines): MetLine[] {
  const shown = extent(box);
  return AXES.flatMap((axis) =>
    linesOf(shown, axis).flatMap((own) => {
      const met = lines[axis].filter(
        (line) => Math.abs(line.at - own.at) < 0.5,
      );
      if (met.length === 0) return [];
      return [
        {
          axis,
          at: own.at,
          from: Math.min(own.from, ...met.map((line) => line.from)),
          to: Math.max(own.to, ...met.map((line) => line.to)),
        },
      ];
    }),
  );
}

/** Where a corner of a box is on the canvas, turned with it. */
export function cornerOf(box: Turned, corner: Corner): Point {
  const { x, y } = turn(
    {
      x: (corner.endsWith("w") ? -box.width : box.width) / 2,
      y: (corner.startsWith("n") ? -box.height : box.height) / 2,
    },
    box.rotation,
  );
  return { x: box.x + box.width / 2 + x, y: box.y + box.height / 2 + y };
}

const OPPOSITE: Record<Corner, Corner> = {
  nw: "se",
  ne: "sw",
  sw: "ne",
  se: "nw",
};

/**
 * A corner drag's move (dx, dy), in px of the canvas, changed so the corner
 * sticks to a line within reach: `resized` is the box the drag gives as it
 * is. With `even` (Link on) the corner keeps to the box's diagonal, so it
 * sticks on the nearer axis only.
 */
export function stickCorner(
  box: Turned,
  resized: Turned,
  corner: Corner,
  move: Point,
  lines: SnapLines,
  reach: number,
  even: boolean,
): Point {
  const shift = snapPoint(cornerOf(resized, corner), lines, reach);
  if (!even) return { x: move.x + shift.x, y: move.y + shift.y };
  const far = cornerOf(box, corner);
  const near = cornerOf(box, OPPOSITE[corner]);
  const diagonal = { x: far.x - near.x, y: far.y - near.y };
  const axis =
    !shift.y || (shift.x && Math.abs(shift.x) <= Math.abs(shift.y)) ? "x" : "y";
  if (!shift[axis] || !diagonal[axis]) return move;
  // Along the diagonal, as far as it takes the corner to the line
  const along = shift[axis] / diagonal[axis];
  return { x: move.x + along * diagonal.x, y: move.y + along * diagonal.y };
}

/** The guide nearest a point within reach, by its axis and place. */
export function nearGuide(
  point: Point,
  guides: StudioGuides,
  reach: number,
): { axis: Axis; index: number } | null {
  let found: { axis: Axis; index: number } | null = null;
  let nearest = reach;
  for (const axis of AXES) {
    for (const [index, at] of guides[axis].entries()) {
      const gap = Math.abs(point[axis] - at);
      if (gap <= nearest) {
        nearest = gap;
        found = { axis, index };
      }
    }
  }
  return found;
}

/**
 * The guides with one moved to `at`, added (`index` null) or taken away
 * (`at` null).
 */
export function withGuide(
  guides: StudioGuides,
  axis: Axis,
  index: number | null,
  at: number | null,
): StudioGuides {
  const lines = [...guides[axis]];
  if (index === null) {
    if (at !== null) lines.push(at);
  } else if (at === null) {
    lines.splice(index, 1);
  } else {
    lines[index] = at;
  }
  return axis === "x" ? { ...guides, x: lines } : { ...guides, y: lines };
}

/**
 * Where a dragged guide goes: whole px, on the nearest line within reach.
 * Never -0, which JSON brings back as 0.
 */
export const guideAt = (value: number, lines: SnapLine[], reach: number) =>
  Math.round(value + stick([value], lines, reach)) || 0;

// A picture's own size
export type Size = { width: number; height: number };
// Mirrored left to right, and top to bottom
type Flips = { flip_x: boolean; flip_y: boolean };
// An element with a picture, as far as cropping it goes
type Pictured = Turned & Flips & { crop: StudioCrop };
// Where a crop is: all of the picture and the part it keeps, in its
// element's box's own px from its top left corner, unturned
export type CropFrames = { picture: Box; frame: Box };

// A crop that keeps all of the picture
export const WHOLE: StudioCrop = { left: 0, top: 0, right: 0, bottom: 0 };

/**
 * Where a picture shows in its element's box: all of it, and the part its
 * crop keeps, which fits the box as contain fits a whole picture. A flip
 * shows a crop's left side on the right.
 */
export function pictureFrames(element: Pictured, own: Size): CropFrames {
  const { left, top, right, bottom } = element.crop;
  const kept = {
    width: (1 - left - right) * own.width,
    height: (1 - top - bottom) * own.height,
  };
  const scale = Math.min(
    element.width / kept.width,
    element.height / kept.height,
  );
  const frame = {
    x: (element.width - kept.width * scale) / 2,
    y: (element.height - kept.height * scale) / 2,
    width: kept.width * scale,
    height: kept.height * scale,
  };
  const width = own.width * scale;
  const height = own.height * scale;
  return {
    picture: {
      x: frame.x - (element.flip_x ? right : left) * width,
      y: frame.y - (element.flip_y ? bottom : top) * height,
      width,
      height,
    },
    frame,
  };
}

/** The part of the picture a crop keeps, wherever the picture is. */
export function frameOf(picture: Box, crop: StudioCrop, flips: Flips): Box {
  return {
    x: picture.x + (flips.flip_x ? crop.right : crop.left) * picture.width,
    y: picture.y + (flips.flip_y ? crop.bottom : crop.top) * picture.height,
    width: (1 - crop.left - crop.right) * picture.width,
    height: (1 - crop.top - crop.bottom) * picture.height,
  };
}

// A share to 4 decimals, between 0 and 1, never -0
const share = (n: number) =>
  Math.min(1, Math.max(0, Math.round(n * 10000) / 10000)) || 0;

/** The crop that keeps a frame of the picture, its sides to 4 decimals. */
export function cropOf(picture: Box, frame: Box, flips: Flips): StudioCrop {
  const before = {
    x: (frame.x - picture.x) / picture.width,
    y: (frame.y - picture.y) / picture.height,
  };
  const after = {
    x: (picture.x + picture.width - frame.x - frame.width) / picture.width,
    y: (picture.y + picture.height - frame.y - frame.height) / picture.height,
  };
  return {
    left: share(flips.flip_x ? after.x : before.x),
    top: share(flips.flip_y ? after.y : before.y),
    right: share(flips.flip_x ? before.x : after.x),
    bottom: share(flips.flip_y ? before.y : after.y),
  };
}

/**
 * A rect in an element's box's own px, unturned, as a box on the canvas: its
 * middle turned with the element around the box's middle.
 */
export function boxOn(element: Turned, local: Box): Turned {
  const middle = turn(
    {
      x: local.x + local.width / 2 - element.width / 2,
      y: local.y + local.height / 2 - element.height / 2,
    },
    element.rotation,
  );
  return {
    x: element.x + element.width / 2 + middle.x - local.width / 2,
    y: element.y + element.height / 2 + middle.y - local.height / 2,
    width: local.width,
    height: local.height,
    rotation: element.rotation,
  };
}

/**
 * An element's box and crop for a new crop, its picture kept where it shows
 * and as big: the box, in whole px, becomes the part the crop keeps.
 */
export function recrop(
  element: Pictured,
  own: Size,
  crop: StudioCrop,
): Box & { crop: StudioCrop } {
  const { picture } = pictureFrames(element, own);
  return { ...roundBox(boxOn(element, frameOf(picture, crop, element))), crop };
}

// The crop frame's handles: its corners and its sides' middles
export const CROP_SIDES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"] as const;
export type CropSide = (typeof CROP_SIDES)[number];

// The least a crop keeps across and down, in px of the canvas
const CROP_MIN = 8;

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));

/**
 * A crop dragged by (dx, dy) px of the canvas from where it began, the move
 * turned back into its box's own axes. A side or corner moves the frame's
 * sides, within the picture and at least CROP_MIN apart; none, a press inside
 * the frame, moves the picture under it, which keeps the frame inside.
 */
export function cropDrag(
  from: CropFrames,
  side: CropSide | null,
  dx: number,
  dy: number,
  rotation: number,
): CropFrames {
  const along = turn({ x: dx, y: dy }, -rotation);
  const { picture, frame } = from;
  if (side === null) {
    return {
      picture: {
        ...picture,
        x: clamp(
          picture.x + along.x,
          frame.x + frame.width - picture.width,
          frame.x,
        ),
        y: clamp(
          picture.y + along.y,
          frame.y + frame.height - picture.height,
          frame.y,
        ),
      },
      frame,
    };
  }
  let left = frame.x;
  let top = frame.y;
  let right = frame.x + frame.width;
  let bottom = frame.y + frame.height;
  if (side.includes("w")) {
    left = clamp(left + along.x, picture.x, right - CROP_MIN);
  }
  if (side.includes("e")) {
    right = clamp(right + along.x, left + CROP_MIN, picture.x + picture.width);
  }
  if (side.includes("n")) {
    top = clamp(top + along.y, picture.y, bottom - CROP_MIN);
  }
  if (side.includes("s")) {
    bottom = clamp(
      bottom + along.y,
      top + CROP_MIN,
      picture.y + picture.height,
    );
  }
  return {
    picture,
    frame: { x: left, y: top, width: right - left, height: bottom - top },
  };
}

/** What a picture element shows, which a new one of resets its crop. */
export const pictureSource = (element: StudioElement) =>
  element.kind === "media"
    ? element.file
    : element.kind === "gift"
      ? element.gift
      : element.kind === "emote"
        ? (element.emote?.id ?? null)
        : null;
