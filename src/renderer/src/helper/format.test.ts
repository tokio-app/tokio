import { describe, expect, it } from "vitest";
import { formatList, formatStat, parseList } from "./format";

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
    expect(formatStat(1234)).toEqual({ short: "1.2K", full: "1,234" });
    expect(formatStat(1_550_000)).toEqual({ short: "1.6M", full: "1,550,000" });
  });

  it("leaves small numbers as they are", () => {
    expect(formatStat(0)).toEqual({ short: "0", full: "0" });
    expect(formatStat(999)).toEqual({ short: "999", full: "999" });
  });
});
