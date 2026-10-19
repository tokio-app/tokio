import { createAlert } from "@/pages/Alerts/helper";
import { describe, expect, it } from "vitest";
import { alertsStatus, formatDuration, serverStatus, statText } from "./helper";

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

describe("statText", () => {
  it("gives the short number with the exact one for the title", () => {
    expect(statText(1234, true)).toEqual({ text: "1.2K", title: "1,234" });
  });

  it("gives dashes while offline", () => {
    expect(statText(1234, false)).toEqual({ text: "--", title: undefined });
  });
});

describe("feature status", () => {
  it("counts one alert or overlay in the singular", () => {
    expect(alertsStatus([createAlert()])).toBe("1 of 1 alert on");
    expect(serverStatus(true, 1)).toBe("Running · 1 overlay");
  });
});
