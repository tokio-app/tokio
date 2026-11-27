import { liveSummary } from "@test/fixtures";
import { describe, expect, it } from "vitest";
import {
  allTime,
  capitalize,
  DateFilter,
  dateRange,
  historyPlatforms,
  keepSelection,
  liveValue,
  periodText,
  readout,
  statsTabs,
} from "./helper";

// Local times, so the days read the same in any time zone
const day = (date: number, hours = 0, minutes = 0) =>
  new Date(2026, 9, date, hours, minutes).getTime();
const NOW = day(31, 12);
const HOUR = 3_600_000;

const custom = (patch: Partial<DateFilter>): DateFilter => ({
  preset: "custom",
  operator: "between",
  from: { date: "", time: "" },
  to: { date: "", time: "" },
  ...patch,
});
const at = (date: string, time = "") => ({ date, time });

describe("dateRange", () => {
  it("counts the presets back from now", () => {
    const preset = (preset: DateFilter["preset"]) =>
      dateRange({ ...custom({}), preset }, NOW);
    expect(preset("all")).toBeNull();
    expect(preset("day")).toEqual({ from: NOW - 24 * HOUR });
    expect(preset("week")).toEqual({ from: NOW - 7 * 24 * HOUR });
    expect(preset("month")).toEqual({ from: NOW - 30 * 24 * HOUR });
    // 12 months follow the calendar
    expect(preset("year")).toEqual({
      from: new Date(2025, 9, 31, 12).getTime(),
    });
  });

  it("keeps whole days without a time, and On's always", () => {
    expect(
      dateRange(
        custom({ operator: "on", from: at("2026-10-30", "18:00") }),
        NOW,
      ),
    ).toEqual({ from: day(30), to: day(31) });
    // The day itself is left out
    expect(
      dateRange(custom({ operator: "after", from: at("2026-10-30") }), NOW),
    ).toEqual({ from: day(31) });
    expect(
      dateRange(custom({ operator: "before", from: at("2026-10-30") }), NOW),
    ).toEqual({ to: day(30) });
    expect(
      dateRange(custom({ from: at("2026-10-20"), to: at("2026-10-10") }), NOW),
    ).toEqual({ from: day(10), to: day(21) });
  });

  it("goes to the minute with a time", () => {
    expect(
      dateRange(
        custom({ operator: "after", from: at("2026-10-30", "18:30") }),
        NOW,
      ),
    ).toEqual({ from: day(30, 18, 30) });
    expect(
      dateRange(
        custom({ operator: "before", from: at("2026-10-30", "18:30") }),
        NOW,
      ),
    ).toEqual({ to: day(30, 18, 30) });
    // Both ends' minutes in, in either order, with a whole day for an end
    // without a time
    expect(
      dateRange(
        custom({ from: at("2026-10-30", "22:00"), to: at("2026-10-29") }),
        NOW,
      ),
    ).toEqual({ from: day(29), to: day(30, 22, 1) });
  });

  it("keeps everything until the days are picked", () => {
    expect(dateRange(custom({ operator: "on" }), NOW)).toBeNull();
    expect(dateRange(custom({ from: at("2026-10-10") }), NOW)).toBeNull();
  });
});

describe("periodText", () => {
  it("names the preset or the custom dates, with their times", () => {
    expect(periodText({ ...custom({}), preset: "all" }, "en", NOW)).toBe(
      "All time",
    );
    expect(periodText({ ...custom({}), preset: "week" }, "en", NOW)).toBe(
      "Last 7 days",
    );
    // Not picked yet
    expect(periodText(custom({ operator: "after" }), "en", NOW)).toBe(
      "All time",
    );
    expect(
      periodText(custom({ operator: "on", from: at("2026-10-30") }), "en", NOW),
    ).toBe("On Oct 30, 2026");
    expect(
      periodText(
        custom({ from: at("2026-10-20", "18:00"), to: at("2026-10-01") }),
        "en",
        NOW,
      ),
    ).toMatch(/^Oct 1, 2026 to Oct 20, 2026, 6:00\sPM$/);
    expect(
      periodText(
        custom({ operator: "before", from: at("2026-10-30") }),
        "es-419",
        NOW,
      ),
    ).toBe("Antes del 30 oct 2026");
  });
});

describe("allTime", () => {
  const kick = { amount: 40, gifts: 2, giftSubs: 3 };
  const lives = [
    // An older LIVE, saved without its platforms: TikTok's
    liveSummary(day(30, 20), { coins: 100, gifts: 10, endedAt: day(30, 22) }),
    liveSummary(day(29, 20), {
      coins: 25,
      gifts: 5,
      platforms: { tiktok: { amount: 25, gifts: 3, giftSubs: 0 }, kick },
      endedAt: day(29, 21),
    }),
  ];

  it("adds up each platform's part of every LIVE, and their length", () => {
    expect(allTime(lives)).toEqual({
      parts: {
        tiktok: { amount: 125, gifts: 13, giftSubs: 0 },
        kick,
      },
      length: 3 * HOUR,
    });
  });

  it("takes the time in the dates, and the parts of the LIVEs all in them", () => {
    // From 8:30 PM on the 29th: half an hour of one LIVE, all of the other
    expect(allTime(lives, { from: day(29, 20, 30) })).toEqual({
      parts: { tiktok: { amount: 100, gifts: 10, giftSubs: 0 } },
      length: 2 * HOUR + HOUR / 2,
    });
  });

  it("is empty without LIVEs", () => {
    expect(allTime([])).toEqual({ parts: {}, length: 0 });
  });
});

describe("historyPlatforms and statsTabs", () => {
  const part = { amount: 1, gifts: 1, giftSubs: 0 };

  it("gives the platforms the LIVEs were on in PLATFORMS order, an older one as TikTok's", () => {
    const platforms = historyPlatforms([
      liveSummary(2, { platforms: { kick: part, twitch: part } }),
      liveSummary(1, { coins: 5 }),
    ]);

    expect(platforms).toEqual(["tiktok", "twitch", "kick"]);
    expect(statsTabs(platforms)).toEqual(["tiktok", "twitch", "kick", "all"]);
  });

  it("gives one platform its tab alone, and TikTok's without LIVEs", () => {
    const youtube = [liveSummary(1, { platforms: { youtube: part } })];

    expect(statsTabs(historyPlatforms(youtube))).toEqual(["youtube"]);
    expect(historyPlatforms([])).toEqual(["tiktok"]);
  });
});

describe("liveValue", () => {
  it("gives a LIVE's money on its platform's tab, 0 off it, and its gifts on All", () => {
    const live = liveSummary(1, {
      gifts: 7,
      platforms: { twitch: { amount: 2500, gifts: 0, giftSubs: 4 } },
    });

    expect(liveValue(live, "twitch")).toBe(2500);
    expect(liveValue(live, "kick")).toBe(0);
    expect(liveValue(live, "all")).toBe(7);
  });
});

describe("readout", () => {
  const parts = {
    tiktok: { amount: 900, gifts: 30, giftSubs: 0 },
    twitch: { amount: 2500, gifts: 0, giftSubs: 4 },
    youtube: { amount: 57.4, gifts: 2, giftSubs: 1 },
    kick: { amount: 300, gifts: 5, giftSubs: 2 },
  };

  it("gives a platform its money, then its gifts and gifted subs where it sends them", () => {
    expect(readout("tiktok", [], parts)).toEqual([
      { label: "coinStats.stats.coins", value: 900, currency: "coins" },
      { label: "coinStats.stats.gifts", value: 30 },
    ]);
    expect(readout("twitch", [], parts)).toEqual([
      { label: "coinStats.stats.bits", value: 2500, currency: "bits" },
      { label: "coinStats.stats.giftSubs", value: 4 },
    ]);
    expect(readout("youtube", [], parts)).toEqual([
      { label: "coinStats.stats.superChats", value: 57.4, currency: "usd" },
      { label: "coinStats.stats.gifts", value: 2 },
      { label: "coinStats.stats.giftSubs", value: 1 },
    ]);
    // Kicks, never gifts
    expect(readout("kick", [], {})).toEqual([
      { label: "coinStats.stats.kicks", value: 0, currency: "kicks" },
      { label: "coinStats.stats.giftSubs", value: 0 },
    ]);
  });

  it("gives All each currency on its own, every gift and every gifted sub", () => {
    expect(
      readout("all", ["tiktok", "twitch", "youtube", "kick"], parts),
    ).toEqual([
      { label: "coinStats.stats.coins", value: 900, currency: "coins" },
      { label: "coinStats.stats.bits", value: 2500, currency: "bits" },
      { label: "coinStats.stats.superChats", value: 57.4, currency: "usd" },
      { label: "coinStats.stats.kicks", value: 300, currency: "kicks" },
      { label: "coinStats.stats.gifts", value: 37 },
      { label: "coinStats.stats.giftSubs", value: 7 },
    ]);
    // TikTok sends no gifted subs
    expect(readout("all", ["tiktok"], parts).at(-1)?.label).toBe(
      "coinStats.stats.gifts",
    );
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
