import { MessageKey } from "@/common/i18n";
import {
  StudioLayer,
  StudioLayerKind,
  StudioLayerOf,
  StudioSource,
  Trigger,
} from "@/common/schemas";
import {
  ALERT_TRIGGER_LABELS,
  AppEvents,
  CustomGift,
  EMOTE_TRIGGER,
  StudioReact,
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

export const KIND_NAMES: Record<StudioLayerKind, MessageKey> = {
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
 * Each trigger's sample, made the first time a layer asks for it, so its
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

const sampleOf = (layer: StudioLayer, samples: Samples) =>
  layer.when === "always" ? null : samples.of(layer.trigger.type);

/** A text layer's text with the sample numbers and its trigger's sample. */
export const sampleText = (
  layer: StudioLayerOf<"text">,
  samples: Samples,
  language: string,
) =>
  fillStudioText(layer.text, {
    numbers: SAMPLE_NUMBERS,
    values: sampleOf(layer, samples),
    variables: studioVariables(layer),
    language,
  });

/** The picture and name a viewer layer shows, its trigger's sample's. */
export const sampleViewerOf = (layer: StudioLayer, samples: Samples) =>
  sampleViewer(samples.of(layer.trigger.type));

/** What Test plays on the stage for a layer that reacts to an event. */
export function sampleReact(
  layer: StudioLayer,
  samples: Samples,
  language: string,
): StudioReact {
  if (layer.kind === "text") {
    return { layer: layer.id, text: sampleText(layer, samples, language) };
  }
  if (layer.kind === "viewer") {
    const { src, name } = sampleViewerOf(layer, samples);
    return { layer: layer.id, picture: src, name };
  }
  return { layer: layer.id };
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
 * What the layers list calls a layer: what it shows (its text, file, gift,
 * emote or embed), else its kind.
 */
export function layerName(layer: StudioLayer, context: NameContext): string {
  const shown = (() => {
    switch (layer.kind) {
      case "text":
        return layer.text.trim().split("\n")[0];
      case "media":
        return layer.name;
      case "gift":
        return context.gifts.find((g) => g.value === layer.gift)?.label;
      case "emote":
        return context.emotes.find((e) => e.value === layer.emote?.id)?.label;
      case "overlay":
        return layer.source && context.label(layer.source);
      default:
        return "";
    }
  })();
  return shown || context.t(KIND_NAMES[layer.kind]);
}

/** Its When, as the layers list says it under the name. */
export function whenText(
  layer: StudioLayer,
  t: (key: MessageKey, params?: Record<string, string>) => string,
) {
  if (layer.when === "always") return t("studio.rows.always");
  const trigger = t(ALERT_TRIGGER_LABELS[layer.trigger.type]);
  return t(
    layer.when === "event" ? "studio.rows.event" : "studio.rows.animate",
    { trigger },
  );
}

/**
 * The overlay's layers with one moved from `from` to `to`, both indexes of
 * the layers back to front. Out of range moves nothing.
 */
export function moveLayer<T>(layers: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || to >= layers.length) return layers;
  const next = [...layers];
  next.splice(to, 0, ...next.splice(from, 1));
  return next;
}

export type Box = Pick<StudioLayer, "x" | "y" | "width" | "height">;

// Whole px, the size at least 1, as the schema keeps them
export const roundBox = ({ x, y, width, height }: Box): Box => ({
  x: Math.round(x),
  y: Math.round(y),
  width: Math.max(1, Math.round(width)),
  height: Math.max(1, Math.round(height)),
});
