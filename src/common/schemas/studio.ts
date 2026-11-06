import { z } from "zod";
import { TOKIO_EVENTS } from "../types/connector";
import { GAMES_OVERLAY_MAX_COLUMNS, TriggerSchema } from "./profile";
import { ColorSchema, FONT_MAX_LENGTH } from "./timer";

// Overlay Studio's canvases, in px: one browser source each
export const STUDIO_SIZES = {
  portrait: { width: 1080, height: 1920 },
  landscape: { width: 1920, height: 1080 },
} as const;

// What an element draws
export const STUDIO_KINDS = [
  "text",
  "media",
  "gift",
  "emote",
  "shape",
  "viewer",
  "overlay",
] as const;

// Always on screen, shows on its trigger for `seconds`, or always on screen
// and plays its animation on its trigger
const STUDIO_WHEN = ["always", "event", "animate"] as const;

// How an element that shows on an event comes in
const STUDIO_ENTRANCES = ["fade", "pop", "slide"] as const;

// What an element that moves on an event plays, once per event
const STUDIO_ANIMATIONS = ["bounce", "shake", "pulse"] as const;

// A text's alignment in its box
const STUDIO_ALIGNS = ["left", "center", "right"] as const;

// The most layers an overlay holds
export const STUDIO_MAX_LAYERS = 100;
// The most elements an overlay holds, in all its layers: each autosave
// rewrites the whole store
export const STUDIO_MAX_ELEMENTS = 100;
// The longest text a text element holds
export const STUDIO_TEXT_MAX_LENGTH = 500;
// The longest overlay or layer name
export const STUDIO_NAME_MAX_LENGTH = 60;
// The most seconds an element that shows on an event stays
export const STUDIO_MAX_SECONDS = 60;
// The largest text size, in px of the canvas
export const STUDIO_MAX_FONT_SIZE = 400;

// A media library file's basename, "" for none: never a path
const LibraryFileSchema = z
  .string()
  .refine((file) => !/[/\\]/.test(file) && !file.includes(".."))
  .default("");

// Every kind's box and reaction. Nothing here trims, clamps or rounds:
// useAutosave settles a save only when main's echo deep-equals what it sent.
const ELEMENT = {
  id: z.string().min(1),
  // The box, in px of the canvas, from its top left corner
  x: z.number(),
  y: z.number(),
  width: z.number().min(1),
  height: z.number().min(1),
  opacity: z.number().min(0).max(1).default(1),
  when: z.enum(STUDIO_WHEN).default("always"),
  // Its type and gifts have no defaults
  trigger: TriggerSchema.prefault({ type: TOKIO_EVENTS.FOLLOW, gifts: [] }),
  // On Like, it reacts each time the likes of all viewers pass another
  // likes_every, as game actions and the timer count them
  likes_every: z.number().int().min(1).default(100),
  seconds: z.number().min(1).max(STUDIO_MAX_SECONDS).default(5),
  entrance: z.enum(STUDIO_ENTRANCES).default("pop"),
  animation: z.enum(STUDIO_ANIMATIONS).default("bounce"),
};

// One element of a layer, by kind
export const StudioElementSchema = z.discriminatedUnion("kind", [
  // Can hold the live numbers (STUDIO_NUMBERS) and, when it reacts, its
  // trigger's variables (ALERT_MESSAGE_VARIABLES)
  z.object({
    ...ELEMENT,
    kind: z.literal("text"),
    text: z.string().max(STUDIO_TEXT_MAX_LENGTH).default(""),
    // A font installed where the streaming app runs, Archivo when empty
    font: z.string().max(FONT_MAX_LENGTH).default(""),
    // px of the canvas
    size: z.number().min(1).max(STUDIO_MAX_FONT_SIZE).default(64),
    color: ColorSchema.default("#f1f5f9"),
    align: z.enum(STUDIO_ALIGNS).default("center"),
    bold: z.boolean().default(true),
    // A soft dark shadow that keeps it legible over bright video
    halo: z.boolean().default(true),
  }),
  // An image or video from the media library; a video loops muted
  z.object({
    ...ELEMENT,
    kind: z.literal("media"),
    file: LibraryFileSchema,
    name: z.string().default(""),
  }),
  // A gift's picture, by its id in TikTok's or the custom gift list
  z.object({
    ...ELEMENT,
    kind: z.literal("gift"),
    gift: z.number().nullable().default(null),
  }),
  // A saved emote's picture
  z.object({
    ...ELEMENT,
    kind: z.literal("emote"),
    emote: z
      .object({
        id: z.string(),
        // The only URL an element saves, so only https
        image: z.url({ protocol: /^https$/ }),
      })
      .nullable()
      .default(null),
  }),
  z.object({
    ...ELEMENT,
    kind: z.literal("shape"),
    color: ColorSchema.default("#18181b"),
    // px of the canvas
    radius: z.number().min(0).default(24),
  }),
  // The picture of the viewer who set off its trigger, or their initial
  z.object({ ...ELEMENT, kind: z.literal("viewer") }),
  // An installed overlay, an alert's overlay, the countdown timer or the
  // games overlay, framed at its own path
  z.object({
    ...ELEMENT,
    kind: z.literal("overlay"),
    source: z
      // One member per type, so a chain of ifs on type narrows to the last
      .discriminatedUnion("type", [
        z.object({ type: z.literal("installed"), id: z.string().min(1) }),
        z.object({ type: z.literal("alert"), id: z.string().min(1) }),
        z.object({ type: z.literal("timer") }),
        z.object({
          type: z.literal("games"),
          // One column of the games overlay (a row when it's horizontal),
          // null for all of them
          column: z
            .number()
            .int()
            .min(1)
            .max(GAMES_OVERLAY_MAX_COLUMNS)
            .nullable()
            .default(null),
        }),
      ])
      .nullable()
      .default(null),
  }),
]);

// What a layer holds besides its elements, which go back to front: the
// first is the back
const LAYER = {
  id: z.string().min(1),
  // Empty while it's retyped
  name: z.string().max(STUDIO_NAME_MAX_LENGTH).default(""),
  // The editor's canvas can't pick, move or resize its elements
  locked: z.boolean().default(false),
  // Off the canvas and the stream
  hidden: z.boolean().default(false),
  // Its elements folded away in the editor's list
  folded: z.boolean().default(false),
};

// A layer of a studio overlay: elements that stack, hide and lock together
export const StudioLayerSchema = z.object({
  ...LAYER,
  elements: z.array(StudioElementSchema).default([]),
});

// The caps, and every id in the overlay unique, its layers' and their
// elements' both: the stage and the reactions find them by id
const fits = (layers: z.infer<typeof StudioLayerSchema>[]) => {
  const ids = layers.flatMap((l) => [l.id, ...l.elements.map((e) => e.id)]);
  return (
    ids.length - layers.length <= STUDIO_MAX_ELEMENTS &&
    new Set(ids).size === ids.length
  );
};

// A studio overlay, served at getStudioOverlayURL(id). Layers go back to
// front: the first is the back. The strict schema, for IPC and the store's
// mutators.
export const StudioOverlaySchema = z.object({
  // Its URL path and socket id
  id: z.uuid(),
  // Empty while it's retyped
  name: z.string().max(STUDIO_NAME_MAX_LENGTH).default(""),
  size: z.enum(["portrait", "landscape"]).default("portrait"),
  layers: z
    .array(StudioLayerSchema)
    .max(STUDIO_MAX_LAYERS)
    .refine(fits)
    .default([]),
});

// Keeps the items that parse, so one bad item can't fail the store
const parsing =
  (schema: z.ZodType) =>
  (items: unknown): unknown =>
    Array.isArray(items)
      ? items.filter((item) => schema.safeParse(item).success)
      : items;

// The store's layer: drops an element that doesn't parse (a newer Tokio's
// kind after a downgrade, a hand edit) instead of the layer
const StoredStudioLayerSchema = z.object({
  ...LAYER,
  elements: z
    .preprocess(parsing(StudioElementSchema), z.array(StudioElementSchema))
    .default([]),
});

// Drops a layer that still doesn't parse instead of the overlay
const StoredStudioOverlaySchema = StudioOverlaySchema.extend({
  layers: z
    .preprocess(
      parsing(StoredStudioLayerSchema),
      z.array(StoredStudioLayerSchema).max(STUDIO_MAX_LAYERS).refine(fits),
    )
    .default([]),
});

// settings.studio: drops an overlay that still doesn't parse instead of
// failing the store, which would reset every setting
export const StoredStudioOverlaysSchema = z.preprocess(
  parsing(StoredStudioOverlaySchema),
  z.array(StoredStudioOverlaySchema),
);

export type StudioOverlay = z.infer<typeof StudioOverlaySchema>;
export type StudioLayer = z.infer<typeof StudioLayerSchema>;
export type StudioElement = z.infer<typeof StudioElementSchema>;
export type StudioElementKind = StudioElement["kind"];
// The element of one kind
export type StudioElementOf<K extends StudioElementKind> = Extract<
  StudioElement,
  { kind: K }
>;
export type StudioSize = StudioOverlay["size"];
export type StudioWhen = StudioElement["when"];
export type StudioEntrance = StudioElement["entrance"];
export type StudioAnimation = StudioElement["animation"];
export type StudioAlign = StudioElementOf<"text">["align"];
// What an overlay element frames
export type StudioSource = NonNullable<StudioElementOf<"overlay">["source"]>;
