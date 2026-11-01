import { liveSummary } from "@test/fixtures";
import { describe, expect, it } from "vitest";
import { allTime, capitalize, keepSelection } from "./helper";

describe("allTime", () => {
  it("adds up every LIVE, with the best peak and the total length", () => {
    const lives = [
      liveSummary(3000, {
        coins: 100,
        gifts: 10,
        followers: 3,
        shares: 2,
        likes: 500,
        views: 80,
        peakViewers: 30,
        endedAt: 3000 + 60_000,
      }),
      liveSummary(1000, {
        coins: 25,
        gifts: 5,
        followers: 1,
        shares: 0,
        likes: 120,
        views: 20,
        peakViewers: 12,
        endedAt: 1000 + 30_000,
      }),
    ];

    expect(allTime(lives)).toEqual({
      coins: 125,
      gifts: 15,
      followers: 4,
      shares: 2,
      likes: 620,
      views: 100,
      peakViewers: 30,
      length: 90_000,
    });
  });

  it("is all zeros without LIVEs", () => {
    expect(allTime([])).toEqual({
      coins: 0,
      gifts: 0,
      followers: 0,
      shares: 0,
      likes: 0,
      views: 0,
      peakViewers: 0,
      length: 0,
    });
  });
});

describe("keepSelection", () => {
  const lives = [liveSummary(3), liveSummary(2), liveSummary(1)];
  const without = (startedAt: number) =>
    lives.filter((live) => live.startedAt !== startedAt);

  it("selects the newest LIVE first, or All time without any", () => {
    expect(keepSelection(undefined, [], lives)).toBe(3);
    expect(keepSelection(undefined, [], [])).toBeNull();
  });

  it("keeps the LIVE or All time while it's there", () => {
    expect(keepSelection(2, lives, lives)).toBe(2);
    expect(keepSelection(null, lives, lives)).toBeNull();
  });

  it("moves to the next LIVE after a delete, or the one before the last", () => {
    expect(keepSelection(3, lives, without(3))).toBe(2);
    expect(keepSelection(2, lives, without(2))).toBe(1);
    expect(keepSelection(1, lives, without(1))).toBe(2);
  });

  it("goes to All time when no LIVE is left", () => {
    expect(keepSelection(3, lives, [])).toBeNull();
  });
});

describe("capitalize", () => {
  it("capitalizes a date that starts in lowercase", () => {
    expect(capitalize("sábado, 31 de octubre de 2026", "es-419")).toBe(
      "Sábado, 31 de octubre de 2026",
    );
    expect(capitalize("Saturday", "en")).toBe("Saturday");
  });
});
