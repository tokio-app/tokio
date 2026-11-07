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

// The most groups an overlay holds
export const STUDIO_MAX_GROUPS = 100;
// The most elements an overlay holds, in groups or on their own: each
// autosave rewrites the whole store
export const STUDIO_MAX_ELEMENTS = 100;
// The longest text a text element holds
export const STUDIO_TEXT_MAX_LENGTH = 500;
// The longest overlay, group or element name
export const STUDIO_NAME_MAX_LENGTH = 60;
// The most seconds an element that shows on an event stays
export const STUDIO_MAX_SECONDS = 60;
// The largest text size, in px of the canvas
export const STUDIO_MAX_FONT_SIZE = 400;
// The widest shape border, in px of the canvas
export const STUDIO_MAX_BORDER = 100;

// A media library file's basename, "" for none: never a path
const LibraryFileSchema = z
  .string()
  .refine((file) => !/[/\\]/.test(file) && !file.includes(".."))
  .default("");

// Every kind's box and reaction. Nothing here trims, clamps or rounds:
// useAutosave settles a save only when main's echo deep-equals what it sent.
const ELEMENT = {
  id: z.string().min(1),
  // Its name in the editor, empty for what it shows. Not `name`, which is a
  // media element's file name.
  label: z.string().max(STUDIO_NAME_MAX_LENGTH).default(""),
  // The box, in px of the canvas, from its top left corner
  x: z.number(),
  y: z.number(),
  width: z.number().min(1),
  height: z.number().min(1),
  // Degrees clockwise, around its center
  rotation: z.number().min(-180).max(180).default(0),
  // Mirrored left to right, and top to bottom, along its own sides
  flip_x: z.boolean().default(false),
  flip_y: z.boolean().default(false),
  opacity: z.number().min(0).max(1).default(1),
  // The editor's canvas can't pick, move, resize or rotate it
  locked: z.boolean().default(false),
  // Off the canvas and the stream
  hidden: z.boolean().default(false),
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

// One element, by kind
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
    // Painted inside, unless fill is off
    fill: z.boolean().default(true),
    color: ColorSchema.default("#18181b"),
    // A line inside its edge, px of the canvas
    border: z.boolean().default(false),
    border_color: ColorSchema.default("#f1f5f9"),
    border_width: z.number().min(1).max(STUDIO_MAX_BORDER).default(4),
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

// What a group holds besides its elements, which go back to front: the
// first is the back
const GROUP = {
  kind: z.literal("group"),
  id: z.string().min(1),
  // Empty while it's retyped
  name: z.string().max(STUDIO_NAME_MAX_LENGTH).default(""),
  // The editor's canvas can't pick, move, resize or rotate its elements
  locked: z.boolean().default(false),
  // Off the canvas and the stream
  hidden: z.boolean().default(false),
  // Its elements folded away in the editor's list
  folded: z.boolean().default(false),
};

// A group of elements that stack, hide, lock and move together. Groups
// don't hold groups.
export const StudioGroupSchema = z.object({
  ...GROUP,
  elements: z.array(StudioElementSchema).default([]),
});

// What an overlay stacks: a group, or an element on its own
const StudioItemSchema = z.discriminatedUnion("kind", [
  StudioGroupSchema,
  StudioElementSchema,
]);

type Item = z.infer<typeof StudioItemSchema>;

// The caps, and every id in the overlay unique, its groups' and every
// element's both: the stage and the reactions find them by id
const fits = (items: Item[]) => {
  const groups = items.filter((item) => item.kind === "group");
  const elements = items.flatMap((item) =>
    item.kind === "group" ? item.elements : [item],
  );
  const ids = [...groups, ...elements].map((item) => item.id);
  return (
    groups.length <= STUDIO_MAX_GROUPS &&
    elements.length <= STUDIO_MAX_ELEMENTS &&
    new Set(ids).size === ids.length
  );
};

// A studio overlay, served at getStudioOverlayURL(id). The strict schema,
// for IPC and the store's mutators.
export const StudioOverlaySchema = z.object({
  // Its URL path and socket id
  id: z.uuid(),
  // Empty while it's retyped
  name: z.string().max(STUDIO_NAME_MAX_LENGTH).default(""),
  size: z.enum(["portrait", "landscape"]).default("portrait"),
  // Its groups and the elements in none, back to front: the first is the
  // back
  items: z
    .array(StudioItemSchema)
    .max(STUDIO_MAX_GROUPS + STUDIO_MAX_ELEMENTS)
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

// The store's group: drops an element that doesn't parse (a newer Tokio's
// kind after a downgrade, a hand edit) instead of the group
const StoredStudioGroupSchema = z.object({
  ...GROUP,
  elements: z
    .preprocess(parsing(StudioElementSchema), z.array(StudioElementSchema))
    .default([]),
});

const StoredStudioItemSchema = z.discriminatedUnion("kind", [
  StoredStudioGroupSchema,
  StudioElementSchema,
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

// An overlay saved before groups held its elements in layers: each layer
// is a group now, with its id, name, flags and elements. Layers that aren't
// a list stay what they were, so the overlay is dropped as before.
const withItems = (overlay: unknown): unknown =>
  isRecord(overlay) && !("items" in overlay) && "layers" in overlay
    ? {
        ...overlay,
        items: Array.isArray(overlay.layers)
          ? overlay.layers.map((layer) =>
              isRecord(layer) ? { ...layer, kind: "group" } : layer,
            )
          : overlay.layers,
      }
    : overlay;

// Drops an item that still doesn't parse instead of the overlay
const StoredStudioOverlaySchema = z.preprocess(
  withItems,
  StudioOverlaySchema.extend({
    items: z
      .preprocess(
        parsing(StoredStudioItemSchema),
        z
          .array(StoredStudioItemSchema)
          .max(STUDIO_MAX_GROUPS + STUDIO_MAX_ELEMENTS)
          .refine(fits),
      )
      .default([]),
  }),
);

// settings.studio: drops an overlay that still doesn't parse instead of
// failing the store, which would reset every setting
export const StoredStudioOverlaysSchema = z.preprocess(
  parsing(StoredStudioOverlaySchema),
  z.array(StoredStudioOverlaySchema),
);

export type StudioOverlay = z.infer<typeof StudioOverlaySchema>;
export type StudioGroup = z.infer<typeof StudioGroupSchema>;
export type StudioItem = z.infer<typeof StudioItemSchema>;
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
