import { describe, expect, it } from "vitest";
import { TOKIO_EVENTS } from "../types/connector";
import { defaultStoreData } from "../util/constants/store";
import { StoreZodSchema } from "./store";
import {
  STUDIO_MAX_ELEMENTS,
  STUDIO_MAX_LAYERS,
  StoredStudioOverlaysSchema,
  StudioElementSchema,
  StudioLayerSchema,
  StudioOverlaySchema,
} from "./studio";

const ID = "8f14e45f-ceea-4672-9a8e-1b2c3d4e5f60";
const box = { x: 10, y: 20, width: 300, height: 100 };
const element = (fields: object) => ({ id: "a", ...box, ...fields });

describe("StudioElementSchema", () => {
  it("fills a text with Tokio's look and a Follow trigger", () => {
    expect(StudioElementSchema.parse(element({ kind: "text" }))).toEqual({
      id: "a",
      kind: "text",
      ...box,
      opacity: 1,
      when: "always",
      trigger: expect.objectContaining({
        type: TOKIO_EVENTS.FOLLOW,
        gifts: [],
      }),
      likes_every: 100,
      seconds: 5,
      entrance: "pop",
      animation: "bounce",
      text: "",
      font: "",
      size: 64,
      color: "#f1f5f9",
      align: "center",
      bold: true,
      halo: true,
    });
  });

  it("gives shapes Panel and the other kinds nothing to show", () => {
    expect(StudioElementSchema.parse(element({ kind: "shape" }))).toMatchObject(
      {
        color: "#18181b",
        radius: 24,
      },
    );
    expect(StudioElementSchema.parse(element({ kind: "media" }))).toMatchObject(
      {
        file: "",
        name: "",
      },
    );
    expect(StudioElementSchema.parse(element({ kind: "gift" }))).toMatchObject({
      gift: null,
    });
    expect(StudioElementSchema.parse(element({ kind: "emote" }))).toMatchObject(
      {
        emote: null,
      },
    );
    expect(
      StudioElementSchema.parse(element({ kind: "overlay" })),
    ).toMatchObject({
      source: null,
    });
  });

  it("keeps an emote's picture to https", () => {
    const emote = (image: string) =>
      StudioElementSchema.safeParse(
        element({ kind: "emote", emote: { id: "1", image } }),
      ).success;

    expect(emote("https://p16.tiktokcdn.com/emote.webp")).toBe(true);
    expect(emote("http://p16.tiktokcdn.com/emote.webp")).toBe(false);
    expect(emote("javascript:alert(1)")).toBe(false);
  });

  it("takes only a media library file's bare name", () => {
    const media = (file: string) =>
      StudioElementSchema.safeParse(element({ kind: "media", file })).success;

    expect(media("3f2a.png")).toBe(true);
    expect(media("../tokio.json")).toBe(false);
    expect(media("sub/clip.mp4")).toBe(false);
    expect(media("C:\\clip.mp4")).toBe(false);
  });

  it("refuses an embed of a kind it doesn't know, or one without its id", () => {
    const embed = (source: unknown) =>
      StudioElementSchema.safeParse(element({ kind: "overlay", source }))
        .success;

    expect(embed({ type: "installed", id: "gift-jar" })).toBe(true);
    expect(embed({ type: "timer" })).toBe(true);
    expect(embed({ type: "alert" })).toBe(false);
    expect(embed({ type: "page", id: "x" })).toBe(false);
  });

  it("takes one of the games overlay's columns, or all of them", () => {
    const embed = (source: unknown) =>
      StudioElementSchema.safeParse(element({ kind: "overlay", source }));

    // Without a column, it frames them all
    expect(embed({ type: "games" }).data).toMatchObject({
      source: { type: "games", column: null },
    });
    expect(embed({ type: "games", column: 4 }).success).toBe(true);
    expect(embed({ type: "games", column: 5 }).success).toBe(false);
    expect(embed({ type: "games", column: 1.5 }).success).toBe(false);
  });

  it("keeps the caps", () => {
    const text = (fields: object) =>
      StudioElementSchema.safeParse(element({ kind: "text", ...fields }))
        .success;

    expect(text({ text: "a".repeat(500) })).toBe(true);
    expect(text({ text: "a".repeat(501) })).toBe(false);
    expect(text({ width: 0 })).toBe(false);
    expect(text({ seconds: 61 })).toBe(false);
    expect(text({ opacity: 1.5 })).toBe(false);
  });

  it("sends back what it got, untrimmed and unrounded", () => {
    const saved = StudioElementSchema.parse(
      element({ kind: "text", text: " Thanks {username} ", x: 10.5 }),
    );

    expect(StudioElementSchema.parse(saved)).toEqual(saved);
    expect(saved).toMatchObject({ text: " Thanks {username} ", x: 10.5 });
  });
});

describe("StudioLayerSchema", () => {
  it("makes a shown, unlocked, unfolded layer without elements", () => {
    expect(StudioLayerSchema.parse({ id: "l" })).toEqual({
      id: "l",
      name: "",
      locked: false,
      hidden: false,
      folded: false,
      elements: [],
    });
  });

  it("refuses a long name or an element it can't parse", () => {
    expect(
      StudioLayerSchema.safeParse({ id: "l", name: "a".repeat(61) }).success,
    ).toBe(false);
    expect(
      StudioLayerSchema.safeParse({
        id: "l",
        elements: [element({ kind: "hologram" })],
      }).success,
    ).toBe(false);
  });
});

describe("StudioOverlaySchema", () => {
  it("makes a portrait overlay without layers", () => {
    expect(StudioOverlaySchema.parse({ id: ID })).toEqual({
      id: ID,
      name: "",
      size: "portrait",
      layers: [],
    });
  });

  it("refuses an id that isn't a UUID, a long name, or one id used twice", () => {
    const parses = (layers: object[]) =>
      StudioOverlaySchema.safeParse({ id: ID, layers }).success;
    const shape = element({ kind: "shape" });

    expect(StudioOverlaySchema.safeParse({ id: "../x" }).success).toBe(false);
    expect(
      StudioOverlaySchema.safeParse({ id: ID, name: "a".repeat(61) }).success,
    ).toBe(false);
    expect(parses([{ id: "l", elements: [shape] }])).toBe(true);
    // Two elements, in one layer or two
    expect(parses([{ id: "l", elements: [shape, shape] }])).toBe(false);
    expect(
      parses([
        { id: "l", elements: [shape] },
        { id: "m", elements: [shape] },
      ]),
    ).toBe(false);
    // Two layers, or a layer and an element
    expect(parses([{ id: "l" }, { id: "l" }])).toBe(false);
    expect(parses([{ id: "a", elements: [shape] }])).toBe(false);
  });

  it(`holds at most ${STUDIO_MAX_LAYERS} layers and ${STUDIO_MAX_ELEMENTS} elements in all`, () => {
    const layers = (count: number) =>
      Array.from({ length: count }, (_, i) => ({ id: `l${i}` }));
    // Spread over two layers
    const elements = (count: number) =>
      [0, 1].map((half) => ({
        id: `l${half}`,
        elements: Array.from({ length: count / 2 }, (_, i) =>
          element({ id: `e${half}-${i}`, kind: "shape" }),
        ),
      }));
    const parses = (all: object[]) =>
      StudioOverlaySchema.safeParse({ id: ID, layers: all }).success;

    expect(parses(layers(100))).toBe(true);
    expect(parses(layers(101))).toBe(false);
    expect(parses(elements(100))).toBe(true);
    expect(parses(elements(102))).toBe(false);
  });
});

describe("StoredStudioOverlaysSchema", () => {
  it("drops the elements, layers and overlays that don't parse, keeping the rest", () => {
    const stored = StoredStudioOverlaysSchema.parse([
      {
        id: ID,
        layers: [
          {
            id: "l",
            elements: [
              element({ kind: "shape" }),
              element({ id: "b", kind: "hologram" }),
              element({ id: "c", kind: "text", text: 4 }),
            ],
          },
          { id: "m", name: 4 },
        ],
      },
      { id: "not-a-uuid" },
      "junk",
    ]);

    expect(stored).toEqual([
      {
        id: ID,
        name: "",
        size: "portrait",
        layers: [
          expect.objectContaining({
            id: "l",
            elements: [expect.objectContaining({ id: "a", kind: "shape" })],
          }),
        ],
      },
    ]);
  });

  it("loads a store saved before Overlay Studio, with no overlays", () => {
    const saved = structuredClone(defaultStoreData);
    delete (saved.settings as Partial<typeof saved.settings>).studio;

    expect(StoreZodSchema.parse(saved).settings.studio).toEqual([]);
  });

  it("loads a store whose overlays are broken without failing it", () => {
    const saved = structuredClone(defaultStoreData) as {
      settings: Record<string, unknown>;
    };
    saved.settings.studio = [{ id: ID, layers: "lots" }];

    expect(StoreZodSchema.parse(saved).settings.studio).toEqual([]);
  });
});
