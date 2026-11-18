import { describe, expect, it } from "vitest";
import { formatDuration, formatSeconds } from "./format";

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

describe("formatSeconds", () => {
  it.each([
    ["en", 30, undefined, "30 seconds"],
    ["en", 120, undefined, "2 minutes"],
    ["en", 60, 120, "1–2 minutes"],
    ["en", 10, 60, "10–60 seconds"],
    ["es-419", 10, 30, "10-30 segundos"],
    ["es-419", 60, 120, "1-2 minutos"],
  ])("in %s, %i seconds up to %s read %s", (language, seconds, max, text) => {
    expect(formatSeconds(language, seconds, max)).toBe(text);
  });
});
