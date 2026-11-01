import { describe, expect, it } from "vitest";
import { allInRange, inRange } from "./history";

// A LIVE from 8:00 to 10:00, in minutes
const live = { startedAt: 8 * 60, endedAt: 10 * 60 };

describe("inRange", () => {
  it("takes a LIVE that starts in the dates or runs into them", () => {
    expect(inRange(live, {})).toBe(true);
    expect(inRange(live, { from: 7 * 60, to: 11 * 60 })).toBe(true);
    // It runs into them, or starts in them
    expect(inRange(live, { from: 9 * 60 })).toBe(true);
    expect(inRange(live, { to: 9 * 60 })).toBe(true);
    // From included, to left out
    expect(inRange(live, { to: 8 * 60 })).toBe(false);
    expect(inRange(live, { from: 10 * 60 })).toBe(false);
  });

  it("takes a LIVE that lasted no time at the dates' start", () => {
    const instant = { startedAt: 8 * 60, endedAt: 8 * 60 };
    expect(inRange(instant, { from: 8 * 60, to: 9 * 60 })).toBe(true);
    expect(inRange(instant, { from: 7 * 60, to: 8 * 60 })).toBe(false);
  });
});

describe("allInRange", () => {
  it("takes a LIVE only when all of it is in the dates", () => {
    expect(allInRange(live, {})).toBe(true);
    expect(allInRange(live, { from: 8 * 60, to: 10 * 60 })).toBe(true);
    expect(allInRange(live, { from: 9 * 60 })).toBe(false);
    expect(allInRange(live, { to: 9 * 60 })).toBe(false);
  });
});
