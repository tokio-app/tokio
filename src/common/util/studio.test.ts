import { describe, expect, it, vi } from "vitest";
import {
  StudioLayer,
  StudioLayerSchema,
  StudioOverlay,
} from "../schemas/studio";
import { ChatEvent, TOKIO_EVENTS } from "../types/connector";
import {
  fillStudioText,
  newStudioLayer,
  SAMPLE_NUMBERS,
  studioVariables,
  studioView,
  StudioViewDeps,
  usesNumbers,
} from "./studio";

const ID = "8f14e45f-ceea-4672-9a8e-1b2c3d4e5f60";
const box = { x: 0, y: 0, width: 100, height: 100 };
const layer = (id: string, fields: object): StudioLayer =>
  StudioLayerSchema.parse({ id, ...box, ...fields });

const chat = (content: string): ChatEvent => ({
  user: { username: "Sora", handle: "sora", profilePictures: [] },
  comment: { content, emotes: [], lang: "en" },
});

const fill = (
  template: string,
  values: ChatEvent | null,
  language = "en",
  variables = ["username", "handle", "comment"],
) =>
  fillStudioText(template, {
    numbers: SAMPLE_NUMBERS,
    values,
    variables,
    language,
  });

describe("fillStudioText", () => {
  it("shows the live numbers compact, in the language", () => {
    expect(fill("{likes} likes, {viewers} watching", null)).toBe(
      "12.8K likes, 236 watching",
    );
    // Spanish spaces its unit with a no-break space
    expect(fill("{likes} me gusta", null, "es-419")).toMatch(
      /^12\.8\sk me gusta$/,
    );
  });

  it("fills the event's values, and a comment that says {likes} stays as typed", () => {
    expect(fill("{username}: {comment} ({likes})", chat("{likes}?"))).toBe(
      "Sora: {likes}? (12.8K)",
    );
  });

  it("reads the trigger's variables empty before the first event", () => {
    expect(fill("Last: {username}{gift}", null)).toBe("Last: {gift}");
  });

  it("leaves what isn't a number or a variable", () => {
    expect(fill("{constructor} {nope}", chat("hi"))).toBe(
      "{constructor} {nope}",
    );
  });
});

describe("usesNumbers and studioVariables", () => {
  it("spots a live number", () => {
    expect(usesNumbers("Goal: {coins}/5000")).toBe(true);
    expect(usesNumbers("Thanks {username}")).toBe(false);
  });

  it("adds the trigger's variables only to a layer that reacts", () => {
    const text = layer("t", { kind: "text" });

    expect(studioVariables(text)).toEqual([
      "likes",
      "viewers",
      "followers",
      "shares",
      "coins",
    ]);
    expect(
      studioVariables({
        ...text,
        when: "event",
        trigger: { ...text.trigger, type: TOKIO_EVENTS.GIFT },
      }),
    ).toEqual(expect.arrayContaining(["coins", "username", "gift", "count"]));
  });
});

describe("studioView", () => {
  const deps = (changes: Partial<StudioViewDeps> = {}): StudioViewDeps => ({
    gifts: [
      { value: 5655, label: "Rose", img: "https://gifts/rose.png", coins: 1 },
      { value: 5655, label: "Rose", img: "https://custom/rose.png", coins: 1 },
    ],
    served: (id) => id === "gift-jar",
    mediaURL: (file, id) => `/alerts/media/${file}?${id}`,
    embedPath: (source) => `/${source.type}/`,
    text: (l) => l.text.toUpperCase(),
    viewer: () => ({ src: "", name: "Sora" }),
    label: (source) => source.type,
    ...changes,
  });

  const overlay = (layers: StudioLayer[]): StudioOverlay => ({
    id: ID,
    name: "",
    size: "landscape",
    layers,
  });

  it("resolves each kind, back to front", () => {
    const { width, height, layers } = studioView(
      overlay([
        layer("shape", { kind: "shape" }),
        layer("text", { kind: "text", text: "hi" }),
        layer("clip", { kind: "media", file: "a.MP4" }),
        layer("still", { kind: "media", file: "b.png" }),
        layer("rose", { kind: "gift", gift: 5655 }),
        layer("unknown", { kind: "gift", gift: 1 }),
        layer("emote", {
          kind: "emote",
          emote: { id: "1", image: "https://e/1.webp" },
        }),
        layer("viewer", { kind: "viewer", when: "event" }),
      ]),
      deps(),
    );

    expect({ width, height }).toEqual({ width: 1920, height: 1080 });
    expect(layers.map((l) => [l.id, l.z])).toEqual([
      ["shape", 0],
      ["text", 1],
      ["clip", 2],
      ["still", 3],
      ["rose", 4],
      ["unknown", 5],
      ["emote", 6],
      ["viewer", 7],
    ]);
    expect(layers[0]).toMatchObject({ color: "#18181b", radius: 24 });
    expect(layers[1]).toMatchObject({ text: "HI", size: 64, halo: true });
    expect(layers[2]).toMatchObject({
      src: "/alerts/media/a.MP4?clip",
      video: true,
    });
    expect(layers[3]).toMatchObject({ video: false });
    expect(layers[4]).toMatchObject({ src: "https://gifts/rose.png" });
    expect(layers[5]).toMatchObject({ src: null });
    expect(layers[6]).toMatchObject({ src: "https://e/1.webp" });
    expect(layers[7]).toMatchObject({ src: "", name: "Sora", when: "event" });
  });

  it("keeps an embed that can't load in its place, with no src", () => {
    const embedPath = vi.fn((source) => `/${source.id ?? source.type}/`);
    const { layers } = studioView(
      overlay([
        layer("jar", {
          kind: "overlay",
          source: { type: "installed", id: "gift-jar" },
        }),
        layer("gone", {
          kind: "overlay",
          source: { type: "installed", id: "removed" },
        }),
        layer("timer", { kind: "overlay", source: { type: "timer" } }),
        layer("none", { kind: "overlay" }),
        layer("empty", { kind: "media" }),
      ]),
      deps({ embedPath }),
    );

    expect(layers.map((l) => ("src" in l ? l.src : undefined))).toEqual([
      "/gift-jar/",
      null,
      "/timer/",
      null,
      null,
    ]);
    expect(layers[1]).toMatchObject({ label: "installed", z: 1 });
    expect(layers[3]).toMatchObject({ source: null, label: "" });
    expect(embedPath).toHaveBeenCalledTimes(2);
  });
});

describe("newStudioLayer", () => {
  it("centers a new layer on the canvas, with its own id", () => {
    const a = newStudioLayer("text", "portrait");
    const b = newStudioLayer("text", "portrait");

    expect(a).toMatchObject({ x: 180, y: 880, width: 720, height: 160 });
    expect(a.id).not.toBe(b.id);
    expect(StudioLayerSchema.parse(a)).toEqual(a);
  });

  it("makes a viewer's picture wait for an event", () => {
    expect(newStudioLayer("viewer", "landscape")).toMatchObject({
      when: "event",
      trigger: { type: TOKIO_EVENTS.FOLLOW },
    });
    expect(newStudioLayer("gift", "landscape").when).toBe("always");
  });
});
