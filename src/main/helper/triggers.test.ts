import type { Trigger } from "@/common/schemas";
import {
  AppEvents,
  GiftEvent,
  Platform,
  TOKIO_EVENTS,
  TokioEventMap,
} from "@/common/types";
import { describe, expect, it } from "vitest";
import { GiftStreaks } from "./streaks";
import { matchesTrigger, streakOf } from "./triggers";

const gift = (comboCount: number): GiftEvent => ({
  user: { username: "mia name", handle: "mia", profilePictures: [] },
  gift: {
    id: "5655",
    name: "Rose",
    coins: 1,
    repeatEnd: false,
    type: 1,
    comboCount,
    image: "rose.png",
  },
});

describe("streakOf", () => {
  it("counts a gift in its streak, with the streak's count as {count}", () => {
    const streaks = new GiftStreaks();
    streakOf(streaks, TOKIO_EVENTS.GIFT, gift(1));
    // The same count again is the gift sent again
    expect(streakOf(streaks, TOKIO_EVENTS.GIFT, gift(1))).toEqual({
      added: 1,
      total: 2,
      values: { ...gift(1), gift: { ...gift(1).gift, comboCount: 2 } },
    });
  });

  it("adds nothing for any other event, which keeps its payload", () => {
    const follow = { user: gift(1).user };
    expect(streakOf(new GiftStreaks(), TOKIO_EVENTS.FOLLOW, follow)).toEqual({
      added: 0,
      total: 0,
      values: follow,
    });
  });
});

describe("matchesTrigger", () => {
  const trigger = (
    type: Trigger["type"],
    patch: Partial<Trigger> = {},
  ): Trigger => ({
    type,
    gifts: [],
    every_gift: false,
    emotes: [],
    keyword: "",
    user: "",
    min_coins: 0,
    roles: [],
    ...patch,
  });
  const follow = (platform?: Platform): TokioEventMap[TOKIO_EVENTS.FOLLOW] => ({
    user: {
      username: "Mia",
      handle: "mia",
      profilePictures: [],
      ...(platform && { platform }),
    },
  });
  const matches = (t: Trigger, type: AppEvents, payload: unknown) =>
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    matchesTrigger(t, type, payload as TokioEventMap[AppEvents], 0, 0);

  it("takes any platform's event without a platform", () => {
    const any = trigger(TOKIO_EVENTS.FOLLOW);

    expect(matches(any, TOKIO_EVENTS.FOLLOW, follow())).toBe(true);
    expect(matches(any, TOKIO_EVENTS.FOLLOW, follow("twitch"))).toBe(true);
  });

  it("takes only its platform's events, a viewer without one being TikTok's", () => {
    const twitch = trigger(TOKIO_EVENTS.FOLLOW, { platform: "twitch" });
    const tiktok = trigger(TOKIO_EVENTS.FOLLOW, { platform: "tiktok" });

    expect(matches(twitch, TOKIO_EVENTS.FOLLOW, follow("twitch"))).toBe(true);
    expect(matches(twitch, TOKIO_EVENTS.FOLLOW, follow())).toBe(false);
    expect(matches(tiktok, TOKIO_EVENTS.FOLLOW, follow())).toBe(true);
    expect(matches(tiktok, TOKIO_EVENTS.FOLLOW, follow("tiktok"))).toBe(true);
    expect(matches(tiktok, TOKIO_EVENTS.FOLLOW, follow("twitch"))).toBe(false);
  });

  it("counts an event without a viewer as TikTok's, but Music change as no platform's", () => {
    const box = TOKIO_EVENTS.SUPER_FAN_BOX;
    const music = TOKIO_EVENTS.MUSIC_CHANGE;

    expect(matches(trigger(box, { platform: "tiktok" }), box, {})).toBe(true);
    expect(matches(trigger(box, { platform: "twitch" }), box, {})).toBe(false);
    expect(matches(trigger(music), music, [])).toBe(true);
    expect(matches(trigger(music, { platform: "tiktok" }), music, [])).toBe(
      false,
    );
  });

  it("takes a redeem of the reward its keyword names, in any case", () => {
    const redeem = (title: string) => ({
      ...follow("twitch"),
      reward: { id: "r1", title, cost: 100 },
      input: "",
    });
    const named = trigger(TOKIO_EVENTS.REDEEM, { keyword: " hydrate " });

    expect(matches(named, TOKIO_EVENTS.REDEEM, redeem("Hydrate"))).toBe(true);
    expect(matches(named, TOKIO_EVENTS.REDEEM, redeem("Hydrate now"))).toBe(
      false,
    );
    expect(
      matches(trigger(TOKIO_EVENTS.REDEEM), TOKIO_EVENTS.REDEEM, redeem("Any")),
    ).toBe(true);
  });

  it("holds each money event to its own minimum: Bits, US dollars, subs", () => {
    const { user } = follow("twitch");
    const cheer = (bits: number) => ({ user, bits, message: "" });
    const bits = trigger(TOKIO_EVENTS.CHEER, { min_coins: 100 });
    expect(matches(bits, TOKIO_EVENTS.CHEER, cheer(100))).toBe(true);
    expect(matches(bits, TOKIO_EVENTS.CHEER, cheer(99))).toBe(false);

    const subs = (count: number) => ({ user, count, tier: "1000" });
    const five = trigger(TOKIO_EVENTS.GIFT_SUB, { min_coins: 5 });
    expect(matches(five, TOKIO_EVENTS.GIFT_SUB, subs(5))).toBe(true);
    expect(matches(five, TOKIO_EVENTS.GIFT_SUB, subs(4))).toBe(false);

    const superChat = (usd?: number | null) => ({
      user: follow("youtube").user,
      amount: "MX$100.00",
      message: "",
      sticker: "",
      ...(usd !== undefined && { usd }),
    });
    const dollars = trigger(TOKIO_EVENTS.SUPER_CHAT, { min_coins: 5 });
    expect(matches(dollars, TOKIO_EVENTS.SUPER_CHAT, superChat(5.4))).toBe(
      true,
    );
    expect(matches(dollars, TOKIO_EVENTS.SUPER_CHAT, superChat(4.99))).toBe(
      false,
    );
    // Without dollars, as before the rates load, it still plays
    expect(matches(dollars, TOKIO_EVENTS.SUPER_CHAT, superChat(null))).toBe(
      true,
    );
    expect(matches(dollars, TOKIO_EVENTS.SUPER_CHAT, superChat())).toBe(true);
  });

  it("holds a gift to its minimum in its own currency, for any gift only", () => {
    const worth = (coins: number) => ({
      ...gift(1),
      gift: { ...gift(1).gift, coins, repeatEnd: true },
    });
    const any = trigger(TOKIO_EVENTS.GIFT, { min_coins: 100 });
    const picked = trigger(TOKIO_EVENTS.GIFT, {
      min_coins: 100,
      gifts: [5655],
    });

    expect(matchesTrigger(any, TOKIO_EVENTS.GIFT, worth(50), 1, 2)).toBe(true);
    expect(matchesTrigger(any, TOKIO_EVENTS.GIFT, worth(50), 1, 1)).toBe(false);
    expect(matchesTrigger(picked, TOKIO_EVENTS.GIFT, worth(1), 1, 1)).toBe(
      true,
    );
  });
});
