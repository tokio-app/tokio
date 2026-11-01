import { describe, expect, it } from "vitest";
import {
  fontFamily,
  formatDate,
  formatDuration,
  formatList,
  formatStat,
  parseList,
} from "./format";

describe("parseList", () => {
  it("trims the items and drops empty ones", () => {
    expect(parseList(" brb, lol ,, gg ,")).toEqual(["brb", "lol", "gg"]);
    expect(parseList("")).toEqual([]);
    expect(parseList(" , ")).toEqual([]);
  });

  it("reads back what formatList writes", () => {
    const items = ["one", "two words", "three"];
    expect(formatList(items)).toBe("one, two words, three");
    expect(parseList(formatList(items))).toEqual(items);
  });
});

describe("formatStat", () => {
  it("gives a short text and the exact number", () => {
    expect(formatStat(1234, "en")).toEqual({ short: "1.2K", full: "1,234" });
    expect(formatStat(1_550_000, "en")).toEqual({
      short: "1.6M",
      full: "1,550,000",
    });
    // Latin American Spanish, with a no-break space before the K
    expect(formatStat(1234, "es-419")).toEqual({
      short: expect.stringMatching(/^1\.2\sK$/),
      full: "1,234",
    });
  });

  it("leaves small numbers as they are", () => {
    expect(formatStat(0, "en")).toEqual({ short: "0", full: "0" });
    expect(formatStat(999, "en")).toEqual({ short: "999", full: "999" });
  });
});

describe("formatDate", () => {
  // Local time, so the test passes in any time zone
  const night = new Date(2026, 9, 31, 20, 14).getTime();

  it("writes each style as the language does", () => {
    expect(formatDate(night, "en", "long")).toBe("Saturday, October 31, 2026");
    expect(formatDate(night, "en", "short")).toBe("Oct 31, 2026");
    // Intl puts a narrow no-break space before PM
    expect(formatDate(night, "en", "time")).toMatch(/^8:14\sPM$/);
    expect(formatDate(night, "en", "dateTime")).toMatch(
      /^Saturday, October 31, 2026 at 8:14\sPM$/,
    );
    expect(formatDate(night, "es-419", "long")).toBe(
      "sábado, 31 de octubre de 2026",
    );
    expect(formatDate(night, "es-419", "short")).toBe("31 oct 2026");
  });

  it("keeps each language's formats apart", () => {
    expect(formatDate(night, "en", "long")).toMatch(/^Saturday/);
    expect(formatDate(night, "es-419", "long")).toMatch(/^sábado/);
    expect(formatDate(night, "en", "long")).toMatch(/^Saturday/);
  });
});

describe("formatDuration", () => {
  it("gives hours, minutes and seconds", () => {
    expect(formatDuration(0)).toBe("00:00:00");
    expect(formatDuration(65_999)).toBe("00:01:05");
    expect(formatDuration((3 * 3600 + 2 * 60 + 1) * 1000)).toBe("03:02:01");
  });

  it("keeps counting hours past a day", () => {
    expect(formatDuration(25 * 3600 * 1000)).toBe("25:00:00");
  });

  // The renderer's clock can be a little behind main's
  it("never goes below zero", () => {
    expect(formatDuration(-1500)).toBe("00:00:00");
  });
});

describe("fontFamily", () => {
  it("falls back to the app's font", () => {
    expect(fontFamily(" Comic Sans MS ")).toBe(
      '"Comic Sans MS", "Archivo Variable", sans-serif',
    );
  });

  it("gives nothing for an empty name", () => {
    expect(fontFamily("")).toBeUndefined();
    expect(fontFamily("   ")).toBeUndefined();
  });

  it("keeps quotes and semicolons inside one quoted name", () => {
    expect(fontFamily('Evil"; color: red; x: "')).toBe(
      '"Evil\\"; color: red; x: \\"", "Archivo Variable", sans-serif',
    );
  });
});
