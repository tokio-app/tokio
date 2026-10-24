import { GameActionSchema, GameStepSchema } from "@/common/schemas";
import { TOKIO_EVENTS } from "@/common/types";
import { describe, expect, it } from "vitest";
import {
  connectCommand,
  createAction,
  createStep,
  ITEMS,
  MOBS,
  STEP_KINDS,
  statusText,
  stepText,
  withText,
} from "./helper";

describe("Games helper", () => {
  it("creates a follow action that spawns a zombie", () => {
    const action = createAction();

    expect(action.trigger.type).toBe(TOKIO_EVENTS.FOLLOW);
    expect(action.steps).toEqual([
      { type: "spawn", mob: "zombie", amount: 1, name: "" },
    ]);
    expect(GameActionSchema.parse(action)).toEqual(action);
    expect(createAction().id).not.toBe(action.id);
  });

  it("creates a valid step of every kind", () => {
    for (const { value } of STEP_KINDS) {
      const step = createStep(value);
      expect(step.type).toBe(value);
      expect(GameStepSchema.parse(step)).toEqual(step);
    }
  });

  it("lists mobs and items once each, by the game's ids", () => {
    for (const list of [MOBS, ITEMS]) {
      const ids = list.map((option) => option.value);
      expect(new Set(ids).size).toBe(ids.length);
      ids.forEach((id) => expect(id).toMatch(/^[a-z0-9_]+$/));
    }
  });

  it("reads and writes the text of steps that have one", () => {
    const spawn = createStep("spawn");
    const command = createStep("command");
    const weather = createStep("weather");

    expect(stepText(withText(spawn, "{username}"))).toBe("{username}");
    expect(stepText(withText(command, "say hi"))).toBe("say hi");
    expect(stepText(weather)).toBeNull();
    expect(withText(weather, "x")).toBe(weather);
  });

  it("says each connection status", () => {
    expect(statusText({ state: "off" })).toBe("Off");
    expect(statusText({ state: "waiting" })).toBe("Waiting for Minecraft");
    expect(statusText({ state: "connected" })).toBe("Connected");
    expect(statusText({ state: "error", error: "Port 37892 is in use." })).toBe(
      "Port 37892 is in use.",
    );
  });

  it("writes the chat's connect command", () => {
    expect(connectCommand("localhost")).toBe("/connect localhost:37892");
  });
});
