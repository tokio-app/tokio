import { describe, expect, it } from "vitest";
import { jewelsOf, YOUTUBE_GIFT_JEWELS, YOUTUBE_GIFT_NAMES } from "./youtube";

describe("jewelsOf", () => {
  it("gives a Gift's price by its picture's name", () => {
    expect(jewelsOf("silver_star_v2_320x320")).toBe(2);
    expect(jewelsOf("yes_jp")).toBe(2);
    expect(jewelsOf("heart")).toBe(10);
    expect(jewelsOf("gold_coin_v2_320x320")).toBe(10);
    // As the gift panel showed them on 2026-11-26
    expect(jewelsOf("one_hundred_v2_320x320")).toBe(2);
    expect(jewelsOf("elote")).toBe(30);
  });

  it("gives a Gift's price by its name when it doesn't know the picture", () => {
    expect(jewelsOf("tacos", "Tacos")).toBe(180);
    expect(jewelsOf("", "Órale")).toBe(100);
    // The picture wins: guitar is Rock star, not Guitar
    expect(jewelsOf("guitar", "Guitar")).toBe(7800);
  });

  it("knows no gift it has neither, nor an object's own keys", () => {
    for (const key of ["ohagi", "", "constructor", "__proto__"]) {
      expect(jewelsOf(key)).toBeUndefined();
      expect(jewelsOf(key, key)).toBeUndefined();
    }
    expect(jewelsOf("ohagi", "Ohagi")).toBeUndefined();
  });

  it("prices every gift in whole Jewels", () => {
    for (const jewels of [
      ...Object.values(YOUTUBE_GIFT_JEWELS),
      ...Object.values(YOUTUBE_GIFT_NAMES),
    ]) {
      expect(Number.isInteger(jewels) && jewels > 0).toBe(true);
    }
  });
});
