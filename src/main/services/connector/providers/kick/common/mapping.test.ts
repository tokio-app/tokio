import { TOKIO_EVENTS } from "@/common/types";
import { describe, expect, it } from "vitest";
import { decode, eventName, fromPublication } from "./mapping";

// Made-up viewers in the shapes Kick's feed sends
const sender = (badges: string[] = []) => ({
  id: 4242,
  username: "Viewer_One",
  slug: "viewer_one",
  identity: {
    color: "#75FD46",
    badges: badges.map((type) => ({ type, text: type })),
    badges_v2: [],
  },
});

const chat = (content: string, badges?: string[]) =>
  fromPublication("App\\Events\\ChatMessageEvent", {
    id: "8c0f-made-up",
    chatroom_id: 1000,
    content,
    type: "message",
    created_at: "2026-11-22T14:03:43+00:00",
    sender: sender(badges),
    metadata: { message_ref: "1763820223000" },
  });

describe("Kick mapping", () => {
  it("decodes a publication's data, a string or already an object", () => {
    expect(decode('{"username":"a","months":2}')).toEqual({
      username: "a",
      months: 2,
    });
    expect(decode({ username: "a" })).toEqual({ username: "a" });
    expect(decode("not json")).toBeNull();
    expect(decode('"text"')).toBeNull();
    expect(decode(undefined)).toBeNull();
  });

  it("reads event names with or without the namespace", () => {
    expect(eventName("App\\Events\\StreamerIsLive")).toBe("StreamerIsLive");
    expect(eventName("KicksGifted")).toBe("KicksGifted");
  });

  describe("chat", () => {
    it("maps a message and its sender", () => {
      expect(chat("hello there")).toEqual({
        event: TOKIO_EVENTS.CHAT,
        data: {
          user: {
            username: "Viewer_One",
            handle: "viewer_one",
            profilePictures: [],
            follower: false,
            userId: "kick:4242",
            platform: "kick",
            moderator: false,
            superfan: false,
          },
          comment: { content: "hello there", emotes: [], lang: "" },
        },
      });
    });

    it("takes the emotes out of the text, each at its index", () => {
      const mapped = chat("hi [emote:37226:KEKW] all [emote:39275:GG]!");

      expect(
        mapped?.event === TOKIO_EVENTS.CHAT && mapped.data.comment,
      ).toEqual({
        content: "hi  all !",
        emotes: [
          {
            emoteID: "kick:37226",
            images: ["https://files.kick.com/emotes/37226/fullsize"],
            index: 3,
          },
          {
            emoteID: "kick:39275",
            images: ["https://files.kick.com/emotes/39275/fullsize"],
            index: 8,
          },
        ],
        lang: "",
      });
    });

    it("sends emotes alone with an empty content, every emote at 0", () => {
      const mapped = chat("[emote:1:a] [emote:2:b:c]");

      expect(
        mapped?.event === TOKIO_EVENTS.CHAT && mapped.data.comment,
      ).toEqual({
        content: "",
        emotes: [
          expect.objectContaining({ emoteID: "kick:1", index: 0 }),
          expect.objectContaining({ emoteID: "kick:2", index: 0 }),
        ],
        lang: "",
      });
    });

    it("reads moderators and Super Fans from the badges", () => {
      const user = (badges: string[]) => {
        const mapped = chat("hi", badges);
        return mapped?.event === TOKIO_EVENTS.CHAT
          ? mapped.data.user
          : undefined;
      };

      expect(user(["broadcaster"])).toMatchObject({ moderator: true });
      expect(user(["moderator", "vip"])).toMatchObject({
        moderator: true,
        superfan: false,
      });
      expect(user(["subscriber"])).toMatchObject({ superfan: true });
      expect(user(["founder", "og"])).toMatchObject({
        moderator: false,
        superfan: true,
      });
    });

    it("reads a subscriber's months off their badge's count", () => {
      const months = (badges: object[]) => {
        const mapped = fromPublication("App\\Events\\ChatMessageEvent", {
          content: "hi",
          sender: { ...sender(), identity: { badges } },
        });
        return mapped?.event === TOKIO_EVENTS.CHAT
          ? mapped.data.user.subMonths
          : "not chat";
      };

      // As kick.com's chat sent it on 2026-11-23
      expect(
        months([
          { type: "subscriber", text: "Subscriber", count: 3, sort_order: 9 },
        ]),
      ).toBe(3);
      expect(months([{ type: "vip" }, { type: "founder", count: 14 }])).toBe(
        14,
      );
      expect(months([{ type: "subscriber" }])).toBeUndefined();
      expect(months([{ type: "subscriber", count: 0 }])).toBeUndefined();
      expect(months([{ type: "og", count: 5 }])).toBeUndefined();
    });
  });

  it("maps a subscription by its name", () => {
    expect(
      fromPublication("App\\Events\\SubscriptionEvent", {
        chatroom_id: 1000,
        username: "Subber",
        months: 3,
      }),
    ).toEqual({
      event: TOKIO_EVENTS.SUBSCRIBE,
      data: {
        user: {
          username: "Subber",
          handle: "subber",
          profilePictures: [],
          follower: false,
          platform: "kick",
        },
        tier: "",
        months: 3,
        message: "",
      },
    });
  });

  it("counts gifted subs once, by the gifter", () => {
    for (const event of [
      "GiftedSubscriptionsEvent",
      "App\\Events\\GiftedSubscriptionsEvent",
    ]) {
      expect(
        fromPublication(event, {
          chatroom_id: 1000,
          gifter_username: "Generous",
          gifted_usernames: ["a", "b", "c"],
        }),
      ).toEqual({
        event: TOKIO_EVENTS.GIFT_SUB,
        data: {
          user: expect.objectContaining({
            username: "Generous",
            platform: "kick",
          }),
          count: 3,
          tier: "",
        },
      });
    }
  });

  it("maps a Kick to a gift worth its amount, ended at once", () => {
    expect(
      fromPublication("KicksGifted", {
        gift_transaction_id: "made-up",
        message: "for you",
        sender: {
          id: 77,
          username: "Kicker",
          username_color: "#fff",
          profile_picture: "https://files.kick.com/images/user/77/pic.webp",
        },
        gift: {
          gift_id: "rage_quit",
          name: "Rage Quit",
          amount: 100,
          type: "LEVEL_UP",
          tier: "MID",
        },
      }),
    ).toEqual({
      event: TOKIO_EVENTS.GIFT,
      data: {
        user: {
          username: "Kicker",
          handle: "kicker",
          profilePictures: ["https://files.kick.com/images/user/77/pic.webp"],
          follower: false,
          userId: "kick:77",
          platform: "kick",
        },
        gift: {
          id: "kick:rage_quit",
          name: "Rage Quit",
          coins: 100,
          image: "",
          type: 0,
          comboCount: 1,
          repeatEnd: true,
        },
      },
    });
  });

  it("maps a host to a raid", () => {
    expect(
      fromPublication("App\\Events\\StreamHostEvent", {
        chatroom_id: 1000,
        host_username: "OtherStreamer",
        number_viewers: 321,
        optional_message: null,
      }),
    ).toEqual({
      event: TOKIO_EVENTS.RAID,
      data: {
        user: expect.objectContaining({
          username: "OtherStreamer",
          handle: "otherstreamer",
        }),
        viewers: 321,
      },
    });
  });

  it("reads a redemption in either shape", () => {
    expect(
      fromPublication("RewardRedeemedEvent", {
        reward_title: "Hydrate",
        user_input: "now",
        username: "Thirsty",
      }),
    ).toEqual({
      event: TOKIO_EVENTS.REDEEM,
      data: {
        user: expect.objectContaining({ username: "Thirsty" }),
        reward: { id: "", title: "Hydrate", cost: 0 },
        input: "now",
      },
    });
    expect(
      fromPublication("RewardRedeemedEvent", {
        reward: { id: 9, title: "Hydrate", cost: 500 },
        user: { username: "Thirsty" },
      }),
    ).toMatchObject({
      data: { reward: { id: "9", title: "Hydrate", cost: 500 }, input: "" },
    });
  });

  it("ignores what Tokio doesn't use", () => {
    for (const event of [
      "App\\Events\\UserBannedEvent",
      "App\\Events\\MessageDeletedEvent",
      "App\\Events\\PinnedMessageCreatedEvent",
      "App\\Events\\PollUpdateEvent",
      "App\\Events\\ChatroomClearEvent",
      "App\\Events\\ChatMoveToSupportedChannelEvent",
      "App\\Events\\StreamerIsLive",
    ]) {
      expect(fromPublication(event, { id: "x" })).toBeNull();
    }
    expect(fromPublication("App\\Events\\ChatMessageEvent", null)).toBeNull();
  });
});
