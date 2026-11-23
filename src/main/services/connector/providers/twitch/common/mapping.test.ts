import { TOKIO_EVENTS } from "@/common/types";
import { describe, expect, it } from "vitest";
import {
  fromBits,
  fromFollow,
  fromNotification,
  fromRedemption,
  toChat,
  type ChatMessageEvent,
  type ChatNotificationEvent,
} from "./mapping";

// Shaped like the examples in Twitch's EventSub reference
const chat = (
  fragments: ChatMessageEvent["message"]["fragments"],
  extra: Partial<ChatMessageEvent> = {},
): ChatMessageEvent => ({
  chatter_user_id: "4145994",
  chatter_user_login: "viewer32",
  chatter_user_name: "Viewer32",
  message: { text: fragments.map((f) => f.text).join(""), fragments },
  badges: [],
  source_broadcaster_user_id: null,
  ...extra,
});

const text = (t: string) => ({ type: "text" as const, text: t });

const viewer = {
  username: "Viewer32",
  handle: "viewer32",
  profilePictures: [],
  follower: false,
  userId: "twitch:4145994",
  platform: "twitch",
};

const notice = (
  extra: Partial<ChatNotificationEvent>,
): ChatNotificationEvent => ({
  chatter_user_id: "4145994",
  chatter_user_login: "viewer32",
  chatter_user_name: "Viewer32",
  chatter_is_anonymous: false,
  badges: [],
  message: { text: "", fragments: [] },
  notice_type: "sub",
  ...extra,
});

describe("toChat", () => {
  it("maps a message, its badges and its viewer", () => {
    const event = chat([text("Hi chat")], {
      badges: [{ set_id: "moderator" }, { set_id: "subscriber" }],
    });

    expect(toChat(event, "1971641")).toEqual({
      user: { ...viewer, moderator: true, superfan: true },
      comment: { content: "Hi chat", emotes: [], lang: "" },
    });
  });

  it("flags the broadcaster as a moderator and a founder as a superfan", () => {
    const event = chat([text("hey")], {
      badges: [{ set_id: "broadcaster" }, { set_id: "founder" }],
    });

    expect(toChat(event, "1")?.user).toMatchObject({
      moderator: true,
      superfan: true,
    });
    expect(toChat(chat([text("hey")]), "1")?.user).toMatchObject({
      moderator: false,
      superfan: false,
    });
  });

  it("reads a subscriber's months off their badge's info", () => {
    const months = (badges: { set_id: string; info?: string }[]) =>
      toChat(chat([text("hey")], { badges }), "1")?.user.subMonths;

    expect(months([{ set_id: "subscriber", info: "16" }])).toBe(16);
    expect(
      months([
        { set_id: "moderator", info: "" },
        { set_id: "founder", info: "3" },
      ]),
    ).toBe(3);
    expect(months([{ set_id: "subscriber", info: "" }])).toBeUndefined();
    expect(months([{ set_id: "subscriber" }])).toBeUndefined();
    expect(months([{ set_id: "moderator", info: "7" }])).toBeUndefined();
  });

  it("leaves emotes and cheermotes out of the text, each emote at its place", () => {
    const event = chat([
      text("Hi "),
      {
        type: "emote",
        text: "Kappa",
        emote: { id: "25" },
      },
      text(" "),
      { type: "mention", text: "@streamer" },
      text(" "),
      { type: "cheermote", text: "Cheer100" },
      text(" great"),
    ]);

    expect(toChat(event, "1")?.comment).toEqual({
      content: "Hi  @streamer  great",
      emotes: [
        {
          emoteID: "twitch:25",
          images: [
            "https://static-cdn.jtvnw.net/emoticons/v2/25/default/dark/2.0",
          ],
          index: 3,
        },
      ],
      lang: "",
    });
  });

  it("sends a message of emotes only with no text, as TikTok's", () => {
    const event = chat([
      { type: "emote", text: "Kappa", emote: { id: "25" } },
      text(" "),
      { type: "emote", text: "LUL", emote: { id: "425618" } },
    ]);

    const comment = toChat(event, "1")?.comment;

    expect(comment?.content).toBe("");
    expect(comment?.emotes.map((e) => [e.emoteID, e.index])).toEqual([
      ["twitch:25", 0],
      ["twitch:425618", 0],
    ]);
  });

  it("drops other channels' messages in a Shared Chat", () => {
    expect(
      toChat(chat([text("hi")], { source_broadcaster_user_id: "999" }), "1"),
    ).toBeNull();
    expect(
      toChat(chat([text("hi")], { source_broadcaster_user_id: "1" }), "1"),
    ).not.toBeNull();
  });
});

describe("fromNotification", () => {
  it("maps a sub, and a Prime one", () => {
    expect(
      fromNotification(notice({ sub: { sub_tier: "1000", is_prime: false } })),
    ).toEqual({
      event: TOKIO_EVENTS.SUBSCRIBE,
      data: { user: viewer, tier: "1000", months: 1, message: "" },
    });
    expect(
      fromNotification(notice({ sub: { sub_tier: "1000", is_prime: true } })),
    ).toMatchObject({ data: { tier: "prime" } });
  });

  it("maps a resub with its months and its message, without emotes", () => {
    const event = notice({
      notice_type: "resub",
      resub: { cumulative_months: 10, sub_tier: "2000", is_prime: false },
      message: {
        text: "Love it Kappa",
        fragments: [
          text("Love it "),
          { type: "emote", text: "Kappa", emote: { id: "25" } },
        ],
      },
    });

    expect(fromNotification(event)).toEqual({
      event: TOKIO_EVENTS.SUBSCRIBE,
      data: { user: viewer, tier: "2000", months: 10, message: "Love it" },
    });
  });

  it("maps a community gift with its total, from an anonymous gifter too", () => {
    const event = notice({
      notice_type: "community_sub_gift",
      community_sub_gift: { total: 5, sub_tier: "1000" },
    });

    expect(fromNotification(event)).toEqual({
      event: TOKIO_EVENTS.GIFT_SUB,
      data: { user: viewer, count: 5, tier: "1000" },
    });
    expect(
      fromNotification({
        ...event,
        chatter_is_anonymous: true,
        chatter_user_id: "274598607",
        chatter_user_login: "ananonymousgifter",
        chatter_user_name: "AnAnonymousGifter",
      })?.data.user,
    ).toEqual({
      username: "Anonymous",
      handle: "",
      profilePictures: [],
      follower: false,
      platform: "twitch",
    });
  });

  it("counts a single gift, but not one of a community gift", () => {
    expect(
      fromNotification(
        notice({
          notice_type: "sub_gift",
          sub_gift: { sub_tier: "3000", community_gift_id: null },
        }),
      ),
    ).toEqual({
      event: TOKIO_EVENTS.GIFT_SUB,
      data: { user: viewer, count: 1, tier: "3000" },
    });
    expect(
      fromNotification(
        notice({
          notice_type: "sub_gift",
          sub_gift: { sub_tier: "1000", community_gift_id: "1234" },
        }),
      ),
    ).toBeNull();
  });

  it("maps a raid to its broadcaster, with their picture", () => {
    const event = notice({
      notice_type: "raid",
      raid: {
        user_id: "5678",
        user_login: "raider",
        user_name: "Raider",
        viewer_count: 42,
        profile_image_url: "https://static-cdn.jtvnw.net/raider.png",
      },
    });

    expect(fromNotification(event)).toEqual({
      event: TOKIO_EVENTS.RAID,
      data: {
        user: {
          username: "Raider",
          handle: "raider",
          profilePictures: ["https://static-cdn.jtvnw.net/raider.png"],
          follower: false,
          userId: "twitch:5678",
          platform: "twitch",
        },
        viewers: 42,
      },
    });
  });

  it("ignores Shared Chat's copies and other notices", () => {
    for (const notice_type of ["shared_chat_sub", "announcement", "unraid"]) {
      expect(fromNotification(notice({ notice_type }))).toBeNull();
    }
  });
});

describe("the other events", () => {
  const user = {
    user_id: "4145994",
    user_login: "viewer32",
    user_name: "Viewer32",
  };

  it("maps a follow", () => {
    expect(fromFollow(user)).toEqual({
      event: TOKIO_EVENTS.FOLLOW,
      data: { user: viewer },
    });
  });

  it("maps a cheer without its cheermotes, and a Power-up", () => {
    expect(
      fromBits({
        ...user,
        bits: 100,
        type: "cheer",
        message: {
          text: "Cheer100 great stream",
          fragments: [
            { type: "cheermote", text: "Cheer100" },
            text(" great stream"),
          ],
        },
      }),
    ).toEqual({
      event: TOKIO_EVENTS.CHEER,
      data: { user: viewer, bits: 100, message: "great stream" },
    });
    expect(
      fromBits({ ...user, bits: 50, type: "power_up", message: null }).data,
    ).toEqual({ user: viewer, bits: 50, message: "" });
  });

  it("maps a redemption with the reward and what the viewer typed", () => {
    expect(
      fromRedemption({
        ...user,
        user_input: "play my song",
        reward: { id: "92af127c", title: "Song request", cost: 500 },
      }),
    ).toEqual({
      event: TOKIO_EVENTS.REDEEM,
      data: {
        user: viewer,
        reward: { id: "92af127c", title: "Song request", cost: 500 },
        input: "play my song",
      },
    });
  });
});
