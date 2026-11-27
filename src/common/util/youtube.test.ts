import { describe, expect, it } from "vitest";
import { jewelsOf, YOUTUBE_GIFT_JEWELS } from "./youtube";

describe("jewelsOf", () => {
  it("gives a Gift's price by its picture's name", () => {
    expect(jewelsOf("silver_star_v2_320x320")).toBe(2);
    expect(jewelsOf("yes_jp")).toBe(2);
    expect(jewelsOf("heart")).toBe(10);
    expect(jewelsOf("gold_coin_v2_320x320")).toBe(10);
  });

  it("knows no regional gift, nor an object's own keys", () => {
    for (const key of ["elote", "ohagi", "", "constructor", "__proto__"]) {
      expect(jewelsOf(key)).toBeUndefined();
    }
  });

  it("prices every gift in whole Jewels", () => {
    for (const jewels of Object.values(YOUTUBE_GIFT_JEWELS)) {
      expect(Number.isInteger(jewels) && jewels > 0).toBe(true);
    }
  });
});
