import type { AlertAudio } from "@/services/alerts";
import { describe, expect, it, vi } from "vitest";
import { ControlsService } from "./index";

const audio = (id: string): AlertAudio => ({
  id,
  volume: 1,
  channel: "alert",
  maxQueueLength: 10,
});

describe("ControlsService", () => {
  it("starts playing, with nothing to replay", () => {
    const controls = new ControlsService();

    expect(controls.isPaused()).toBe(false);
    expect(controls.lastAlerts()).toEqual([]);
  });

  it("tells its listeners when the pause changes, and only then", () => {
    const controls = new ControlsService();
    const listener = vi.fn();
    controls.onChange(listener);

    expect(controls.setPaused(true)).toBe(true);
    expect(controls.setPaused(true)).toBe(false);
    expect(controls.isPaused()).toBe(true);
    expect(controls.setPaused(false)).toBe(true);

    expect(listener.mock.calls).toEqual([
      [{ paused: true }],
      [{ paused: false }],
    ]);
  });

  it("keeps the last group of alerts, with what joins it later", () => {
    const controls = new ControlsService();
    const first = [audio("a")];
    const last = [audio("b")];

    controls.recordAlerts(first);
    controls.recordAlerts(last);
    last.push(audio("spoken"));

    expect(controls.lastAlerts()).toEqual([audio("b"), audio("spoken")]);
  });
});
