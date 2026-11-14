import { describe, expect, it } from "vitest";
import { formatSeconds } from "./format";

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
