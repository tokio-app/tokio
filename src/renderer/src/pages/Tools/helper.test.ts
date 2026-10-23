import { describe, expect, it } from "vitest";
import { timerStatusText } from "./helper";

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
