import { createAlert } from "@/pages/Alerts/helper";
import { describe, expect, it } from "vitest";
import {
  alertsStatus,
  chartPoints,
  joinedText,
  nearestIndex,
  serverStatus,
} from "./helper";

describe("chartPoints", () => {
  it("spreads the points across, from 0 on the baseline to the peak on top", () => {
    expect(chartPoints([0, 20, 40])).toEqual([
      { x: 0, y: 100 },
      { x: 50, y: 50 },
      { x: 100, y: 0 },
    ]);
  });

  it("puts a lone point on the right edge", () => {
    expect(chartPoints([12])).toEqual([{ x: 100, y: 0 }]);
  });

  it("keeps a LIVE with no viewers on the baseline", () => {
    expect(chartPoints([0, 0])).toEqual([
      { x: 0, y: 100 },
      { x: 100, y: 100 },
    ]);
  });
});

describe("nearestIndex", () => {
  it("snaps to the nearest point", () => {
    expect(nearestIndex(0.2, 3)).toBe(0);
    expect(nearestIndex(0.3, 3)).toBe(1);
    expect(nearestIndex(0.9, 3)).toBe(2);
  });

  it("stays on the chart past its edges", () => {
    expect(nearestIndex(-0.5, 3)).toBe(0);
    expect(nearestIndex(1.5, 3)).toBe(2);
    expect(nearestIndex(0.7, 1)).toBe(0);
  });
});

describe("feature status", () => {
  it("counts one alert or overlay in the singular", () => {
    expect(alertsStatus([createAlert()], "en")).toBe("1 of 1 alert on");
    expect(serverStatus(true, 1, "en")).toBe("Running · 1 overlay");
  });
});

describe("joinedText", () => {
  const user = (name: string) => ({ handle: name, name, picture: "" });

  it("puts the verb in the number of viewers who joined", () => {
    expect(joinedText([user("kai")], 1, "es-419")).toBe("kai se unió");
    expect(joinedText([user("kai"), user("yui")], 2, "es-419")).toBe(
      "kai y yui se unieron",
    );
  });
});
