import { describe, expect, it } from "vitest";
import { shortDuration, timerStatusText } from "./helper";

describe("shortDuration", () => {
  it("gives seconds, then minutes, then hours", () => {
    expect(shortDuration(5_000)).toBe("5s");
    expect(shortDuration(90_000)).toBe("1:30");
    expect(shortDuration(3_600_000)).toBe("1:00:00");
    expect(shortDuration(3_725_000)).toBe("1:02:05");
  });

  it("rounds to the second and drops the sign", () => {
    expect(shortDuration(59_600)).toBe("1:00");
    expect(shortDuration(-300_000)).toBe("5:00");
  });
});

describe("timerStatusText", () => {
  it("says when the time is up", () => {
    expect(timerStatusText({ status: "stopped", remaining: 0 })).toBe(
      "Time's up",
    );
    expect(timerStatusText({ status: "stopped", remaining: 1 })).toBe(
      "Stopped",
    );
    expect(timerStatusText({ status: "idle", remaining: 0 })).toBe("Ready");
  });
});
