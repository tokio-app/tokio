import { describe, expect, it, vi } from "vitest";
import {
  StudioElement,
  StudioElementSchema,
  StudioGroupSchema,
  StudioOverlay,
} from "../schemas/studio";
import { ChatEvent, EMOTE_TRIGGER, TOKIO_EVENTS } from "../types/connector";
import {
  fillStudioText,
  newStudioElement,
  newStudioGroup,
  sentPicture,
  SAMPLE_NUMBERS,
  studioEventVariables,
  studioView,
  StudioViewDeps,
  usesNumbers,
} from "./studio";
import { generateTikTokEventSample } from "./samples";

const ID = "8f14e45f-ceea-4672-9a8e-1b2c3d4e5f60";
const box = { x: 0, y: 0, width: 100, height: 100 };
const element = (id: string, fields: object): StudioElement =>
  StudioElementSchema.parse({ id, ...box, ...fields });

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

describe("usesNumbers and studioEventVariables", () => {
  it("spots a live number", () => {
    expect(usesNumbers("Goal: {coins}/5000")).toBe(true);
    expect(usesNumbers("Thanks {username}")).toBe(false);
  });

  it("gives an element its trigger's variables only while it reacts", () => {
    const text = element("t", { kind: "text" });

    expect(studioEventVariables(text)).toEqual([]);
    expect(
      studioEventVariables({
        ...text,
        when: "event",
        trigger: { ...text.trigger, type: TOKIO_EVENTS.GIFT },
      }),
    ).toEqual(["username", "handle", "gift", "count"]);
  });

  it("gives a Like no viewer or count, its likes coming from every viewer", () => {
    const text = element("t", { kind: "text" });

    expect(
      studioEventVariables({
        ...text,
        when: "event",
        trigger: { ...text.trigger, type: TOKIO_EVENTS.LIKE },
      }),
    ).toEqual([]);
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
    camera: (e) => `/camera/${e.camera?.label ?? "default"}/${e.quality}`,
    text: (l) => l.text.toUpperCase(),
    viewer: () => ({ src: "", name: "Sora" }),
    sent: () => "",
    label: (source) => source.type,
    ...changes,
  });

  // One group holding the elements
  const overlay = (elements: StudioElement[]): StudioOverlay => ({
    id: ID,
    name: "",
    size: "landscape",
    rulers: false,
    guides: { x: [], y: [], locked: false },
    items: [StudioGroupSchema.parse({ kind: "group", id: "l", elements })],
  });

  it("resolves each kind, back to front", () => {
    const {
      width,
      height,
      layers: [{ elements: layers }],
    } = studioView(
      overlay([
        element("shape", { kind: "shape" }),
        element("text", { kind: "text", text: "hi" }),
        element("clip", {
          kind: "media",
          file: "a.MP4",
          start: 1,
          end: 3,
          loop: false,
          volume: 40,
        }),
        element("still", { kind: "media", file: "b.png" }),
        element("rose", { kind: "gift", gift: 5655 }),
        element("unknown", { kind: "gift", gift: 1 }),
        element("emote", {
          kind: "emote",
          emote: { id: "1", image: "https://e/1.webp" },
        }),
        element("viewer", { kind: "viewer", when: "event" }),
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
      start: 1,
      end: 3,
      loop: false,
      volume: 40,
    });
    expect(layers[3]).toMatchObject({ video: false });
    expect(layers[4]).toMatchObject({ src: "https://gifts/rose.png" });
    expect(layers[5]).toMatchObject({ src: null });
    expect(layers[6]).toMatchObject({ src: "https://e/1.webp" });
    expect(layers[7]).toMatchObject({ src: "", name: "Sora", when: "event" });
  });

  it("keeps an embed that can't load in its place, with no src", () => {
    const embedPath = vi.fn((source) => `/${source.id ?? source.type}/`);
    const {
      layers: [{ elements: layers }],
    } = studioView(
      overlay([
        element("jar", {
          kind: "overlay",
          source: { type: "installed", id: "gift-jar" },
        }),
        element("gone", {
          kind: "overlay",
          source: { type: "installed", id: "removed" },
        }),
        element("timer", { kind: "overlay", source: { type: "timer" } }),
        element("none", { kind: "overlay" }),
        element("empty", { kind: "media" }),
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

  it("leaves hidden elements out, the others keeping their place", () => {
    const {
      layers: [{ elements }],
    } = studioView(
      overlay([
        element("back", { kind: "shape" }),
        element("hidden", { kind: "shape", hidden: true }),
        element("front", { kind: "shape", rotation: -45, flip_x: true }),
      ]),
      deps(),
    );

    expect(elements).toMatchObject([
      { id: "back", z: 0, rotation: 0, flip_x: false, flip_y: false },
      { id: "front", z: 2, rotation: -45, flip_x: true, flip_y: false },
    ]);
  });

  it("shows the gift its event sent on a gift element with none picked", () => {
    const {
      layers: [{ elements }],
    } = studioView(
      overlay([
        element("picked", { kind: "gift", gift: 5655 }),
        element("sent", { kind: "gift" }),
      ]),
      deps({ sent: (e) => `https://g/${e.id}.png` }),
    );

    expect(elements[0]).not.toMatchObject({ src: "https://g/picked.png" });
    expect(elements[1]).toMatchObject({ src: "https://g/sent.png" });
  });

  it("shows the emote its event sent, and a shape's fill and border or none", () => {
    const {
      layers: [{ elements }],
    } = studioView(
      overlay([
        element("sent", { kind: "emote" }),
        element("plain", { kind: "shape", color: "#112233" }),
        element("outline", {
          kind: "shape",
          fill: false,
          border: true,
          border_color: "#445566",
          border_width: 8,
        }),
      ]),
      deps({ sent: () => "https://e/1.png" }),
    );

    expect(elements).toMatchObject([
      { src: "https://e/1.png" },
      { color: "#112233", border: null },
      { color: null, border: { color: "#445566", width: 8 } },
    ]);
  });

  it("leaves hidden groups out, the others keeping their place", () => {
    const group = (id: string, hidden = false) =>
      StudioGroupSchema.parse({
        kind: "group",
        id,
        hidden,
        elements: [element(`${id}-shape`, { kind: "shape" })],
      });
    const { layers } = studioView(
      {
        ...overlay([]),
        items: [group("back"), group("middle", true), group("front")],
      },
      deps(),
    );

    expect(layers.map((l) => [l.id, l.z])).toEqual([
      ["back", 0],
      ["front", 2],
    ]);
    expect(layers[1].elements).toMatchObject([{ id: "front-shape", z: 0 }]);
  });

  it("draws an element on its own as a layer of its own, between groups", () => {
    const { layers } = studioView(
      {
        ...overlay([]),
        items: [
          StudioGroupSchema.parse({
            kind: "group",
            id: "g",
            elements: [element("in", { kind: "shape" })],
          }),
          element("alone", { kind: "shape" }),
          element("hidden", { kind: "shape", hidden: true }),
        ],
      },
      deps(),
    );

    expect(layers).toMatchObject([
      { id: "g", z: 0, elements: [{ id: "in", z: 0 }] },
      { id: "alone", z: 1, elements: [{ id: "alone", z: 0 }] },
    ]);
    expect(layers).toHaveLength(2);
  });
});

describe("newStudioElement", () => {
  it("centers a new element on the canvas, with its own id", () => {
    const a = newStudioElement("text", "portrait");
    const b = newStudioElement("text", "portrait");

    expect(a).toMatchObject({ x: 180, y: 880, width: 720, height: 160 });
    expect(a.id).not.toBe(b.id);
    expect(StudioElementSchema.parse(a)).toEqual(a);
  });

  it("makes a viewer's picture and a gift wait for an event", () => {
    expect(newStudioElement("viewer", "landscape")).toMatchObject({
      when: "event",
      trigger: { type: TOKIO_EVENTS.FOLLOW },
    });
    // The gift a viewer sends
    expect(newStudioElement("gift", "landscape")).toMatchObject({
      gift: null,
      when: "event",
      trigger: { type: TOKIO_EVENTS.GIFT },
    });
    expect(newStudioElement("emote", "landscape")).toMatchObject({
      emote: null,
      when: "event",
      trigger: { type: EMOTE_TRIGGER },
    });
    expect(newStudioElement("shape", "landscape").when).toBe("always");
  });
});

describe("sentPicture", () => {
  const gift = element("g", { kind: "gift" });
  const emote = (emotes: string[] = []) =>
    element("e", {
      kind: "emote",
      trigger: { type: EMOTE_TRIGGER, gifts: [], emotes },
    });
  const chat = (...ids: string[]): ChatEvent => ({
    user: { username: "Ana", handle: "ana", profilePictures: [] },
    comment: {
      content: "",
      lang: "en",
      emotes: ids.map((id, index) => ({
        emoteID: id,
        index,
        images: [`https://e/${id}.png`],
      })),
    },
  });

  it("reads the picture of the gift an event sent", () => {
    const sent = generateTikTokEventSample(TOKIO_EVENTS.GIFT).data;

    expect(sentPicture(gift, sent)).toBe(sent.gift.image);
    expect(sentPicture(gift, chat("1"))).toBe("");
    expect(sentPicture(gift, null)).toBe("");
  });

  it("reads the emote its trigger names, else the message's first", () => {
    expect(sentPicture(emote(["2"]), chat("1", "2"))).toBe("https://e/2.png");
    expect(sentPicture(emote(), chat("1", "2"))).toBe("https://e/1.png");
    expect(sentPicture(emote(), chat())).toBe("");
  });
});

describe("newStudioGroup", () => {
  it("makes an empty group with the name and its own id", () => {
    const a = newStudioGroup("Group 1");

    expect(a).toMatchObject({
      kind: "group",
      name: "Group 1",
      locked: false,
      hidden: false,
      elements: [],
    });
    expect(a.id).not.toBe(newStudioGroup("Group 1").id);
  });
});
