import { TimerState } from "@/common/types";
import { timerReply } from "@test/fixtures";
import { describe, expect, it } from "vitest";
import { timeLeft, timerStatusText } from "./helper";

describe("timerStatusText", () => {
  it("says when the time is up", () => {
    expect(timerStatusText({ status: "stopped", remaining: 0 }, "en")).toBe(
      "Time's up",
    );
    expect(timerStatusText({ status: "stopped", remaining: 1 }, "en")).toBe(
      "Stopped",
    );
    expect(timerStatusText({ status: "idle", remaining: 0 }, "en")).toBe(
      "Ready",
    );
  });
});

describe("timeLeft", () => {
  // A push that came at 1000ms
  const push = (state: TimerState) => ({
    data: { ...timerReply().data, state },
    at: 1000,
  });

  it("shows the starting time while idle", () => {
    expect(
      timeLeft(push({ status: "idle", remaining: 60_000 }), 90, 5000),
    ).toBe(90 * 60_000);
  });

  it("counts down from the push while running, down to 0", () => {
    const running = push({ status: "running", remaining: 10_000 });

    expect(timeLeft(running, 60, 1000)).toBe(10_000);
    expect(timeLeft(running, 60, 3500)).toBe(7_500);
    expect(timeLeft(running, 60, 20_000)).toBe(0);
    // A tick from before the push doesn't add time
    expect(timeLeft(running, 60, 500)).toBe(10_000);
  });

  it("holds the time left while paused or stopped", () => {
    expect(
      timeLeft(push({ status: "paused", remaining: 8_500 }), 60, 9000),
    ).toBe(8_500);
    expect(timeLeft(push({ status: "stopped", remaining: 0 }), 60, 9000)).toBe(
      0,
    );
  });
});
