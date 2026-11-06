import { MessageKey } from "@/common/i18n";
import {
  StudioElement,
  StudioElementKind,
  StudioElementOf,
  StudioLayer,
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
  TOKIO_EVENTS,
  TokioEventMap,
} from "@/common/types";
import {
  fillStudioText,
  generateTikTokEventSample,
  SAMPLE_NUMBERS,
  studioVariables,
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
      const event = type === EMOTE_TRIGGER ? TOKIO_EVENTS.CHAT : type;
      sample = generateTikTokEventSample(event).data;
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

/** A text element's text with the sample numbers and its trigger's sample. */
export const sampleText = (
  element: StudioElementOf<"text">,
  samples: Samples,
  language: string,
) =>
  fillStudioText(element.text, {
    numbers: SAMPLE_NUMBERS,
    values: sampleOf(element, samples),
    variables: studioVariables(element),
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
 * What the layers list calls an element: what it shows (its text, file,
 * gift, emote or embed), else its kind.
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
export function moveLayer<T>(layers: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || to >= layers.length) return layers;
  const next = [...layers];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

/** Where an element is: its layer's index and its own, back to front. */
export function findElement(layers: StudioLayer[], id: string) {
  for (const [layer, { elements }] of layers.entries()) {
    const index = elements.findIndex((e) => e.id === id);
    if (index !== -1) return { layer, index };
  }
  return null;
}

/**
 * The layers with an element moved into the layer `to` (its id), at `at`:
 * an index of that layer's elements back to front, once the element is
 * taken out. The layer it goes into unfolds.
 */
export function moveElement(
  layers: StudioLayer[],
  id: string,
  to: string,
  at: number,
): StudioLayer[] {
  const from = findElement(layers, id);
  if (!from || !layers.some((l) => l.id === to)) return layers;
  const element = layers[from.layer].elements[from.index];
  return layers
    .map((layer, i) =>
      i === from.layer
        ? { ...layer, elements: layer.elements.filter((e) => e.id !== id) }
        : layer,
    )
    .map((layer) => {
      if (layer.id !== to) return layer;
      const elements = [...layer.elements];
      elements.splice(Math.max(0, at), 0, element);
      return { ...layer, folded: false, elements };
    });
}

/**
 * The layers with an element one step toward the front (`by` 1) or the back
 * (-1). Past its layer's edge it goes into the next layer that way, at the
 * edge it comes in from: the back going toward the front.
 */
export function stepElement(
  layers: StudioLayer[],
  id: string,
  by: 1 | -1,
): StudioLayer[] {
  const from = findElement(layers, id);
  if (!from) return layers;
  const own = layers[from.layer];
  const to = from.index + by;
  if (to >= 0 && to < own.elements.length) {
    return moveElement(layers, id, own.id, to);
  }
  const next = layers[from.layer + by] as StudioLayer | undefined;
  if (!next) return layers;
  return moveElement(layers, id, next.id, by === 1 ? 0 : next.elements.length);
}

export type Box = Pick<StudioElement, "x" | "y" | "width" | "height">;
export type Point = { x: number; y: number };

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

export const holds = (box: Box, { x, y }: Point) =>
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

/**
 * What a click on the canvas picks: the front-most element whose box holds
 * the point, skipping the locked layers, null for none. Hidden layers aren't
 * in the view.
 */
export function pickElement(
  view: StudioView,
  locked: ReadonlySet<string>,
  point: Point,
): string | null {
  for (const layer of [...view.layers].reverse()) {
    if (locked.has(layer.id)) continue;
    const element = [...layer.elements].reverse().find((e) => holds(e, point));
    if (element) return element.id;
  }
  return null;
}
