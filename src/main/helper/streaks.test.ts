import { GiftEvent } from "@/common/types";
import { beforeEach, describe, expect, it } from "vitest";
import { GiftStreaks, LATE_MS } from "./streaks";

const gift = (
  comboCount: number,
  patch: Partial<GiftEvent["gift"]> = {},
  handle = "mia",
): GiftEvent => ({
  user: { username: `${handle} name`, handle, profilePictures: [] },
  gift: {
    id: "5655",
    name: "Rose",
    coins: 1,
    repeatEnd: false,
    type: 1,
    comboCount,
    image: "rose.png",
    ...patch,
  },
});

describe("GiftStreaks", () => {
  let streaks: GiftStreaks;

  beforeEach(() => {
    streaks = new GiftStreaks();
  });

  it("adds a growing count's growth", () => {
    expect(streaks.add(gift(1), 0)).toEqual({ added: 1, total: 1 });
    expect(streaks.add(gift(4), 100)).toEqual({ added: 3, total: 4 });
  });

  it("counts the same count again as the gift sent again, like the gift jar", () => {
    streaks.add(gift(1), 0);
    expect(streaks.add(gift(1), 100)).toEqual({ added: 1, total: 2 });
    expect(streaks.add(gift(3), 200)).toEqual({ added: 2, total: 4 });
    expect(streaks.add(gift(3, { repeatEnd: true }), 300)).toEqual({
      added: 0,
      total: 4,
    });
  });

  it("adds nothing for a lower count that came late", () => {
    streaks.add(gift(5), 0);
    expect(streaks.add(gift(3), LATE_MS - 1)).toEqual({ added: 0, total: 5 });
  });

  it("starts a new streak with a lower count after LATE_MS", () => {
    streaks.add(gift(5), 0);
    expect(streaks.add(gift(2), LATE_MS)).toEqual({ added: 2, total: 2 });
  });

  it("starts over after a streak ends", () => {
    streaks.add(gift(2), 0);
    streaks.add(gift(2, { repeatEnd: true }), 100);
    expect(streaks.add(gift(2), 200)).toEqual({ added: 2, total: 2 });
  });

  it("counts a gift that ends at once whole", () => {
    expect(streaks.add(gift(0, { repeatEnd: true }), 0)).toEqual({
      added: 1,
      total: 1,
    });
  });

  it("keeps each viewer's and gift's streak apart", () => {
    streaks.add(gift(3), 0);
    expect(streaks.add(gift(2, {}, "kai"), 100)).toEqual({
      added: 2,
      total: 2,
    });
    expect(streaks.add(gift(2, { id: "1" }), 100)).toEqual({
      added: 2,
      total: 2,
    });
    expect(streaks.add(gift(4), 200)).toEqual({ added: 1, total: 4 });
  });

  it("forgets every streak on clear", () => {
    streaks.add(gift(5), 0);
    streaks.clear();
    expect(streaks.add(gift(3), 100)).toEqual({ added: 3, total: 3 });
  });
});
