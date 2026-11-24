import {
  GOAL_TRIGGER,
  StudioElementSchema,
  StudioGroupSchema,
  StudioOverlay,
  TriggerSchema,
} from "@/common/schemas";
import {
  EMOTE_TRIGGER,
  GiftEvent,
  StudioNumbers,
  TOKIO_EVENTS,
  UserData,
} from "@/common/types";
import Logger from "@/logger";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudioService, studioText } from "./index";

const NUMBERS: StudioNumbers = {
  likes: 1200,
  viewers: 30,
  followers: 2,
  shares: 1,
  coins: 99,
  kicks: 0,
  bits: 0,
  superchats: null,
  gifts: 7,
  giftsubs: 0,
  uptime: 65,
};

const user = (name: string, picture = `https://cdn/${name}.png`): UserData => ({
  username: name,
  handle: name.toLowerCase(),
  profilePictures: picture ? [picture] : [],
});

const element = (id: string, patch: object) =>
  StudioElementSchema.parse({
    id,
    x: 0,
    y: 0,
    width: 100,
    height: 100,
    kind: "shape",
    when: "event",
    ...patch,
  });

const groupOf = (id: string, patch: object = {}) =>
  StudioGroupSchema.parse({ kind: "group", id, ...patch });

// One group holding the elements
const overlayOf = (
  ...elements: ReturnType<typeof element>[]
): StudioOverlay => ({
  id: "o1",
  name: "Main",
  size: "portrait",
  rulers: false,
  guides: { x: [], y: [], locked: false },
  counters: [],
  items: [groupOf("L1", { elements })],
});

const gift = (count: number, repeatEnd: boolean, id = "5655"): GiftEvent => ({
  user: user("Ana"),
  gift: {
    id,
    coins: 1,
    repeatEnd,
    type: 1,
    name: "Rose",
    comboCount: count,
    image: "",
  },
});

const setup = () => {
  const studio = new StudioService();
  const onReact = vi.fn();
  studio.onReact(onReact);
  const numbers = vi.fn(() => NUMBERS);
  return { studio, onReact, numbers };
};

describe("StudioService", () => {
  it("fills a text layer's text with the event and the live numbers", () => {
    const { studio, onReact, numbers } = setup();
    const text = element("t", {
      kind: "text",
      text: "Thanks {username}! {likes} likes",
      trigger: { type: TOKIO_EVENTS.FOLLOW, gifts: [] },
    });

    studio.handle(
      TOKIO_EVENTS.FOLLOW,
      { user: user("Ana") },
      [overlayOf(text)],
      numbers,
    );

    expect(onReact).toHaveBeenCalledWith("o1", {
      element: "t",
      text: "Thanks Ana! 1.2K likes",
    });
  });

  it("sends a gift element with none picked the gift the viewer sent", () => {
    const { studio, onReact, numbers } = setup();
    const trigger = { type: TOKIO_EVENTS.GIFT, gifts: [] };
    const sent = element("s", { kind: "gift", trigger });
    const picked = element("p", { kind: "gift", gift: 5655, trigger });
    const lion = gift(1, true);
    lion.gift.image = "https://g/lion.png";

    studio.handle(TOKIO_EVENTS.GIFT, lion, [overlayOf(sent, picked)], numbers);

    expect(onReact.mock.calls).toEqual([
      ["o1", { element: "s", picture: "https://g/lion.png" }],
      ["o1", { element: "p" }],
    ]);
  });

  it("sends an emote element with none picked the emote in the chat", () => {
    const { studio, onReact, numbers } = setup();
    const sent = element("e", {
      kind: "emote",
      trigger: { type: EMOTE_TRIGGER, gifts: [] },
    });

    studio.handle(
      TOKIO_EVENTS.CHAT,
      {
        user: user("Ana"),
        comment: {
          content: "",
          lang: "en",
          emotes: [{ emoteID: "7", index: 0, images: ["https://e/7.png"] }],
        },
      },
      [overlayOf(sent)],
      numbers,
    );

    expect(onReact.mock.calls).toEqual([
      ["o1", { element: "e", picture: "https://e/7.png" }],
    ]);
  });

  it("sends a viewer layer the viewer's picture and name", () => {
    const { studio, onReact, numbers } = setup();
    const viewer = element("v", { kind: "viewer" });

    studio.handle(
      TOKIO_EVENTS.FOLLOW,
      { user: user("Ana") },
      [overlayOf(viewer)],
      numbers,
    );
    studio.handle(
      TOKIO_EVENTS.FOLLOW,
      { user: { ...user("", ""), handle: "bo" } },
      [overlayOf(viewer)],
      numbers,
    );

    expect(onReact.mock.calls).toEqual([
      ["o1", { element: "v", picture: "https://cdn/Ana.png", name: "Ana" }],
      ["o1", { element: "v", picture: "", name: "bo" }],
    ]);
    // Only text elements read the numbers
    expect(numbers).not.toHaveBeenCalled();
  });

  it("leaves elements that are always on screen and other triggers alone", () => {
    const { studio, onReact, numbers } = setup();
    const always = element("a", { when: "always" });
    const share = element("s", {
      trigger: { type: TOKIO_EVENTS.SHARE, gifts: [] },
    });

    studio.handle(
      TOKIO_EVENTS.FOLLOW,
      { user: user("Ana") },
      [overlayOf(always, share)],
      numbers,
    );

    expect(onReact).not.toHaveBeenCalled();
  });

  it("reacts animate elements too, and matches emotes on chats", () => {
    const { studio, onReact, numbers } = setup();
    const animate = element("m", {
      when: "animate",
      trigger: { type: EMOTE_TRIGGER, gifts: [] },
    });
    const chat = (emotes: number) => ({
      user: user("Ana"),
      comment: {
        content: "hi",
        lang: "en",
        emotes: Array.from({ length: emotes }, () => ({
          emoteID: "1",
          index: 0,
          images: [],
        })),
      },
    });

    studio.handle(TOKIO_EVENTS.CHAT, chat(0), [overlayOf(animate)], numbers);
    studio.handle(TOKIO_EVENTS.CHAT, chat(1), [overlayOf(animate)], numbers);

    expect(onReact.mock.calls).toEqual([["o1", { element: "m" }]]);
  });

  it("reacts to a streak once, as it ends, with its total for every gift", () => {
    const { studio, onReact, numbers } = setup();
    const text = element("t", {
      kind: "text",
      text: "{count}x {gift}",
      trigger: { type: TOKIO_EVENTS.GIFT, gifts: [] },
    });
    const overlays = [overlayOf(text)];

    studio.handle(TOKIO_EVENTS.GIFT, gift(1, false), overlays, numbers);
    studio.handle(TOKIO_EVENTS.GIFT, gift(3, false), overlays, numbers);
    studio.handle(TOKIO_EVENTS.GIFT, gift(3, true), overlays, numbers);

    expect(onReact.mock.calls).toEqual([
      ["o1", { element: "t", text: "3x Rose" }],
    ]);
    expect(studio.kept("o1", text)?.values).toMatchObject({
      gift: { comboCount: 3 },
    });
  });

  it("reacts on Like each time the likes pass another likes_every, once per event", () => {
    const { studio, onReact, numbers } = setup();
    const like = element("l", {
      trigger: { type: TOKIO_EVENTS.LIKE, gifts: [] },
      likes_every: 10,
    });
    const likes = (likeCount: number) => ({
      user: user("Ana"),
      likeCount,
      totalLikes: 0,
    });
    const overlays = [overlayOf(like)];

    for (const count of [6, 3, 1, 25, 4]) {
      studio.handle(TOKIO_EVENTS.LIKE, likes(count), overlays, numbers);
    }

    // 6, 9, 10 (react), 25 (react, 5 left), 9
    expect(onReact).toHaveBeenCalledTimes(2);
  });

  it("keeps each layer's last event until its trigger changes", () => {
    const { studio, numbers } = setup();
    const text = element("t", {
      kind: "text",
      text: "{username}",
      trigger: { type: TOKIO_EVENTS.FOLLOW, gifts: [] },
    });

    expect(studio.kept("o1", text)).toBeNull();
    studio.handle(
      TOKIO_EVENTS.FOLLOW,
      { user: user("Ana") },
      [overlayOf(text)],
      numbers,
    );

    expect(studio.kept("o1", text)).toMatchObject({
      picture: "https://cdn/Ana.png",
      name: "Ana",
      values: { user: { username: "Ana" } },
    });
    const shared = StudioElementSchema.parse({
      ...text,
      trigger: { ...text.trigger, type: TOKIO_EVENTS.SHARE },
    });
    expect(studio.kept("o1", shared)).toBeNull();
  });

  it("clears the streaks and like counts but keeps the values", () => {
    const { studio, onReact, numbers } = setup();
    const like = element("l", {
      trigger: { type: TOKIO_EVENTS.LIKE, gifts: [] },
      likes_every: 10,
    });
    const overlays = [overlayOf(like)];
    const likes = { user: user("Ana"), likeCount: 6, totalLikes: 0 };

    studio.handle(
      TOKIO_EVENTS.LIKE,
      { ...likes, likeCount: 10 },
      overlays,
      numbers,
    );
    studio.handle(TOKIO_EVENTS.LIKE, likes, overlays, numbers);
    studio.clear();
    studio.handle(TOKIO_EVENTS.LIKE, likes, overlays, numbers);

    expect(onReact).toHaveBeenCalledTimes(1);
    expect(studio.kept("o1", like)).not.toBeNull();
  });

  it("reacts an element in a later layer", () => {
    const { studio, onReact, numbers } = setup();
    const back = element("b", {
      trigger: { type: TOKIO_EVENTS.SHARE, gifts: [] },
    });
    const front = element("f", {});
    const overlay: StudioOverlay = {
      ...overlayOf(),
      items: [groupOf("L1", { elements: [back] }), front],
    };

    studio.handle(
      TOKIO_EVENTS.FOLLOW,
      { user: user("Ana") },
      [overlay],
      numbers,
    );

    expect(onReact.mock.calls).toEqual([["o1", { element: "f" }]]);
  });

  it("reacts a hidden group's elements and keeps their values", () => {
    const { studio, onReact, numbers } = setup();
    const text = element("t", {
      kind: "text",
      text: "{username}",
      trigger: { type: TOKIO_EVENTS.FOLLOW, gifts: [] },
    });
    const overlay: StudioOverlay = {
      ...overlayOf(),
      items: [groupOf("L1", { hidden: true, elements: [text] })],
    };

    studio.handle(
      TOKIO_EVENTS.FOLLOW,
      { user: user("Ana") },
      [overlay],
      numbers,
    );

    expect(onReact).toHaveBeenCalledWith("o1", { element: "t", text: "Ana" });
    expect(studio.kept("o1", text)).toMatchObject({ name: "Ana" });
  });

  it("forgets a removed overlay's elements", () => {
    const { studio, numbers } = setup();
    const a = element("a", {});
    const b = element("b", {});
    const follow = { user: user("Ana") };

    studio.handle(TOKIO_EVENTS.FOLLOW, follow, [overlayOf(a)], numbers);
    studio.handle(
      TOKIO_EVENTS.FOLLOW,
      follow,
      [{ ...overlayOf(b), id: "o2" }],
      numbers,
    );
    studio.forget("o1");

    expect(studio.kept("o1", a)).toBeNull();
    expect(studio.kept("o2", b)).not.toBeNull();
  });

  it("keeps the values and likes of the same ids apart per overlay", () => {
    const { studio, onReact, numbers } = setup();
    const viewer = element("v", { kind: "viewer" });
    const like = element("l", {
      trigger: { type: TOKIO_EVENTS.LIKE, gifts: [] },
      likes_every: 10,
    });
    // A copy holds its source's element ids
    const first = overlayOf(viewer, like);
    const copy = { ...first, id: "o2" };
    const likes = (likeCount: number) => ({
      user: user("Ana"),
      likeCount,
      totalLikes: 0,
    });

    studio.handle(TOKIO_EVENTS.FOLLOW, { user: user("Ana") }, [first], numbers);
    studio.handle(TOKIO_EVENTS.LIKE, likes(6), [first], numbers);
    studio.handle(TOKIO_EVENTS.LIKE, likes(6), [copy], numbers);

    expect(studio.kept("o1", viewer)).toMatchObject({ name: "Ana" });
    expect(studio.kept("o2", viewer)).toBeNull();
    // 6 likes each, not 12 shared
    expect(onReact.mock.calls.filter(([, r]) => r.element === "l")).toEqual([]);

    studio.handle(TOKIO_EVENTS.FOLLOW, { user: user("Bea") }, [copy], numbers);
    studio.forget("o1");
    expect(studio.kept("o1", viewer)).toBeNull();
    expect(studio.kept("o2", viewer)).toMatchObject({ name: "Bea" });
    // The copy's count stays: 6 + 4 reacts it
    studio.handle(TOKIO_EVENTS.LIKE, likes(4), [copy], numbers);
    expect(onReact).toHaveBeenLastCalledWith("o2", { element: "l" });
  });

  it("tests every element that reacts with samples, kept while they show", () => {
    const { studio, onReact } = setup();
    const text = element("t", {
      kind: "text",
      text: "{username} {viewers}",
      trigger: { type: EMOTE_TRIGGER, gifts: [] },
    });
    const viewer = element("v", { kind: "viewer" });
    const always = element("a", { when: "always" });
    // On the viewer's trigger, as a follow alert's picture and text are
    const thanks = element("f", { kind: "text", text: "{username}" });

    studio.test(overlayOf(text, viewer, always, thanks), () => NUMBERS, [
      "tiktok",
    ]);
    const reacts = onReact.mock.calls.map(([, react]) => react);

    expect(onReact.mock.calls.every(([id]) => id === "o1")).toBe(true);
    expect(reacts).toHaveLength(3);
    // One sample per trigger: the same viewer
    expect(reacts[2]).toEqual({ element: "f", text: reacts[1].name });
    expect(reacts[0]).toEqual({
      element: "t",
      text: expect.stringMatching(/^\S.* 30$/),
    });
    expect(reacts[1]).toMatchObject({
      element: "v",
      picture: expect.stringMatching(/^https:/),
      name: expect.any(String),
    });
    // Views re-sent meanwhile show the samples
    expect(studio.kept("o1", text)).toMatchObject({ trigger: EMOTE_TRIGGER });
    expect(studio.kept("o1", viewer)).toMatchObject({ name: reacts[1].name });
    expect(studio.kept("o1", always)).toBeNull();
  });

  it("tests with samples from the profile's platforms", () => {
    const { studio, onReact } = setup();
    const viewer = element("v", { kind: "viewer" });

    studio.test(overlayOf(viewer), () => NUMBERS, ["kick", "twitch"]);

    // Kick has no follows: Twitch's
    expect(studio.kept("o1", viewer)?.values).toMatchObject({
      user: { platform: "twitch" },
    });
    expect(onReact).toHaveBeenCalledOnce();
  });

  it("keeps a Test's sample for its seconds and exit, until a real event", () => {
    const { studio, onReact, numbers } = setup();
    const now = vi.spyOn(performance, "now").mockReturnValue(1000);
    const viewer = element("v", { kind: "viewer", seconds: 5 });
    const overlay = overlayOf(viewer);
    const follow = (name: string) =>
      studio.handle(
        TOKIO_EVENTS.FOLLOW,
        { user: user(name) },
        [overlay],
        numbers,
      );
    follow("Ana");

    studio.test(overlay, () => NUMBERS, ["tiktok"]);
    const [, sample] = onReact.mock.lastCall!;
    expect(studio.kept("o1", viewer)).toMatchObject({ name: sample.name });
    // A second past its seconds, for its exit
    now.mockReturnValue(1000 + 5999);
    expect(studio.kept("o1", viewer)).toMatchObject({ name: sample.name });
    now.mockReturnValue(1000 + 6000);
    expect(studio.kept("o1", viewer)).toMatchObject({ name: "Ana" });

    // A real event wins over it
    studio.test(overlay, () => NUMBERS, ["tiktok"]);
    follow("Bea");
    expect(studio.kept("o1", viewer)).toMatchObject({ name: "Bea" });

    // Not once its trigger changed, nor once its overlay is gone
    studio.test(overlay, () => NUMBERS, ["tiktok"]);
    const shared = StudioElementSchema.parse({
      ...viewer,
      trigger: { ...viewer.trigger, type: TOKIO_EVENTS.SHARE },
    });
    expect(studio.kept("o1", shared)).toBeNull();
    studio.test(overlay, () => NUMBERS, ["tiktok"]);
    studio.forget("o1");
    expect(studio.kept("o1", viewer)).toBeNull();
  });

  it("reacts a group on its trigger with its id, and no values", () => {
    const { studio, onReact, numbers } = setup();
    const text = element("t", {
      kind: "text",
      text: "{username}",
      trigger: { type: TOKIO_EVENTS.FOLLOW, gifts: [] },
    });
    const group = groupOf("G", {
      when: "event",
      trigger: { type: TOKIO_EVENTS.FOLLOW, gifts: [] },
      elements: [text],
    });
    const share = groupOf("S", {
      when: "event",
      trigger: { type: TOKIO_EVENTS.SHARE, gifts: [] },
    });
    const overlay: StudioOverlay = { ...overlayOf(), items: [group, share] };

    studio.handle(
      TOKIO_EVENTS.FOLLOW,
      { user: user("Ana") },
      [overlay],
      numbers,
    );

    // The group first, then its elements
    expect(onReact.mock.calls).toEqual([
      ["o1", { element: "G" }],
      ["o1", { element: "t", text: "Ana" }],
    ]);
    expect(studio.kept("o1", text)).not.toBeNull();
  });

  it("counts a group's likes apart from an element's on Like", () => {
    const { studio, onReact, numbers } = setup();
    const trigger = { type: TOKIO_EVENTS.LIKE, gifts: [] };
    const like = element("l", { trigger, likes_every: 10 });
    const group = groupOf("G", {
      when: "event",
      trigger,
      likes_every: 4,
      elements: [like],
    });
    const likes = (likeCount: number) => ({
      user: user("Ana"),
      likeCount,
      totalLikes: 0,
    });
    const overlays: StudioOverlay[] = [{ ...overlayOf(), items: [group] }];

    for (const count of [3, 2, 9]) {
      studio.handle(TOKIO_EVENTS.LIKE, likes(count), overlays, numbers);
    }

    // The group: 3, 5 (react, 1 left), 10 (react, 2 left). The element: 3, 5,
    // 14 (react)
    const reacted = (id: string) =>
      onReact.mock.calls.filter(([, react]) => react.element === id);
    expect(reacted("G")).toHaveLength(2);
    expect(reacted("l")).toHaveLength(1);
  });

  it("never reacts a group or an element that loops", () => {
    const { studio, onReact, numbers } = setup();
    const loop = element("e", { when: "loop" });
    const group = groupOf("G", { when: "loop", elements: [loop] });

    studio.handle(
      TOKIO_EVENTS.FOLLOW,
      { user: user("Ana") },
      [{ ...overlayOf(), items: [group, loop] }],
      numbers,
    );

    expect(onReact).not.toHaveBeenCalled();
    expect(studio.kept("o1", loop)).toBeNull();
  });

  it("tests the groups that react, not loops or always-on ones", () => {
    const { studio, onReact } = setup();
    const reacting = groupOf("R", { when: "animate" });
    const loop = groupOf("L", { when: "loop" });
    const always = groupOf("A", { when: "always" });
    const mover = element("m", { when: "loop" });
    const overlay: StudioOverlay = {
      ...overlayOf(),
      items: [always, reacting, loop, mover, element("e", {})],
    };

    studio.test(overlay, () => NUMBERS, ["tiktok"]);

    expect(onReact.mock.calls).toEqual([
      ["o1", { element: "R" }],
      ["o1", { element: "e" }],
    ]);
  });

  it("shows a loop text none of an earlier event's values", () => {
    const { studio, numbers } = setup();
    const trigger = { type: TOKIO_EVENTS.FOLLOW, gifts: [] };
    const text = element("t", {
      kind: "text",
      text: "{username}!",
      trigger,
    });
    if (text.kind !== "text") throw new Error("not a text");
    studio.handle(
      TOKIO_EVENTS.FOLLOW,
      { user: user("Ana") },
      [overlayOf(text)],
      numbers,
    );
    const values = studio.kept("o1", text)?.values ?? null;
    const loop = { ...text, when: "loop" as const };

    expect(studioText(text, NUMBERS, {}, values)).toBe("Ana!");
    // A loop has no trigger's variables, so the name isn't filled in
    expect(studioText(loop, NUMBERS, {}, values)).toBe("{username}!");
  });
});

const chat = (content: string) => ({
  user: user("Ana"),
  comment: { content, lang: "en", emotes: [] },
});

describe("StudioService's triggers", () => {
  const follow = { user: user("Ana") };

  it("reacts when any of its triggers matches, and keeps what each sent", () => {
    const { studio, onReact, numbers } = setup();
    const text = element("t", {
      kind: "text",
      text: "{username}",
      trigger: { type: TOKIO_EVENTS.FOLLOW, gifts: [] },
      also_triggers: [
        { type: GOAL_TRIGGER },
        { type: TOKIO_EVENTS.SHARE, gifts: [] },
      ],
    });
    const overlays = [overlayOf(text)];

    studio.handle(
      TOKIO_EVENTS.SHARE,
      { user: user("Bea"), shareCount: 1 },
      overlays,
      numbers,
    );
    studio.handle(TOKIO_EVENTS.CHAT, chat("hi"), overlays, numbers);

    expect(onReact.mock.calls).toEqual([["o1", { element: "t", text: "Bea" }]]);
    expect(studio.kept("o1", text)).toMatchObject({
      trigger: TOKIO_EVENTS.SHARE,
      name: "Bea",
    });
    // Kept while Share is one of its triggers, first or not
    const first = StudioElementSchema.parse({
      ...text,
      trigger: { type: TOKIO_EVENTS.SHARE, gifts: [] },
      also_triggers: [],
    });
    expect(studio.kept("o1", first)).toMatchObject({ name: "Bea" });
    const without = StudioElementSchema.parse({ ...text, also_triggers: [] });
    expect(studio.kept("o1", without)).toBeNull();
  });

  it("counts likes only toward a Like trigger", () => {
    const { studio, onReact, numbers } = setup();
    const both = element("b", {
      trigger: { type: TOKIO_EVENTS.FOLLOW, gifts: [] },
      also_triggers: [{ type: TOKIO_EVENTS.LIKE, gifts: [] }],
      likes_every: 10,
    });
    const overlays = [overlayOf(both)];
    const likes = (likeCount: number) => ({
      user: user("Ana"),
      likeCount,
      totalLikes: 0,
    });

    studio.handle(TOKIO_EVENTS.FOLLOW, follow, overlays, numbers);
    studio.handle(TOKIO_EVENTS.LIKE, likes(6), overlays, numbers);
    studio.handle(TOKIO_EVENTS.FOLLOW, follow, overlays, numbers);
    studio.handle(TOKIO_EVENTS.LIKE, likes(4), overlays, numbers);

    // Each follow, then the 10th like
    expect(onReact).toHaveBeenCalledTimes(3);
    expect(studio.kept("o1", both)).toMatchObject({
      trigger: TOKIO_EVENTS.LIKE,
    });
  });
});

describe("StudioService's delay", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const text = element("t", {
    kind: "text",
    text: "{username} {likes}",
    trigger: { type: TOKIO_EVENTS.FOLLOW, gifts: [] },
    delay: 2,
  });
  const follow = (
    { studio, numbers }: ReturnType<typeof setup>,
    name: string,
    overlay = overlayOf(text),
  ) =>
    studio.handle(
      TOKIO_EVENTS.FOLLOW,
      { user: user(name) },
      [overlay],
      numbers,
    );

  it("plays and keeps the event after the delay, with the numbers then", () => {
    const s = setup();
    follow(s, "Ana");

    vi.advanceTimersByTime(1999);
    expect(s.onReact).not.toHaveBeenCalled();
    // Views sent meanwhile show what it had
    expect(s.studio.kept("o1", text)).toBeNull();

    s.numbers.mockReturnValue({ ...NUMBERS, likes: 5 });
    vi.advanceTimersByTime(1);
    expect(s.onReact.mock.calls).toEqual([
      ["o1", { element: "t", text: "Ana 5" }],
    ]);
    expect(s.studio.kept("o1", text)).toMatchObject({ name: "Ana" });
  });

  it("shows the newest match without starting the wait over", () => {
    const s = setup();
    follow(s, "Ana");
    vi.advanceTimersByTime(1500);
    follow(s, "Bea");

    vi.advanceTimersByTime(500);
    vi.advanceTimersByTime(5000);

    expect(s.onReact.mock.calls).toEqual([
      ["o1", { element: "t", text: "Bea 1.2K" }],
    ]);
  });

  it("delays a group's react too", () => {
    const s = setup();
    const group = groupOf("G", {
      when: "event",
      trigger: { type: TOKIO_EVENTS.FOLLOW, gifts: [] },
      delay: 1.5,
    });
    follow(s, "Ana", { ...overlayOf(), items: [group] });

    vi.advanceTimersByTime(1499);
    expect(s.onReact).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(s.onReact.mock.calls).toEqual([["o1", { element: "G" }]]);
  });

  it("drops the reacts waiting on clear and on forget", () => {
    const s = setup();
    follow(s, "Ana");
    s.studio.clear();
    follow(s, "Bea", { ...overlayOf(text), id: "o2" });
    s.studio.forget("o2");

    vi.advanceTimersByTime(5000);

    expect(s.onReact).not.toHaveBeenCalled();
    // A new match waits again
    follow(s, "Cai");
    vi.advanceTimersByTime(2000);
    expect(s.onReact).toHaveBeenCalledTimes(1);
  });

  it("logs a react that fails when it plays", () => {
    const s = setup();
    const error = vi.spyOn(Logger, "error").mockImplementation(() => {});
    s.studio.setLogFile("overlays.log");
    s.onReact.mockImplementation(() => {
      throw new Error("boom");
    });
    follow(s, "Ana");

    vi.advanceTimersByTime(2000);

    expect(error).toHaveBeenCalledWith(
      expect.stringMatching(/^<Studio> .*boom/),
      "overlays.log",
      expect.any(Error),
    );
  });

  it("plays a Test after the delay, keeping its sample from then", () => {
    const s = setup();
    const now = vi.spyOn(performance, "now").mockReturnValue(1000);
    const viewer = element("v", { kind: "viewer", seconds: 5, delay: 2 });
    const overlay = overlayOf(viewer);

    s.studio.test(overlay, () => NUMBERS, ["tiktok"]);
    expect(s.onReact).not.toHaveBeenCalled();
    expect(s.studio.kept("o1", viewer)).toBeNull();

    now.mockReturnValue(3000);
    vi.advanceTimersByTime(2000);
    const [[, sample]] = s.onReact.mock.calls;
    expect(sample).toMatchObject({ element: "v", name: expect.any(String) });
    // Its seconds and exit count from when it played
    now.mockReturnValue(3000 + 5999);
    expect(s.studio.kept("o1", viewer)).toMatchObject({ name: sample.name });
    now.mockReturnValue(3000 + 6000);
    expect(s.studio.kept("o1", viewer)).toBeNull();
  });
});

describe("StudioService's counters", () => {
  const counted = (
    counters: { name: string; trigger: object }[],
    id = "o1",
  ): StudioOverlay => ({
    ...overlayOf(),
    id,
    counters: counters.map(({ name, trigger }) => ({
      name,
      trigger: TriggerSchema.parse({ gifts: [], ...trigger }),
    })),
  });
  const likes = (likeCount: number) => ({
    user: user("Ana"),
    likeCount,
    totalLikes: 0,
  });

  it("counts a streak's gifts once, with every_gift or at its end", () => {
    const { studio, numbers } = setup();
    const overlay = counted([
      { name: "each", trigger: { type: TOKIO_EVENTS.GIFT, every_gift: true } },
      { name: "ends", trigger: { type: TOKIO_EVENTS.GIFT } },
      { name: "lions", trigger: { type: TOKIO_EVENTS.GIFT, gifts: [6369] } },
    ]);

    for (const event of [gift(1, false), gift(3, false), gift(3, true)]) {
      studio.handle(TOKIO_EVENTS.GIFT, event, [overlay], numbers);
    }

    expect(studio.counts(overlay)).toEqual({ each: 3, ends: 3, lions: 0 });
  });

  it("counts a Like's likes and one for any other event", () => {
    const { studio, numbers } = setup();
    const overlay = counted([
      { name: "taps", trigger: { type: TOKIO_EVENTS.LIKE } },
      { name: "follows", trigger: { type: TOKIO_EVENTS.FOLLOW } },
    ]);
    const overlays = [overlay];

    studio.handle(TOKIO_EVENTS.LIKE, likes(15), overlays, numbers);
    studio.handle(TOKIO_EVENTS.LIKE, likes(-3), overlays, numbers);
    studio.handle(
      TOKIO_EVENTS.FOLLOW,
      { user: user("Ana") },
      overlays,
      numbers,
    );
    studio.handle(
      TOKIO_EVENTS.FOLLOW,
      { user: user("Bea") },
      overlays,
      numbers,
    );
    studio.handle(
      TOKIO_EVENTS.SHARE,
      { user: user("Bea"), shareCount: 1 },
      overlays,
      numbers,
    );

    expect(studio.counts(overlay)).toEqual({ taps: 15, follows: 2 });
  });

  it("keeps each overlay's counts apart, and resets them for a new LIVE", () => {
    const { studio, numbers } = setup();
    const trigger = { type: TOKIO_EVENTS.FOLLOW };
    const first = counted([{ name: "fans", trigger }]);
    const other = counted([{ name: "fans", trigger }], "o2");
    const follow = (overlays: StudioOverlay[]) =>
      studio.handle(
        TOKIO_EVENTS.FOLLOW,
        { user: user("Ana") },
        overlays,
        numbers,
      );

    follow([first, other]);
    follow([first]);
    expect(studio.counts(first)).toEqual({ fans: 2 });
    expect(studio.counts(other)).toEqual({ fans: 1 });

    studio.startLive();
    expect(studio.counts(first)).toEqual({ fans: 0 });
    follow([first]);
    studio.clear();
    expect(studio.counts(first)).toEqual({ fans: 0 });
  });

  it("shows the counts in a text's react", () => {
    const { studio, onReact, numbers } = setup();
    const text = element("t", {
      kind: "text",
      text: "{fans} fans",
      trigger: { type: TOKIO_EVENTS.FOLLOW, gifts: [] },
    });
    const overlay = {
      ...counted([{ name: "fans", trigger: { type: TOKIO_EVENTS.FOLLOW } }]),
      items: [text],
    };

    studio.handle(
      TOKIO_EVENTS.FOLLOW,
      { user: user("Ana") },
      [overlay],
      numbers,
    );

    // Counted before it reacts
    expect(onReact).toHaveBeenCalledWith("o1", {
      element: "t",
      text: "1 fans",
    });
  });
});

describe("StudioService's goals", () => {
  const goal = (number: string, value: number) => ({
    type: GOAL_TRIGGER,
    number,
    goal: value,
  });
  const text = element("t", {
    kind: "text",
    text: "{username} {likes}",
    trigger: goal("likes", 1000),
    also_triggers: [{ type: TOKIO_EVENTS.FOLLOW, gifts: [] }],
  });
  const at = (likes: number) => ({ ...NUMBERS, likes });

  it("reacts once per LIVE when a LIVE number reaches the goal, with what it kept", () => {
    const { studio, onReact, numbers } = setup();
    const overlays = [overlayOf(text)];
    studio.handle(
      TOKIO_EVENTS.FOLLOW,
      { user: user("Ana") },
      overlays,
      numbers,
    );
    onReact.mockClear();

    studio.goals(overlays, at(999));
    expect(onReact).not.toHaveBeenCalled();
    studio.goals(overlays, at(1000));
    studio.goals(overlays, at(1500));
    expect(onReact.mock.calls).toEqual([
      ["o1", { element: "t", text: "Ana 1K" }],
    ]);

    studio.startLive();
    studio.goals(overlays, at(1000));
    expect(onReact).toHaveBeenCalledTimes(2);
    studio.clear();
    studio.goals(overlays, at(1000));
    expect(onReact).toHaveBeenCalledTimes(3);
  });

  it("reacts again once its goal changed", () => {
    const { studio, onReact } = setup();
    studio.goals([overlayOf(text)], at(1200));
    const lowered = StudioElementSchema.parse({
      ...text,
      trigger: goal("likes", 1100),
    });

    studio.goals([overlayOf(lowered)], at(1200));

    expect(onReact).toHaveBeenCalledTimes(2);
  });

  it("watches a counter by its name, never uptime", () => {
    const { studio, onReact, numbers } = setup();
    const group = groupOf("G", {
      when: "event",
      trigger: goal("roses", 2),
      also_triggers: [goal("uptime", 1)],
    });
    const overlay: StudioOverlay = {
      ...overlayOf(),
      counters: [
        {
          name: "roses",
          trigger: TriggerSchema.parse({
            type: TOKIO_EVENTS.GIFT,
            gifts: [],
            every_gift: true,
          }),
        },
      ],
      items: [group],
    };
    const goals = () => studio.goals([overlay], { ...NUMBERS, uptime: 9999 });

    studio.handle(TOKIO_EVENTS.GIFT, gift(1, false), [overlay], numbers);
    goals();
    expect(onReact).not.toHaveBeenCalled();
    studio.handle(TOKIO_EVENTS.GIFT, gift(2, false), [overlay], numbers);
    goals();
    goals();

    expect(onReact.mock.calls).toEqual([["o1", { element: "G" }]]);
  });

  it("waits the item's delay, behind an event's react already waiting", () => {
    vi.useFakeTimers();
    try {
      const { studio, onReact, numbers } = setup();
      const late = StudioElementSchema.parse({ ...text, delay: 1 });
      const overlays = [overlayOf(late)];

      studio.handle(
        TOKIO_EVENTS.FOLLOW,
        { user: user("Ana") },
        overlays,
        numbers,
      );
      studio.goals(overlays, at(1000));
      vi.advanceTimersByTime(1000);

      // One react, the event's, which keeps it
      expect(onReact.mock.calls).toEqual([
        ["o1", { element: "t", text: "Ana 1.2K" }],
      ]);
      expect(studio.kept("o1", late)).toMatchObject({ name: "Ana" });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("StudioService's lists", () => {
  const chat = (name: string, content: string) => ({
    user: user(name),
    comment: { content, emotes: [], lang: "en" },
  });

  it("keeps the newest follows, one row per viewer", () => {
    const { studio, numbers } = setup();

    for (const name of ["Ana", "Bo", "Ana"]) {
      studio.handle(TOKIO_EVENTS.FOLLOW, { user: user(name) }, [], numbers);
    }

    // Ana followed again: she moves up, not in twice
    expect(studio.list("followers")).toEqual([
      {
        picture: "https://cdn/Ana.png",
        name: "Ana",
        text: "",
        icon: "",
        value: null,
      },
      expect.objectContaining({ name: "Bo" }),
    ]);
  });

  it("lists a gift streak once, as it ends, with its total", () => {
    const { studio, numbers } = setup();
    const rose = (count: number, end: boolean) => {
      const event = gift(count, end);
      event.gift.image = "https://g/rose.png";
      return event;
    };

    studio.handle(TOKIO_EVENTS.GIFT, rose(2, false), [], numbers);
    studio.handle(TOKIO_EVENTS.GIFT, rose(5, false), [], numbers);
    expect(studio.list("gifts")).toEqual([]);
    studio.handle(TOKIO_EVENTS.GIFT, rose(5, true), [], numbers);

    expect(studio.list("gifts")).toEqual([
      {
        picture: "https://cdn/Ana.png",
        name: "Ana",
        text: "",
        icon: "https://g/rose.png",
        value: 5,
      },
    ]);
  });

  it("lists chat with words, not one of emotes alone", () => {
    const { studio, numbers } = setup();

    studio.handle(TOKIO_EVENTS.CHAT, chat("Ana", "hi"), [], numbers);
    // As the connector sends an emote-only comment
    studio.handle(TOKIO_EVENTS.CHAT, chat("Bo", ""), [], numbers);
    studio.handle(TOKIO_EVENTS.CHAT, chat("Cy", " \u200b "), [], numbers);

    expect(studio.list("chat")).toEqual([
      expect.objectContaining({ name: "Ana", text: "hi" }),
    ]);
  });

  it("keeps the newest ten of each, newest first", () => {
    const { studio, numbers } = setup();

    for (let i = 1; i <= 12; i++) {
      studio.handle(TOKIO_EVENTS.CHAT, chat("Ana", `#${i}`), [], numbers);
    }

    const texts = studio.list("chat").map((e) => e.text);
    expect(texts).toHaveLength(10);
    expect(texts[0]).toBe("#12");
    expect(texts.at(-1)).toBe("#3");
  });

  it("empties them for a new LIVE and when it ends", () => {
    const { studio, numbers } = setup();
    const fill = () => {
      studio.handle(TOKIO_EVENTS.FOLLOW, { user: user("Ana") }, [], numbers);
      studio.handle(TOKIO_EVENTS.CHAT, chat("Ana", "hi"), [], numbers);
      studio.handle(TOKIO_EVENTS.GIFT, gift(1, true), [], numbers);
    };
    const empty = () =>
      (["followers", "gifts", "chat"] as const).every(
        (source) => studio.list(source).length === 0,
      );

    fill();
    expect(empty()).toBe(false);
    studio.startLive();
    expect(empty()).toBe(true);

    fill();
    studio.clear();
    expect(empty()).toBe(true);
  });
});
