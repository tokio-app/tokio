import {
  STUDIO_SIZES,
  StudioLayer,
  StudioLayerKind,
  StudioLayerOf,
  StudioLayerSchema,
  StudioOverlay,
  StudioSize,
  StudioSource,
} from "../schemas/studio";
import type { AppEvents, TokioEventMap } from "../types/connector";
import type { CustomGift } from "../types/overlay";
import type {
  StudioLayerView,
  StudioNumbers,
  StudioView,
} from "../types/studio";
import {
  ALERT_MESSAGE_VARIABLES,
  formatAlertMessage,
  mediaKind,
} from "./alerts";
import { formatStat } from "./format";

// The live numbers any text can show, as {likes}
const STUDIO_NUMBERS: (keyof StudioNumbers)[] = [
  "likes",
  "viewers",
  "followers",
  "shares",
  "coins",
];

// Made up, for the editor, which shows samples instead of the LIVE's
export const SAMPLE_NUMBERS: StudioNumbers = {
  likes: 12_840,
  viewers: 236,
  followers: 58,
  shares: 17,
  coins: 4_210,
};

// Whether a text shows a live number, so main sends it again as they change
export const usesNumbers = (text: string) =>
  STUDIO_NUMBERS.some((name) => text.includes(`{${name}}`));

// The variables a layer's text can use: the live numbers, plus its trigger's
// values when it reacts to one
export const studioVariables = (layer: StudioLayer): string[] =>
  layer.when === "always"
    ? [...STUDIO_NUMBERS]
    : [...STUDIO_NUMBERS, ...ALERT_MESSAGE_VARIABLES[layer.trigger.type]];

// Own keys only, so {constructor} isn't a number
const isNumber = (
  numbers: StudioNumbers,
  name: string,
): name is keyof StudioNumbers => Object.hasOwn(numbers, name);

type FillOptions = {
  numbers: StudioNumbers;
  // The event that set the layer off, null before the first
  values: TokioEventMap[AppEvents] | null;
  // The trigger's variables, which read "" while values is null
  variables: string[];
  language: string;
};

/**
 * A studio text with its variables filled: the live numbers first, compact
 * (1.2K), then the event's values in one pass, so a viewer's comment that
 * says {likes} stays as typed. Other variables stay as written.
 */
export function fillStudioText(
  template: string,
  { numbers, values, variables, language }: FillOptions,
): string {
  const text = template.replace(/\{(\w+)\}/g, (match, name: string) => {
    if (isNumber(numbers, name)) {
      return formatStat(numbers[name], language).short;
    }
    return values === null && variables.includes(name) ? "" : match;
  });
  return values === null ? text : formatAlertMessage(text, values);
}

// What studioView needs from main or the editor
export type StudioViewDeps = {
  // TikTok's gifts then the custom ones: the first match wins
  gifts: CustomGift[];
  // Whether the overlay server serves an installed overlay's id
  served: (id: string) => boolean;
  // Where a media library file loads from; the editor gives each layer its
  // own player URL
  mediaURL: (file: string, layerId: string) => string;
  // Where an embed loads from
  embedPath: (source: StudioSource) => string;
  // A text layer's text, filled (fillStudioText)
  text: (layer: StudioLayerOf<"text">) => string;
  // The viewer's picture ("" for none) and name a viewer layer shows
  viewer: (layer: StudioLayerOf<"viewer">) => { src: string; name: string };
  // An embed's name, for the editor
  label: (source: StudioSource) => string;
};

function layerView(
  layer: StudioLayer,
  z: number,
  deps: StudioViewDeps,
): StudioLayerView {
  const base = {
    id: layer.id,
    x: layer.x,
    y: layer.y,
    width: layer.width,
    height: layer.height,
    z,
    opacity: layer.opacity,
    when: layer.when,
    seconds: layer.seconds,
    entrance: layer.entrance,
    animation: layer.animation,
  };
  switch (layer.kind) {
    case "text": {
      const { font, size, color, align, bold, halo } = layer;
      return {
        ...base,
        kind: layer.kind,
        text: deps.text(layer),
        font,
        size,
        color,
        align,
        bold,
        halo,
      };
    }
    case "media": {
      const kind = layer.file ? mediaKind(layer.file) : null;
      return {
        ...base,
        kind: layer.kind,
        src: kind ? deps.mediaURL(layer.file, layer.id) : null,
        video: kind === "video",
      };
    }
    case "gift": {
      const gift = deps.gifts.find((g) => g.value === layer.gift);
      return { ...base, kind: layer.kind, src: gift?.img || null };
    }
    case "emote":
      return { ...base, kind: layer.kind, src: layer.emote?.image ?? null };
    case "shape":
      return {
        ...base,
        kind: layer.kind,
        color: layer.color,
        radius: layer.radius,
      };
    case "viewer":
      return { ...base, kind: layer.kind, ...deps.viewer(layer) };
    // overlay
    default: {
      const { source } = layer;
      const loads =
        source !== null &&
        (source.type !== "installed" || deps.served(source.id));
      return {
        ...base,
        kind: layer.kind,
        source,
        src: loads ? deps.embedPath(source) : null,
        label: source ? deps.label(source) : "",
      };
    }
  }
}

/**
 * The overlay as its page draws it, for main to send and the editor to show:
 * the canvas, and each layer resolved, back to front.
 */
export function studioView(
  overlay: StudioOverlay,
  deps: StudioViewDeps,
): StudioView {
  return {
    ...STUDIO_SIZES[overlay.size],
    layers: overlay.layers.map((layer, z): StudioLayerView =>
      layerView(layer, z, deps),
    ),
  };
}

// The box a new layer of each kind starts with, in px of the canvas
const NEW_BOXES: Record<StudioLayerKind, { width: number; height: number }> = {
  text: { width: 720, height: 160 },
  media: { width: 480, height: 480 },
  gift: { width: 240, height: 240 },
  emote: { width: 200, height: 200 },
  shape: { width: 640, height: 320 },
  viewer: { width: 240, height: 240 },
  overlay: { width: 720, height: 720 },
};

/**
 * A new layer of the kind, centered on the canvas, with the defaults. A
 * viewer's picture shows on an event, since it needs one.
 */
export function newStudioLayer(
  kind: StudioLayerKind,
  size: StudioSize,
): StudioLayer {
  const box = NEW_BOXES[kind];
  const canvas = STUDIO_SIZES[size];
  return StudioLayerSchema.parse({
    id: crypto.randomUUID(),
    kind,
    ...box,
    x: Math.round((canvas.width - box.width) / 2),
    y: Math.round((canvas.height - box.height) / 2),
    ...(kind === "viewer" && { when: "event" }),
  });
}
