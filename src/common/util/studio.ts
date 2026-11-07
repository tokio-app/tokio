import {
  STUDIO_SIZES,
  StudioElement,
  StudioElementKind,
  StudioElementOf,
  StudioElementSchema,
  StudioGroup,
  StudioGroupSchema,
  StudioOverlay,
  StudioSize,
  StudioSource,
} from "../schemas/studio";
import {
  EMOTE_TRIGGER,
  TOKIO_EVENTS,
  type AppEvents,
  type TokioEventMap,
} from "../types/connector";
import type { CustomGift } from "../types/overlay";
import type {
  StudioElementView,
  StudioNumbers,
  StudioView,
} from "../types/studio";
import { countedVariables, formatAlertMessage, mediaKind } from "./alerts";
import { formatStat } from "./format";

// The live numbers any text can show, as {likes}
export const STUDIO_NUMBERS: (keyof StudioNumbers)[] = [
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

// The variables a text element gets from its trigger, none while it's
// always on screen. The live numbers (STUDIO_NUMBERS) go in any text.
export const studioEventVariables = (element: StudioElement): string[] =>
  element.when === "always" ? [] : countedVariables(element.trigger.type);

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
  // The event that set the element off, null before the first
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
  // Where a media library file loads from; the editor gives each element
  // its own player URL
  mediaURL: (file: string, elementId: string) => string;
  // Where an embed loads from
  embedPath: (source: StudioSource) => string;
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
    when: element.when,
    seconds: element.seconds,
    entrance: element.entrance,
    animation: element.animation,
  };
  switch (element.kind) {
    case "text": {
      const { font, size, color, align, bold, halo } = element;
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
      };
    }
    case "media": {
      const kind = element.file ? mediaKind(element.file) : null;
      return {
        ...base,
        kind: element.kind,
        src: kind ? deps.mediaURL(element.file, element.id) : null,
        video: kind === "video",
      };
    }
    case "gift": {
      // No gift picked: the one its event sent
      if (element.gift === null) {
        return {
          ...base,
          kind: element.kind,
          src: deps.sent(element) || null,
        };
      }
      const gift = deps.gifts.find((g) => g.value === element.gift);
      return { ...base, kind: element.kind, src: gift?.img || null };
    }
    case "emote":
      return {
        ...base,
        kind: element.kind,
        // No emote picked: the one its event sent
        src: element.emote ? element.emote.image : deps.sent(element) || null,
      };
    case "shape":
      return {
        ...base,
        kind: element.kind,
        color: element.fill ? element.color : null,
        radius: element.radius,
        border: element.border
          ? { color: element.border_color, width: element.border_width }
          : null,
      };
    case "viewer":
      return { ...base, kind: element.kind, ...deps.viewer(element) };
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
  const named = element.trigger.emotes;
  // A sample's emotes aren't the ones named: it shows its first
  const emote = emotes.find((e) => named.includes(e.emoteID)) ?? emotes[0];
  return emote?.images[0] ?? "";
}

/** A new, empty group with the name, shown and unlocked. */
export const newStudioGroup = (name: string): StudioGroup =>
  StudioGroupSchema.parse({ kind: "group", id: crypto.randomUUID(), name });
