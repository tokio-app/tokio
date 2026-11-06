import { describe, expect, it } from "vitest";
import { TOKIO_EVENTS } from "../types/connector";
import { defaultStoreData } from "../util/constants/store";
import { StoreZodSchema } from "./store";
import {
  STUDIO_MAX_LAYERS,
  StoredStudioOverlaysSchema,
  StudioLayerSchema,
  StudioOverlaySchema,
} from "./studio";

const ID = "8f14e45f-ceea-4672-9a8e-1b2c3d4e5f60";
const box = { x: 10, y: 20, width: 300, height: 100 };
const layer = (fields: object) => ({ id: "a", ...box, ...fields });

describe("StudioLayerSchema", () => {
  it("fills a text layer with Tokio's look and a Follow trigger", () => {
    expect(StudioLayerSchema.parse(layer({ kind: "text" }))).toEqual({
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
    expect(StudioLayerSchema.parse(layer({ kind: "shape" }))).toMatchObject({
      color: "#18181b",
      radius: 24,
    });
    expect(StudioLayerSchema.parse(layer({ kind: "media" }))).toMatchObject({
      file: "",
      name: "",
    });
    expect(StudioLayerSchema.parse(layer({ kind: "gift" }))).toMatchObject({
      gift: null,
    });
    expect(StudioLayerSchema.parse(layer({ kind: "emote" }))).toMatchObject({
      emote: null,
    });
    expect(StudioLayerSchema.parse(layer({ kind: "overlay" }))).toMatchObject({
      source: null,
    });
  });

  it("keeps an emote's picture to https", () => {
    const emote = (image: string) =>
      StudioLayerSchema.safeParse(
        layer({ kind: "emote", emote: { id: "1", image } }),
      ).success;

    expect(emote("https://p16.tiktokcdn.com/emote.webp")).toBe(true);
    expect(emote("http://p16.tiktokcdn.com/emote.webp")).toBe(false);
    expect(emote("javascript:alert(1)")).toBe(false);
  });

  it("takes only a media library file's bare name", () => {
    const media = (file: string) =>
      StudioLayerSchema.safeParse(layer({ kind: "media", file })).success;

    expect(media("3f2a.png")).toBe(true);
    expect(media("../tokio.json")).toBe(false);
    expect(media("sub/clip.mp4")).toBe(false);
    expect(media("C:\\clip.mp4")).toBe(false);
  });

  it("refuses an embed of a kind it doesn't know, or one without its id", () => {
    const embed = (source: unknown) =>
      StudioLayerSchema.safeParse(layer({ kind: "overlay", source })).success;

    expect(embed({ type: "installed", id: "gift-jar" })).toBe(true);
    expect(embed({ type: "timer" })).toBe(true);
    expect(embed({ type: "alert" })).toBe(false);
    expect(embed({ type: "page", id: "x" })).toBe(false);
  });

  it("keeps the caps", () => {
    const text = (fields: object) =>
      StudioLayerSchema.safeParse(layer({ kind: "text", ...fields })).success;

    expect(text({ text: "a".repeat(500) })).toBe(true);
    expect(text({ text: "a".repeat(501) })).toBe(false);
    expect(text({ width: 0 })).toBe(false);
    expect(text({ seconds: 61 })).toBe(false);
    expect(text({ opacity: 1.5 })).toBe(false);
  });

  it("sends back what it got, untrimmed and unrounded", () => {
    const saved = StudioLayerSchema.parse(
      layer({ kind: "text", text: " Thanks {username} ", x: 10.5 }),
    );

    expect(StudioLayerSchema.parse(saved)).toEqual(saved);
    expect(saved).toMatchObject({ text: " Thanks {username} ", x: 10.5 });
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

  it("refuses an id that isn't a UUID, a long name, or two layers with one id", () => {
    const text = layer({ kind: "text" });

    expect(StudioOverlaySchema.safeParse({ id: "../x" }).success).toBe(false);
    expect(
      StudioOverlaySchema.safeParse({ id: ID, name: "a".repeat(61) }).success,
    ).toBe(false);
    expect(
      StudioOverlaySchema.safeParse({ id: ID, layers: [text, text] }).success,
    ).toBe(false);
  });

  it(`holds at most ${STUDIO_MAX_LAYERS} layers`, () => {
    const layers = (count: number) =>
      Array.from({ length: count }, (_, i) =>
        layer({ id: String(i), kind: "shape" }),
      );

    expect(
      StudioOverlaySchema.safeParse({ id: ID, layers: layers(100) }).success,
    ).toBe(true);
    expect(
      StudioOverlaySchema.safeParse({ id: ID, layers: layers(101) }).success,
    ).toBe(false);
  });
});

describe("StoredStudioOverlaysSchema", () => {
  it("drops the layers and overlays that don't parse, keeping the rest", () => {
    const stored = StoredStudioOverlaysSchema.parse([
      {
        id: ID,
        layers: [
          layer({ kind: "shape" }),
          layer({ id: "b", kind: "hologram" }),
          layer({ id: "c", kind: "text", text: 4 }),
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
        layers: [expect.objectContaining({ id: "a", kind: "shape" })],
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
