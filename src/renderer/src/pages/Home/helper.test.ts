import { createAlert } from "@/pages/Alerts/helper";
import { describe, expect, it } from "vitest";
import { alertsStatus, serverStatus, statText } from "./helper";

describe("statText", () => {
  it("gives the short number with the exact one for the title", () => {
    expect(statText(1234, true, "en")).toEqual({
      text: "1.2K",
      title: "1,234",
    });
  });

  it("gives dashes while offline", () => {
    expect(statText(1234, false, "en")).toEqual({
      text: "--",
      title: undefined,
    });
  });
});

describe("feature status", () => {
  it("counts one alert or overlay in the singular", () => {
    expect(alertsStatus([createAlert()], "en")).toBe("1 of 1 alert on");
    expect(serverStatus(true, 1, "en")).toBe("Running · 1 overlay");
  });
});
