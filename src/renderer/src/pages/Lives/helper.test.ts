import { liveSummary } from "@test/fixtures";
import { describe, expect, it } from "vitest";
import {
  allTime,
  capitalize,
  DateFilter,
  dateRange,
  inRange,
  keepSelection,
  periodText,
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

  it("checks a LIVE by when it started", () => {
    const evening = liveSummary(day(30, 20));
    expect(inRange(evening, { from: day(30), to: day(31) })).toBe(true);
    expect(inRange(evening, { to: day(30) })).toBe(false);
    expect(inRange(evening, {})).toBe(true);
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
