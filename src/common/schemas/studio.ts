import { z } from "zod";
import { TOKIO_EVENTS } from "../types/connector";
import { TriggerSchema } from "./profile";
import { ColorSchema, FONT_MAX_LENGTH } from "./timer";

// Overlay Studio's canvases, in px: one browser source each
export const STUDIO_SIZES = {
  portrait: { width: 1080, height: 1920 },
  landscape: { width: 1920, height: 1080 },
} as const;

// What a layer draws
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

// How a layer that shows on an event comes in
const STUDIO_ENTRANCES = ["fade", "pop", "slide"] as const;

// What a layer that moves on an event plays, once per event
const STUDIO_ANIMATIONS = ["bounce", "shake", "pulse"] as const;

// A text layer's alignment in its box
const STUDIO_ALIGNS = ["left", "center", "right"] as const;

// The most layers an overlay holds; each autosave rewrites the whole store
export const STUDIO_MAX_LAYERS = 100;
// The longest text a text layer holds
export const STUDIO_TEXT_MAX_LENGTH = 500;
// The longest overlay name
export const STUDIO_NAME_MAX_LENGTH = 60;
// The most seconds a layer that shows on an event stays
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
const LAYER = {
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

// One layer of a studio overlay, by kind
export const StudioLayerSchema = z.discriminatedUnion("kind", [
  // Can hold the live numbers (STUDIO_NUMBERS) and, when it reacts, its
  // trigger's variables (ALERT_MESSAGE_VARIABLES)
  z.object({
    ...LAYER,
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
    ...LAYER,
    kind: z.literal("media"),
    file: LibraryFileSchema,
    name: z.string().default(""),
  }),
  // A gift's picture, by its id in TikTok's or the custom gift list
  z.object({
    ...LAYER,
    kind: z.literal("gift"),
    gift: z.number().nullable().default(null),
  }),
  // A saved emote's picture
  z.object({
    ...LAYER,
    kind: z.literal("emote"),
    emote: z
      .object({
        id: z.string(),
        // The only URL a layer saves, so only https
        image: z.url({ protocol: /^https$/ }),
      })
      .nullable()
      .default(null),
  }),
  z.object({
    ...LAYER,
    kind: z.literal("shape"),
    color: ColorSchema.default("#18181b"),
    // px of the canvas
    radius: z.number().min(0).default(24),
  }),
  // The picture of the viewer who set off its trigger, or their initial
  z.object({ ...LAYER, kind: z.literal("viewer") }),
  // An installed overlay, an alert's overlay, the countdown timer or the
  // games overlay, framed at its own path
  z.object({
    ...LAYER,
    kind: z.literal("overlay"),
    source: z
      .discriminatedUnion("type", [
        z.object({
          type: z.enum(["installed", "alert"]),
          id: z.string().min(1),
        }),
        z.object({ type: z.enum(["timer", "games"]) }),
      ])
      .nullable()
      .default(null),
  }),
]);

const StudioLayersSchema = z
  .array(StudioLayerSchema)
  .max(STUDIO_MAX_LAYERS)
  .refine((layers) => new Set(layers.map((l) => l.id)).size === layers.length);

// A studio overlay, served at getStudioOverlayURL(id). Layers go back to
// front: the first is the back. The strict schema, for IPC and the store's
// mutators.
export const StudioOverlaySchema = z.object({
  // Its URL path and socket id
  id: z.uuid(),
  // Empty while it's retyped
  name: z.string().max(STUDIO_NAME_MAX_LENGTH).default(""),
  size: z.enum(["portrait", "landscape"]).default("portrait"),
  layers: StudioLayersSchema.default([]),
});

// Keeps the items that parse, so one bad item can't fail the store
const parsing =
  (schema: z.ZodType) =>
  (items: unknown): unknown =>
    Array.isArray(items)
      ? items.filter((item) => schema.safeParse(item).success)
      : items;

// The store's: drops a layer that doesn't parse (a newer Tokio's kind after a
// downgrade, a hand edit) instead of the overlay
const StoredStudioOverlaySchema = StudioOverlaySchema.extend({
  layers: z
    .preprocess(parsing(StudioLayerSchema), StudioLayersSchema)
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
export type StudioLayerKind = StudioLayer["kind"];
// The layer of one kind
export type StudioLayerOf<K extends StudioLayerKind> = Extract<
  StudioLayer,
  { kind: K }
>;
export type StudioSize = StudioOverlay["size"];
export type StudioWhen = StudioLayer["when"];
export type StudioEntrance = StudioLayer["entrance"];
export type StudioAnimation = StudioLayer["animation"];
export type StudioAlign = StudioLayerOf<"text">["align"];
// What an overlay layer frames
export type StudioSource = NonNullable<StudioLayerOf<"overlay">["source"]>;
