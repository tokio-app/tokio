import { describe, expect, it, vi } from "vitest";
import { TriggerSchema } from "../schemas/profile";
import {
  STUDIO_MAX_LIST_ROWS,
  StudioElement,
  StudioElementOf,
  StudioElementSchema,
  StudioGroupSchema,
  StudioListSource,
  StudioOverlay,
} from "../schemas/studio";
import {
  AlertTrigger,
  ChatEvent,
  EMOTE_TRIGGER,
  Platform,
  TOKIO_EVENTS,
} from "../types/connector";
import { NO_MONEY } from "./format";
import {
  fillStudioText,
  goalValue,
  listInUsd,
  listRow,
  newStudioElement,
  newStudioGroup,
  reactsToEvents,
  sampleDeps,
  sampleReact,
  Samples,
  sentPicture,
  SAMPLE_NUMBERS,
  studioEventVariables,
  studioNumbersFor,
  studioView,
  StudioViewDeps,
  usesNumbers,
} from "./studio";
import { formatStat } from "./format";
import { generateEventSample } from "./samples";

const ID = "8f14e45f-ceea-4672-9a8e-1b2c3d4e5f60";
const box = { x: 0, y: 0, width: 100, height: 100 };
const element = (id: string, fields: object): StudioElement =>
  StudioElementSchema.parse({ id, ...box, ...fields });

// An alert trigger of the type, as the schema fills one
const triggerOf = (type: AlertTrigger) =>
  TriggerSchema.parse({ type, gifts: [] });

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
    counters: {},
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

  it("shows the Super Chats in dollars, and a dash until the rates load", () => {
    expect(fill("{coins} {kicks} {bits} {superchats} {giftsubs}", null)).toBe(
      "4.2K 1.9K 2.5K $86.50 25",
    );
    const waiting = fillStudioText("{superchats}", {
      numbers: { ...SAMPLE_NUMBERS, superchats: null },
      counters: {},
      values: null,
      variables: [],
      language: "en",
    });
    expect(waiting).toBe(NO_MONEY);
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

describe("goalValue", () => {
  it("reads a LIVE number but uptime, then a counter, else 0", () => {
    const counters = { roses: 7, uptime: 3 };

    expect(goalValue("likes", SAMPLE_NUMBERS, counters)).toBe(12_840);
    expect(goalValue("roses", SAMPLE_NUMBERS, counters)).toBe(7);
    // Uptime only grows: a counter of that name, else nothing
    expect(goalValue("uptime", SAMPLE_NUMBERS, counters)).toBe(3);
    expect(goalValue("uptime", SAMPLE_NUMBERS, {})).toBe(0);
    // Own keys only
    expect(goalValue("constructor", SAMPLE_NUMBERS, {})).toBe(0);
    expect(goalValue("gone", SAMPLE_NUMBERS, counters)).toBe(0);
    // Super Chats before the rates load
    expect(
      goalValue("superchats", { ...SAMPLE_NUMBERS, superchats: null }, {}),
    ).toBe(0);
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
        trigger: triggerOf(TOKIO_EVENTS.GIFT),
      }),
    ).toEqual(["username", "handle", "gift", "count"]);
  });

  it("gives a text that moves all the time no event, since it has none", () => {
    const text = element("t", { kind: "text", when: "loop" });

    expect(reactsToEvents(text)).toBe(false);
    expect(studioEventVariables(text)).toEqual([]);
    expect(reactsToEvents({ when: "event" })).toBe(true);
    expect(reactsToEvents({ when: "animate" })).toBe(true);
    expect(reactsToEvents({ when: "always" })).toBe(false);
  });

  it("gives a Like no viewer or count, its likes coming from every viewer", () => {
    const text = element("t", { kind: "text" });

    expect(
      studioEventVariables({
        ...text,
        when: "event",
        trigger: triggerOf(TOKIO_EVENTS.LIKE),
      }),
    ).toEqual([]);
  });
});

describe("studioNumbersFor", () => {
  it.each([
    [
      ["tiktok"],
      ["likes", "viewers", "followers", "shares", "coins", "gifts", "uptime"],
    ],
    [["twitch"], ["viewers", "followers", "bits", "giftsubs", "uptime"]],
    [["youtube"], ["viewers", "superchats", "gifts", "giftsubs", "uptime"]],
    [["kick"], ["viewers", "kicks", "giftsubs", "uptime"]],
  ] as const)("offers on %j only what it fills", (platforms, numbers) => {
    expect(studioNumbersFor(platforms)).toEqual(numbers);
  });

  it("offers every number the platforms fill together, in their order", () => {
    expect(studioNumbersFor(["kick", "tiktok"])).toEqual([
      "likes",
      "viewers",
      "followers",
      "shares",
      "coins",
      "kicks",
      "gifts",
      "giftsubs",
      "uptime",
    ]);
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
    fill: () => 0.25,
    rows: () => [],
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
    counters: [],
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

  it("fills a goal bar as far as its deps say, from 0 to full", () => {
    const fills: Record<string, number> = { half: 0.5, past: 3, none: NaN };
    const {
      layers: [{ elements }],
    } = studioView(
      overlay([
        element("half", { kind: "bar", gradient: true }),
        element("past", { kind: "bar", vertical: true }),
        element("none", { kind: "bar" }),
      ]),
      deps({ fill: (e) => fills[e.id] }),
    );

    expect(elements).toMatchObject([
      {
        kind: "bar",
        fill: 0.5,
        color: "#f43f5e",
        gradient: { color: "#f1f5f9", angle: 90 },
        track: "#18181bd9",
        rounding: 50,
        vertical: false,
      },
      { fill: 1, gradient: null, vertical: true },
      { fill: 0 },
    ]);
  });

  it("keeps a list's rows, chat's newest at the bottom", () => {
    const row = (name: string) => ({
      picture: "",
      name,
      text: "",
      icon: "",
      value: "",
    });
    // Newest or biggest first, as deps give them
    const rows = () => ["a", "b", "c", "d"].map(row);
    const {
      layers: [{ elements }],
    } = studioView(
      overlay([
        element("top", { kind: "list", rows: 3 }),
        element("chat", { kind: "list", source: "chat", rows: 3 }),
      ]),
      deps({ rows }),
    );

    expect(elements[0]).toMatchObject({
      kind: "list",
      source: "gifters",
      font: "",
      size: 36,
      color: "#f1f5f9",
      value_color: "#f43f5e",
      pictures: true,
      gap: 16,
    });
    const names = (e: (typeof elements)[number]) =>
      e.kind === "list" ? e.rows.map((r) => r.name) : [];
    expect(names(elements[0])).toEqual(["a", "b", "c"]);
    expect(names(elements[1])).toEqual(["c", "b", "a"]);
  });

  it("streams a camera from where its deps say, cropped and rounded", () => {
    const camera = vi.fn((e: StudioElementOf<"camera">) =>
      e.camera ? `/camera/${e.camera.id}/${e.quality}` : null,
    );
    const crop = { left: 0.25, top: 0, right: 0.25, bottom: 0 };
    const {
      layers: [{ elements: layers }],
    } = studioView(
      overlay([
        element("desk", {
          kind: "camera",
          camera: { id: "cam-b", label: "Desk" },
          quality: "1080p",
          crop,
          rounding: 50,
        }),
        element("default", { kind: "camera" }),
      ]),
      deps({ camera }),
    );

    expect(layers[0]).toMatchObject({
      kind: "camera",
      src: "/camera/cam-b/1080p",
      crop,
      rounding: 50,
    });
    expect(layers[1]).toMatchObject({ src: null, crop: null, rounding: 0 });
    expect(camera).toHaveBeenCalledTimes(2);
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
            when: "event",
            entrance: "drop",
            exit: "blur",
            elements: [element("in", { kind: "shape" })],
          }),
          element("alone", { kind: "shape", when: "loop", idle: "sway" }),
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
    // The group moves as a whole; the element on its own moves itself
    expect(layers[0].group).toEqual({
      when: "event",
      seconds: 5,
      entrance: "drop",
      exit: "blur",
      animation: "bounce",
      idle: "float",
    });
    expect(layers[1].group).toBeNull();
    expect(layers[1].elements[0]).toMatchObject({
      when: "loop",
      exit: "fade",
      idle: "sway",
    });
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

  it("starts on the profile's platforms: their event, and a list their gifters", () => {
    expect(newStudioElement("text", "portrait")).toMatchObject({
      trigger: { type: TOKIO_EVENTS.FOLLOW },
    });
    expect(newStudioElement("text", "portrait", ["kick"])).toMatchObject({
      trigger: { type: TOKIO_EVENTS.SUBSCRIBE },
    });
    expect(
      newStudioElement("list", "portrait", ["twitch", "kick"]),
    ).toMatchObject({ platform: "twitch" });
    expect(newStudioElement("list", "portrait")).toMatchObject({
      platform: "tiktok",
    });
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
    const sent = generateEventSample(TOKIO_EVENTS.GIFT).data;

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

// A new element of the kind, as the editor adds it
const made = <K extends StudioElement["kind"]>(
  kind: K,
  patch: Partial<Extract<StudioElement, { kind: K }>> = {},
) =>
  StudioElementSchema.parse({
    ...newStudioElement(kind, "portrait"),
    ...patch,
  });

describe("Samples", () => {
  it("makes each trigger's sample once, an emote's from chat", () => {
    const samples = new Samples();
    const follow = { type: TOKIO_EVENTS.FOLLOW } as const;

    expect(samples.of(follow)).toBe(samples.of(follow));
    expect(samples.of({ type: EMOTE_TRIGGER })).toMatchObject({
      comment: { emotes: expect.arrayContaining([expect.anything()]) },
    });
  });

  it("samples each row on its platform, else the profile's first sending it", () => {
    const samples = new Samples(["kick", "youtube", "twitch"]);
    const platformOf = (row: { type: AlertTrigger; platform?: Platform }) => {
      const sample = samples.of(row);
      return sample && typeof sample === "object" && "user" in sample
        ? sample.user.platform
        : undefined;
    };

    expect(platformOf({ type: TOKIO_EVENTS.CHAT })).toBe("kick");
    expect(platformOf({ type: TOKIO_EVENTS.GIFT })).toBe("youtube");
    expect(platformOf({ type: TOKIO_EVENTS.FOLLOW })).toBe("twitch");
    expect(platformOf({ type: TOKIO_EVENTS.CHAT, platform: "twitch" })).toBe(
      "twitch",
    );
    // Its own and the first row's are kept apart
    expect(
      samples.of({ type: TOKIO_EVENTS.CHAT, platform: "twitch" }),
    ).not.toBe(samples.of({ type: TOKIO_EVENTS.CHAT }));
  });

  it("plays a text with its trigger's values and a viewer with its picture", () => {
    const samples = new Samples();
    const text = made("text", { text: "Hi {username}", when: "event" });
    const viewer = made("viewer");
    const follow = samples.of({ type: TOKIO_EVENTS.FOLLOW });
    const username =
      typeof follow === "object" && follow && "user" in follow
        ? follow.user.username
        : "";

    expect(username).not.toBe("");
    expect(sampleReact(text, samples, "en", {})).toEqual({
      element: text.id,
      text: `Hi ${username}`,
    });
    expect(sampleReact(viewer, samples, "en", {})).toMatchObject({
      element: viewer.id,
      name: username,
    });
    expect(sampleReact(made("shape"), samples, "en", {})).toEqual({
      element: expect.any(String),
    });
  });

  it("takes no sample for one that moves all the time", () => {
    const samples = new Samples();
    const trigger = triggerOf(TOKIO_EVENTS.GIFT);

    const sends = made("gift", { gift: null, when: "event", trigger });
    const loops = made("gift", { gift: null, when: "loop", trigger });

    expect(sampleReact(sends, samples, "en", {}).picture).toMatch(/^https:/);
    expect(sampleReact(loops, samples, "en", {}).picture).toBe("");
  });

  it("gives a view the same samples Test plays", () => {
    const samples = new Samples();
    const deps = sampleDeps(samples, "en", {});
    const text = made("text", { text: "Hi {username} {likes}", when: "event" });
    const viewer = made("viewer");
    const gift = made("gift", {
      gift: null,
      when: "event",
      trigger: triggerOf(TOKIO_EVENTS.GIFT),
    });
    if (
      text.kind !== "text" ||
      viewer.kind !== "viewer" ||
      gift.kind !== "gift"
    ) {
      throw new Error("made the wrong kind");
    }

    expect(deps.text(text)).toBe(sampleReact(text, samples, "en", {}).text);
    expect(deps.text(text)).toContain(String(SAMPLE_NUMBERS.likes).slice(0, 2));
    expect(deps.viewer(viewer)).toEqual({
      src: sampleReact(viewer, samples, "en", {}).picture,
      name: sampleReact(viewer, samples, "en", {}).name,
    });
    expect(deps.sent(gift)).toBe(sampleReact(gift, samples, "en", {}).picture);
    expect(deps.sent(gift)).toMatch(/^https:/);
  });

  it("makes each list's rows once, values written in the language", () => {
    const samples = new Samples();
    const rows = (source: StudioListSource, language = "en") => {
      const list = made("list", { source });
      if (list.kind !== "list") throw new Error("made the wrong kind");
      return sampleDeps(samples, language, {}).rows(list);
    };

    const gifters = rows("gifters");
    expect(gifters).toHaveLength(STUDIO_MAX_LIST_ROWS);
    // The same names on every render
    expect(rows("gifters")).toEqual(gifters);
    // Biggest first
    expect(gifters.slice(0, 2).map((r) => r.value)).toEqual(["12.4K", "4.4K"]);
    expect(rows("gifters", "es-419")[0].value).toBe(
      formatStat(12_400, "es-419").short,
    );
    expect(gifters[0]).toMatchObject({ text: "", icon: "" });
    expect(gifters[0].name).not.toBe("");

    const [gift] = rows("gifts");
    expect(gift.icon).toMatch(/^https:/);
    expect(gift.value).toMatch(/^×\d/);
    expect(rows("followers")[0]).toMatchObject({ text: "", value: "" });
    const [chat] = rows("chat");
    expect(chat.text).not.toBe("");
    expect(chat.value).toBe("");
  });

  it("ranks a gifters list's own platform's gifters, in its currency", () => {
    const samples = new Samples(["kick", "youtube"]);
    const rows = (platform: Platform) => {
      const list = made("list", { source: "gifters", platform });
      if (list.kind !== "list") throw new Error("made the wrong kind");
      return sampleDeps(samples, "en", {}).rows(list);
    };

    expect(
      rows("youtube")
        .slice(0, 2)
        .map((r) => r.value),
    ).toEqual(["$124.00", "$43.84"]);
    expect(rows("kick")[0].value).toBe("12.4K");
    expect(rows("kick")).not.toEqual(rows("youtube"));
  });

  it("ranks a gifted subs list's sub gifters by their count", () => {
    const samples = new Samples(["twitch"]);
    const list = made("list", { source: "giftsubs", platform: "twitch" });
    if (list.kind !== "list") throw new Error("made the wrong kind");

    const rows = sampleDeps(samples, "en", {}).rows(list);

    expect(rows.slice(0, 3).map((r) => r.value)).toEqual(["25", "9", "5"]);
    expect(rows[0]).toMatchObject({ text: "", icon: "" });
    // Not the money list's rows
    const money = made("list", { source: "gifters", platform: "twitch" });
    if (money.kind !== "list") throw new Error("made the wrong kind");
    expect(sampleDeps(samples, "en", {}).rows(money)).not.toEqual(rows);
  });
});

describe("listRow", () => {
  it("writes a gifter's coins, and a gift's count after ×", () => {
    const entry = { picture: "", name: "Ana", text: "", icon: "", value: 1234 };

    expect(listRow(entry, "en").value).toBe("1.2K");
    expect(listRow({ ...entry, icon: "rose.png" }, "en").value).toBe("×1.2K");
    expect(listRow({ ...entry, value: null }, "en").value).toBe("");
  });

  it("writes US dollars for YouTube's top gifters only", () => {
    const entry = { picture: "", name: "Ana", text: "", icon: "", value: 57.4 };

    expect(listRow(entry, "en", true).value).toBe("$57.40");
    expect(listInUsd({ source: "gifters", platform: "youtube" })).toBe(true);
    expect(listInUsd({ source: "gifters", platform: "twitch" })).toBe(false);
    expect(listInUsd({ source: "chat", platform: "youtube" })).toBe(false);
  });
});
