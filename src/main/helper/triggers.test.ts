import { GiftEvent, TOKIO_EVENTS } from "@/common/types";
import { describe, expect, it } from "vitest";
import { GiftStreaks } from "./streaks";
import { streakOf } from "./triggers";

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
