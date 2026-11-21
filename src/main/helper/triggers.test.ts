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
});
