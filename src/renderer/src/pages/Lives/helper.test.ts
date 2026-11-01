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

// Local midnights, so the days read the same in any time zone
const day = (date: number) => new Date(2026, 9, date).getTime();

describe("dateRange", () => {
  const filter = (patch: Partial<DateFilter>): DateFilter => ({
    operator: "any",
    date: "",
    to: "",
    ...patch,
  });

  it("keeps the LIVEs that started on, after or before a day", () => {
    expect(dateRange(filter({ operator: "on", date: "2026-10-30" }))).toEqual({
      from: day(30),
      to: day(31),
    });
    // The day itself is left out
    expect(
      dateRange(filter({ operator: "after", date: "2026-10-30" })),
    ).toEqual({ from: day(31) });
    expect(
      dateRange(filter({ operator: "before", date: "2026-10-30" })),
    ).toEqual({ to: day(30) });
  });

  it("takes both days of a range, in either order", () => {
    const range = { from: day(10), to: day(21) };
    expect(
      dateRange(
        filter({ operator: "between", date: "2026-10-10", to: "2026-10-20" }),
      ),
    ).toEqual(range);
    expect(
      dateRange(
        filter({ operator: "between", date: "2026-10-20", to: "2026-10-10" }),
      ),
    ).toEqual(range);
  });

  it("keeps everything until the days are picked", () => {
    expect(dateRange(filter({}))).toBeNull();
    expect(dateRange(filter({ operator: "on" }))).toBeNull();
    expect(
      dateRange(filter({ operator: "between", date: "2026-10-10" })),
    ).toBeNull();
  });

  it("checks a LIVE by when it started", () => {
    const evening = liveSummary(day(30) + 20 * 3_600_000);
    expect(inRange(evening, { from: day(30), to: day(31) })).toBe(true);
    expect(inRange(evening, { to: day(30) })).toBe(false);
    expect(inRange(evening, {})).toBe(true);
  });
});

describe("periodText", () => {
  it("names the days the filter keeps, or All time", () => {
    expect(periodText({ operator: "any", date: "", to: "" }, "en")).toBe(
      "All time",
    );
    expect(periodText({ operator: "after", date: "", to: "" }, "en")).toBe(
      "All time",
    );
    expect(
      periodText({ operator: "on", date: "2026-10-30", to: "" }, "en"),
    ).toBe("On Oct 30, 2026");
    expect(
      periodText(
        { operator: "between", date: "2026-10-20", to: "2026-10-01" },
        "en",
      ),
    ).toBe("Oct 1, 2026 to Oct 20, 2026");
    expect(
      periodText({ operator: "before", date: "2026-10-30", to: "" }, "es-419"),
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
