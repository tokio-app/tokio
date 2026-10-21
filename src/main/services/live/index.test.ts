import { ActivityFeed } from "@/common/schemas";
import {
  ChatEvent,
  Emotes,
  GiftEvent,
  TOKIO_EVENTS,
  UserData,
} from "@/common/types";
import { defaultStoreData } from "@/common/util";
import { beforeEach, describe, expect, it } from "vitest";
import { ACTIVITY_LIMIT, LiveService } from "./index";

const viewer = (handle: string, patch: Partial<UserData> = {}): UserData => ({
  username: `${handle} name`,
  handle,
  profilePictures: [`${handle}.png`, `${handle}-large.png`],
  ...patch,
});

const shown = (handle: string) => ({
  handle,
  name: `${handle} name`,
  picture: `${handle}.png`,
});

const emote = (id: string): Emotes => ({
  emoteID: id,
  index: 0,
  images: [`${id}.png`, `${id}-large.png`],
});

const chat = (
  handle: string,
  content: string,
  emotes: Emotes[] = [],
): ChatEvent => ({
  user: viewer(handle),
  comment: { content, emotes, lang: "en" },
});

const gift = (patch: Partial<GiftEvent["gift"]> = {}): GiftEvent => ({
  user: viewer("mia"),
  gift: {
    id: "5655",
    name: "Rose",
    coins: 1,
    repeatEnd: true,
    type: 1,
    comboCount: 1,
    image: "rose.png",
    ...patch,
  },
});

const join = (live: LiveService, handle: string) =>
  live.record(TOKIO_EVENTS.MEMBER_JOIN, { user: viewer(handle) });

describe("LiveService", () => {
  let live: LiveService;

  beforeEach(() => {
    live = new LiveService();
  });

  it("starts without a LIVE", () => {
    expect(live.getSession()).toEqual({
      startedAt: null,
      totals: { followers: 0, shares: 0, gifts: 0, coins: 0 },
      activity: [],
    });
  });

  it("lists chats newest first, with the first image of each emote", () => {
    live.record(TOKIO_EVENTS.CHAT, chat("kenji", "hello"));
    live.record(TOKIO_EVENTS.CHAT, chat("yui", "hi", [emote("smile")]));

    expect(live.getSession().activity).toEqual([
      {
        id: 2,
        type: "chat",
        user: shown("yui"),
        text: "hi",
        emotes: ["smile.png"],
      },
      { id: 1, type: "chat", user: shown("kenji"), text: "hello", emotes: [] },
    ]);
  });

  it("names a viewer by the handle without a nickname, and without a picture when TikTok sent none", () => {
    live.record(TOKIO_EVENTS.FOLLOW, {
      user: viewer("sora", { username: "", profilePictures: [] }),
    });

    expect(live.getSession().activity[0]).toMatchObject({
      user: { handle: "sora", name: "sora", picture: "" },
    });
  });

  it("counts a gift once per combo, when the combo ends", () => {
    expect(
      live.record(TOKIO_EVENTS.GIFT, gift({ comboCount: 3, repeatEnd: false })),
    ).toBe(false);
    expect(live.getSession().activity).toEqual([]);

    expect(
      live.record(TOKIO_EVENTS.GIFT, gift({ comboCount: 5, coins: 2 })),
    ).toBe(true);

    const session = live.getSession();
    expect(session.totals).toMatchObject({ gifts: 5, coins: 10 });
    expect(session.activity).toEqual([
      {
        id: 1,
        type: "gift",
        user: shown("mia"),
        gift: { name: "Rose", image: "rose.png", count: 5, coins: 10 },
      },
    ]);
  });

  it("counts a gift without a combo count as one", () => {
    live.record(TOKIO_EVENTS.GIFT, gift({ comboCount: 0, coins: 29999 }));

    expect(live.getSession().totals).toMatchObject({ gifts: 1, coins: 29999 });
  });

  it("counts follows and shares, and lists new super fans", () => {
    live.record(TOKIO_EVENTS.FOLLOW, { user: viewer("sora") });
    live.record(TOKIO_EVENTS.SHARE, { user: viewer("ren"), shareCount: 4 });
    live.record(TOKIO_EVENTS.SUPER_FAN, { user: viewer("yui") });

    const session = live.getSession();
    expect(session.totals).toEqual({
      followers: 1,
      shares: 1,
      gifts: 0,
      coins: 0,
    });
    expect(session.activity).toEqual([
      { id: 3, type: "superfan", user: shown("yui") },
      { id: 2, type: "share", user: shown("ren") },
      { id: 1, type: "follow", user: shown("sora") },
    ]);
  });

  it("puts joins in a row in one item, naming the first two", () => {
    for (const handle of ["kai", "yui", "ren"]) {
      expect(join(live, handle)).toBe(true);
    }

    expect(live.getSession().activity).toEqual([
      { id: 1, type: "join", users: [shown("kai"), shown("yui")], count: 3 },
    ]);
  });

  it("starts another join item after other events", () => {
    join(live, "kai");
    live.record(TOKIO_EVENTS.CHAT, chat("kai", "hi"));
    join(live, "yui");

    expect(live.getSession().activity).toEqual([
      { id: 3, type: "join", users: [shown("yui")], count: 1 },
      expect.objectContaining({ id: 2, type: "chat" }),
      { id: 1, type: "join", users: [shown("kai")], count: 1 },
    ]);
  });

  it("doesn't count a viewer who joins again in the same row", () => {
    join(live, "kai");

    expect(join(live, "kai")).toBe(false);
    expect(live.getSession().activity).toEqual([
      { id: 1, type: "join", users: [shown("kai")], count: 1 },
    ]);
  });

  it("doesn't count a viewer who joins again after the names fill up", () => {
    for (const handle of ["kai", "yui", "ren"]) join(live, handle);

    expect(join(live, "ren")).toBe(false);
    expect(live.getSession().activity[0]).toMatchObject({ count: 3 });
  });

  it("counts viewers without a handle every time they join", () => {
    live.record(TOKIO_EVENTS.MEMBER_JOIN, { user: viewer("") });

    expect(live.record(TOKIO_EVENTS.MEMBER_JOIN, { user: viewer("") })).toBe(
      true,
    );
    expect(live.getSession().activity[0]).toMatchObject({ count: 2 });
  });

  it(`keeps the latest ${ACTIVITY_LIMIT} events`, () => {
    for (let n = 1; n <= ACTIVITY_LIMIT + 1; n++) {
      live.record(TOKIO_EVENTS.CHAT, chat("kenji", `message ${n}`));
    }

    const { activity } = live.getSession();
    expect(activity).toHaveLength(ACTIVITY_LIMIT);
    expect(activity[0]).toMatchObject({
      text: `message ${ACTIVITY_LIMIT + 1}`,
    });
    expect(activity.at(-1)).toMatchObject({ text: "message 2" });
  });

  it("clears the last LIVE when another starts", () => {
    live.record(TOKIO_EVENTS.FOLLOW, { user: viewer("sora") });

    live.start(1000);

    expect(live.getSession()).toEqual({
      startedAt: 1000,
      totals: { followers: 0, shares: 0, gifts: 0, coins: 0 },
      activity: [],
    });
  });

  it("keeps the feed when the LIVE ends, until the next one starts", () => {
    live.start(1000);
    live.record(TOKIO_EVENTS.CHAT, chat("kenji", "bye"));

    live.end();

    expect(live.getSession()).toMatchObject({
      startedAt: null,
      activity: [expect.objectContaining({ text: "bye" })],
    });
  });

  it("never reuses an id, also across LIVEs", () => {
    live.record(TOKIO_EVENTS.CHAT, chat("kenji", "first"));
    live.start();
    live.record(TOKIO_EVENTS.CHAT, chat("kenji", "second"));

    expect(live.getSession().activity[0].id).toBe(2);
  });

  it("gives a copy that later events don't change", () => {
    join(live, "kai");
    const before = live.getSession();

    join(live, "yui");
    live.record(TOKIO_EVENTS.FOLLOW, { user: viewer("sora") });

    expect(before.totals.followers).toBe(0);
    expect(before.activity).toEqual([
      { id: 1, type: "join", users: [shown("kai")], count: 1 },
    ]);
  });

  describe("feed", () => {
    // Every kind of event but these
    const hiding = (...kinds: (keyof ActivityFeed)[]): ActivityFeed => {
      const feed = { ...defaultStoreData.settings.activityFeed };
      for (const kind of kinds) feed[kind] = false;
      return feed;
    };

    it("leaves hidden events out, still counting them", () => {
      live.setFeed(hiding("chat", "gift", "superfan"));

      expect(live.record(TOKIO_EVENTS.CHAT, chat("kenji", "hi"))).toBe(false);
      expect(live.record(TOKIO_EVENTS.SUPER_FAN, { user: viewer("yui") })).toBe(
        false,
      );
      expect(live.record(TOKIO_EVENTS.GIFT, gift({ comboCount: 2 }))).toBe(
        true,
      );
      live.record(TOKIO_EVENTS.FOLLOW, { user: viewer("sora") });

      expect(live.getSession()).toEqual({
        startedAt: null,
        totals: { followers: 1, shares: 0, gifts: 2, coins: 2 },
        activity: [{ id: 1, type: "follow", user: shown("sora") }],
      });
    });

    it("drops the events it no longer shows", () => {
      live.record(TOKIO_EVENTS.CHAT, chat("kenji", "hi"));
      live.record(TOKIO_EVENTS.FOLLOW, { user: viewer("sora") });

      live.setFeed(hiding("chat"));

      expect(live.getSession().activity).toEqual([
        { id: 2, type: "follow", user: shown("sora") },
      ]);
    });

    it("keeps joins in one item across hidden events", () => {
      live.setFeed(hiding("chat"));

      join(live, "kai");
      live.record(TOKIO_EVENTS.CHAT, chat("kai", "hi"));
      join(live, "yui");

      expect(live.getSession().activity).toEqual([
        { id: 1, type: "join", users: [shown("kai"), shown("yui")], count: 2 },
      ]);
    });

    it("leaves joins out while they're hidden", () => {
      live.setFeed(hiding("join"));

      expect(join(live, "kai")).toBe(false);
      expect(live.getSession().activity).toEqual([]);
    });
  });
});
