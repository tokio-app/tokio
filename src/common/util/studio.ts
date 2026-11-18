import {
  GOAL_TRIGGER,
  STUDIO_SIZES,
  StudioElement,
  StudioElementKind,
  StudioElementOf,
  StudioElementSchema,
  StudioGroup,
  StudioGroupSchema,
  StudioOverlay,
  StudioPictureKind,
  StudioSize,
  StudioSource,
  StudioTrigger,
} from "../schemas/studio";
import {
  EMOTE_TRIGGER,
  TOKIO_EVENTS,
  type AlertTrigger,
  type AppEvents,
  type TokioEventMap,
} from "../types/connector";
import type { CustomGift } from "../types/overlay";
import type {
  StudioElementView,
  StudioGradientView,
  StudioNumbers,
  StudioReact,
  StudioView,
} from "../types/studio";
import { countedVariables, mediaKind, messageValues } from "./alerts";
import { formatDuration, formatStat } from "./format";
import { generateEmoteChatSample, generateTikTokEventSample } from "./samples";

// The live numbers any text can show, as {likes}
export const STUDIO_NUMBERS: (keyof StudioNumbers)[] = [
  "likes",
  "viewers",
  "followers",
  "shares",
  "coins",
  "gifts",
  "uptime",
];

// Made up, for the editor, which shows samples instead of the LIVE's
export const SAMPLE_NUMBERS: StudioNumbers = {
  likes: 12_840,
  viewers: 236,
  followers: 58,
  shares: 17,
  coins: 4_210,
  gifts: 342,
  // 01:23:00
  uptime: 4_980,
};

// Made up too: each counter's sample count
export const SAMPLE_COUNT = 12;

// Whether a text shows a live number, so main sends it again as they change
export const usesNumbers = (text: string) =>
  STUDIO_NUMBERS.some((name) => text.includes(`{${name}}`));

// Whether an element or a group reacts to its trigger: one that's always on
// screen or moves all the time has none
export const reactsToEvents = (item: Pick<StudioElement, "when">) =>
  item.when === "event" || item.when === "animate";

// Every trigger an element or a group reacts to, its first first
export const triggersOf = (
  item: Pick<StudioElement, "trigger" | "also_triggers">,
): StudioTrigger[] => [item.trigger, ...item.also_triggers];

// The variables a text element gets from its triggers, all of theirs, none
// while it doesn't react. A goal sends none. The live numbers
// (STUDIO_NUMBERS) go in any text.
export const studioEventVariables = (element: StudioElement): string[] =>
  reactsToEvents(element)
    ? [
        ...new Set(
          triggersOf(element).flatMap((trigger) =>
            trigger.type === GOAL_TRIGGER ? [] : countedVariables(trigger.type),
          ),
        ),
      ]
    : [];

// The overlay's counters as sample counts, for the editor and MCP's preview
export const sampleCounts = (
  overlay: Pick<StudioOverlay, "counters">,
): Record<string, number> =>
  Object.fromEntries(overlay.counters.map((c) => [c.name, SAMPLE_COUNT]));

// Every element of the overlay, its layers' in order
export const studioElements = (overlay: StudioOverlay): StudioElement[] =>
  overlay.items.flatMap((item) =>
    item.kind === "group" ? item.elements : [item],
  );

// Own keys only, so {constructor} isn't a number
const isNumber = (
  numbers: StudioNumbers,
  name: string,
): name is keyof StudioNumbers => Object.hasOwn(numbers, name);

type FillOptions = {
  numbers: StudioNumbers;
  // The overlay's counters by name, after the live numbers
  counters: Record<string, number>;
  // The event that set the element off, null before the first
  values: TokioEventMap[AppEvents] | null;
  // Its triggers' variables, which read "" where the event has none
  variables: string[];
  language: string;
};

/**
 * A studio text with its variables filled in one pass, so a viewer's
 * comment that says {likes} stays as typed: the live numbers, compact (1.2K)
 * and the LIVE's length as 01:02:03, then the counters by name, then the
 * event's values. A variable of its triggers this event lacks reads "", and
 * any other stays as written.
 */
export function fillStudioText(
  template: string,
  { numbers, counters, values, variables, language }: FillOptions,
): string {
  const sent = values === null ? null : messageValues(values);
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    if (isNumber(numbers, name)) {
      return name === "uptime"
        ? formatDuration(numbers.uptime * 1000)
        : formatStat(numbers[name], language).short;
    }
    if (Object.hasOwn(counters, name)) {
      return formatStat(counters[name], language).short;
    }
    const value = sent?.get(name);
    if (value !== undefined) return value;
    return variables.includes(name) ? "" : match;
  });
}

// What studioView needs from main or the editor
export type StudioViewDeps = {
  // TikTok's gifts then the custom ones: the first match wins
  gifts: CustomGift[];
  // Whether the overlay server serves an installed overlay's id
  served: (id: string) => boolean;
  // Where a media library file loads from; the editor gives each element
  // its own player URL
  mediaURL: (file: string, elementId: string) => string;
  // Where an embed loads from
  embedPath: (source: StudioSource) => string;
  // Where a camera element's stream loads from, null for nowhere
  camera: (element: StudioElementOf<"camera">) => string | null;
  // A text element's text, filled (fillStudioText)
  text: (element: StudioElementOf<"text">) => string;
  // The viewer's picture ("" for none) and name a viewer element shows
  viewer: (element: StudioElementOf<"viewer">) => {
    src: string;
    name: string;
  };
  // The picture of the gift or emote a gift or emote element's last event
  // sent, "" for none (sentPicture)
  sent: (element: StudioElementOf<"gift" | "emote">) => string;
  // An embed's name, for the editor
  label: (source: StudioSource) => string;
};

// A text's or a shape's fade, null with it off
const gradientOf = (
  element: StudioElementOf<"text" | "shape">,
): StudioGradientView =>
  element.gradient
    ? { color: element.gradient_color, angle: element.gradient_angle }
    : null;

function elementView(
  element: StudioElement,
  z: number,
  deps: StudioViewDeps,
): StudioElementView {
  const base = {
    id: element.id,
    x: element.x,
    y: element.y,
    width: element.width,
    height: element.height,
    rotation: element.rotation,
    flip_x: element.flip_x,
    flip_y: element.flip_y,
    z,
    opacity: element.opacity,
    shadow: element.shadow
      ? {
          color: element.shadow_color,
          blur: element.shadow_blur,
          x: element.shadow_x,
          y: element.shadow_y,
        }
      : null,
    blur: element.blur,
    when: element.when,
    seconds: element.seconds,
    entrance: element.entrance,
    exit: element.exit,
    animation: element.animation,
    idle: element.idle,
  };
  // A picture's crop, null when it keeps all of itself, and its rounding
  const picture = (shown: StudioElementOf<StudioPictureKind>) => {
    const { left, top, right, bottom } = shown.crop;
    return {
      crop:
        left || top || right || bottom ? { left, top, right, bottom } : null,
      rounding: shown.rounding,
    };
  };
  switch (element.kind) {
    case "text": {
      const { font, size, color, align, bold, halo } = element;
      const { letter_spacing, line_height, italic, caps } = element;
      return {
        ...base,
        kind: element.kind,
        text: deps.text(element),
        font,
        size,
        color,
        align,
        bold,
        halo,
        gradient: gradientOf(element),
        outline: element.outline
          ? { color: element.outline_color, width: element.outline_width }
          : null,
        letter_spacing,
        line_height,
        italic,
        caps,
      };
    }
    case "media": {
      const kind = element.file ? mediaKind(element.file) : null;
      return {
        ...base,
        ...picture(element),
        kind: element.kind,
        src: kind ? deps.mediaURL(element.file, element.id) : null,
        video: kind === "video",
        start: element.start,
        end: element.end,
        loop: element.loop,
        volume: element.volume,
      };
    }
    case "camera":
      return {
        ...base,
        ...picture(element),
        kind: element.kind,
        src: deps.camera(element),
      };
    case "gift": {
      // No gift picked: the one its event sent
      if (element.gift === null) {
        return {
          ...base,
          ...picture(element),
          kind: element.kind,
          src: deps.sent(element) || null,
        };
      }
      const gift = deps.gifts.find((g) => g.value === element.gift);
      return {
        ...base,
        ...picture(element),
        kind: element.kind,
        src: gift?.img || null,
      };
    }
    case "emote":
      return {
        ...base,
        ...picture(element),
        kind: element.kind,
        // No emote picked: the one its event sent
        src: element.emote ? element.emote.image : deps.sent(element) || null,
      };
    case "shape":
      return {
        ...base,
        kind: element.kind,
        shape: element.shape,
        sides: element.sides,
        points: element.points,
        color: element.fill ? element.color : null,
        gradient: element.fill ? gradientOf(element) : null,
        radius: element.radius,
        border: element.border
          ? { color: element.border_color, width: element.border_width }
          : null,
      };
    case "viewer":
      return {
        ...base,
        ...picture(element),
        kind: element.kind,
        ...deps.viewer(element),
      };
    // overlay
    default: {
      const { source } = element;
      const loads =
        source !== null &&
        (source.type !== "installed" || deps.served(source.id));
      return {
        ...base,
        kind: element.kind,
        source,
        src: loads ? deps.embedPath(source) : null,
        label: source ? deps.label(source) : "",
      };
    }
  }
}

/**
 * The overlay as its page draws it, for main to send and the editor to show:
 * the canvas, and one stage layer per group or standalone element that isn't
 * hidden, with the elements that aren't, resolved, back to front. A z is the
 * place among all of them, hidden ones included, so hiding one doesn't
 * renumber the rest.
 */
export function studioView(
  overlay: StudioOverlay,
  deps: StudioViewDeps,
): StudioView {
  return {
    ...STUDIO_SIZES[overlay.size],
    layers: overlay.items.flatMap((item, z) => {
      if (item.hidden) return [];
      // An element on its own is a stage layer of its own
      const elements = item.kind === "group" ? item.elements : [item];
      return [
        {
          id: item.id,
          z,
          opacity: item.kind === "group" ? item.opacity : 1,
          group:
            item.kind === "group"
              ? {
                  when: item.when,
                  seconds: item.seconds,
                  entrance: item.entrance,
                  exit: item.exit,
                  animation: item.animation,
                  idle: item.idle,
                }
              : null,
          elements: elements.flatMap((element, at) =>
            element.hidden ? [] : [elementView(element, at, deps)],
          ),
        },
      ];
    }),
  };
}

// The box a new element of each kind starts with, in px of the canvas
const NEW_BOXES: Record<StudioElementKind, { width: number; height: number }> =
  {
    text: { width: 720, height: 160 },
    media: { width: 480, height: 480 },
    // A webcam's 16:9
    camera: { width: 640, height: 360 },
    gift: { width: 240, height: 240 },
    emote: { width: 200, height: 200 },
    shape: { width: 640, height: 320 },
    viewer: { width: 240, height: 240 },
    overlay: { width: 720, height: 720 },
  };

/**
 * A new element of the kind, centered on the canvas, with the defaults. A
 * viewer's picture shows on an event, since it needs one, and a gift or an
 * emote shows the one a viewer sends.
 */
export function newStudioElement(
  kind: StudioElementKind,
  size: StudioSize,
): StudioElement {
  const box = NEW_BOXES[kind];
  const canvas = STUDIO_SIZES[size];
  return StudioElementSchema.parse({
    id: crypto.randomUUID(),
    kind,
    ...box,
    x: Math.round((canvas.width - box.width) / 2),
    y: Math.round((canvas.height - box.height) / 2),
    ...(kind === "viewer" && { when: "event" }),
    ...(kind === "gift" && {
      when: "event",
      trigger: { type: TOKIO_EVENTS.GIFT, gifts: [] },
    }),
    ...(kind === "emote" && {
      when: "event",
      trigger: { type: EMOTE_TRIGGER, gifts: [] },
    }),
  });
}

/**
 * The picture of what an event sent for a gift or emote element: the gift,
 * or the message's emote its trigger names (the first, for any emote). ""
 * for none.
 */
export function sentPicture(
  element: StudioElement,
  values: TokioEventMap[AppEvents] | null,
): string {
  if (typeof values !== "object" || values === null) return "";
  if (element.kind === "gift" && "gift" in values) return values.gift.image;
  if (element.kind !== "emote" || !("comment" in values)) return "";
  const { emotes } = values.comment;
  const named = "emotes" in element.trigger ? element.trigger.emotes : [];
  // A sample's emotes aren't the ones named: it shows its first
  const emote = emotes.find((e) => named.includes(e.emoteID)) ?? emotes[0];
  return emote?.images[0] ?? "";
}

/** A new, empty group with the name, shown and unlocked. */
export const newStudioGroup = (name: string): StudioGroup =>
  StudioGroupSchema.parse({ kind: "group", id: crypto.randomUUID(), name });

type Sample = TokioEventMap[AppEvents];

/**
 * Each trigger's sample, made the first time an element asks for it, so its
 * names don't change on every render. Test starts a new one.
 */
export class Samples {
  private made = new Map<AlertTrigger, Sample>();

  of(type: AlertTrigger): Sample {
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

// Its first trigger's sample; a goal sends none
const sampleOf = (element: StudioElement, samples: Samples) =>
  reactsToEvents(element) && element.trigger.type !== GOAL_TRIGGER
    ? samples.of(element.trigger.type)
    : null;

/** The picture of the gift or emote its trigger's sample sent, "" for none. */
const sampleSentOf = (element: StudioElement, samples: Samples) =>
  sentPicture(element, sampleOf(element, samples));

/**
 * A text element's text with the sample numbers and counts, and its first
 * trigger's sample.
 */
const sampleText = (
  element: StudioElementOf<"text">,
  samples: Samples,
  language: string,
  counters: Record<string, number>,
) =>
  fillStudioText(element.text, {
    numbers: SAMPLE_NUMBERS,
    counters,
    values: sampleOf(element, samples),
    variables: studioEventVariables(element),
    language,
  });

/** The picture and name a viewer element shows, its trigger's sample's. */
const sampleViewerOf = (element: StudioElement, samples: Samples) =>
  element.trigger.type === GOAL_TRIGGER
    ? { src: "", name: "" }
    : sampleViewer(samples.of(element.trigger.type));

/** What Test plays on the stage for an element that reacts to an event. */
export function sampleReact(
  element: StudioElement,
  samples: Samples,
  language: string,
  counters: Record<string, number>,
): StudioReact {
  if (element.kind === "text") {
    const text = sampleText(element, samples, language, counters);
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

/**
 * The sample parts of a view's deps: what Test and the editor show, the
 * counters' sample counts (sampleCounts) included.
 */
export const sampleDeps = (
  samples: Samples,
  language: string,
  counters: Record<string, number>,
): Pick<StudioViewDeps, "text" | "viewer" | "sent"> => ({
  text: (element) => sampleText(element, samples, language, counters),
  viewer: (element) => sampleViewerOf(element, samples),
  sent: (element) => sampleSentOf(element, samples),
});
