import {
  GameActionSchema,
  GameStep,
  GameStepSchema,
  MINECRAFT_EDITIONS,
} from "@/common/schemas";
import { TOKIO_EVENTS } from "@/common/types";
import { describe, expect, it } from "vitest";
import {
  connectCommand,
  createAction,
  createStep,
  HAZARDS,
  ITEMS,
  MOBS,
  MORPH_MOBS,
  STEP_KINDS,
  statusText,
  stepText,
  testSummary,
  withEdition,
  withText,
} from "./helper";

const spawn = (mob: string): GameStep => ({
  type: "spawn",
  mob,
  amount: 2,
  name: "{username}",
});
const give = (item: string): GameStep => ({ type: "give", item, amount: 3 });

describe("Games helper", () => {
  it("creates a follow action that spawns a zombie", () => {
    const action = createAction("bedrock");

    expect(action.edition).toBe("bedrock");
    expect(action.trigger.type).toBe(TOKIO_EVENTS.FOLLOW);
    expect(action.steps).toEqual([
      { type: "spawn", mob: "zombie", amount: 1, name: "" },
    ]);
    expect(GameActionSchema.parse(action)).toEqual(action);
    expect(createAction("bedrock").id).not.toBe(action.id);
    expect(createAction("java").edition).toBe("java");
  });

  it("moves an action's mobs and items to another edition", () => {
    const action = {
      ...createAction("bedrock"),
      steps: [
        spawn("creeper"),
        give("totem_of_undying"),
        { type: "weather", weather: "rain" } as const,
      ],
    };

    const java = withEdition(action, "java");

    expect(java).toEqual({ ...action, edition: "java" });
    expect(withEdition(java, "bedrock")).toEqual(action);
    expect(withEdition(action, "bedrock")).toBe(action);
  });

  it("renames the mobs and items Java calls differently, both ways", () => {
    const action = {
      ...createAction("bedrock"),
      steps: [spawn("evocation_illager"), spawn("zombie_pigman"), give("web")],
    };

    const java = withEdition(action, "java");

    expect(java.steps).toEqual([
      spawn("evoker"),
      spawn("zombified_piglin"),
      give("cobweb"),
    ]);
    expect(withEdition(java, "bedrock").steps).toEqual(action.steps);
  });

  it("finds the other edition's id by the game's English name", () => {
    const action = {
      ...createAction("bedrock"),
      steps: [
        spawn("xp_orb"),
        spawn("ender_crystal"),
        give("brick_block"),
        give("zombie_pigman_spawn_egg"),
      ],
    };

    const java = withEdition(action, "java");

    expect(java.steps).toEqual([
      spawn("experience_orb"),
      spawn("end_crystal"),
      give("bricks"),
      give("zombified_piglin_spawn_egg"),
    ]);
    expect(withEdition(java, "bedrock").steps).toEqual(action.steps);
  });

  it("falls back to a zombie and a diamond for what the edition lacks", () => {
    const action = {
      ...createAction("bedrock"),
      steps: [spawn("not_a_mob"), give("not_an_item")],
    };

    expect(withEdition(action, "java").steps).toEqual([
      spawn("zombie"),
      give("diamond"),
    ]);
  });

  it("keeps Java's hazards and drops its morphs on Bedrock", () => {
    const hazard = (type: string): GameStep =>
      GameStepSchema.parse({ type: "hazard", hazard: type, amount: 3 });
    const action = {
      ...createAction("java"),
      steps: [
        hazard("meteor"),
        GameStepSchema.parse({ type: "morph", mob: "creeper" }),
        hazard("laser"),
        hazard("super_laser"),
        { type: "unmorph" } as const,
        hazard("super_duper_laser"),
        hazard("anvil"),
      ],
    };

    expect(withEdition(action, "bedrock").steps).toEqual([
      hazard("tnt"),
      hazard("lightning"),
      hazard("lightning"),
      hazard("lightning"),
      hazard("anvil"),
    ]);
    // Back on Java nothing new changes
    const back = withEdition(withEdition(action, "bedrock"), "java");
    expect(back.steps.map((step) => step.type)).toEqual(
      Array(5).fill("hazard"),
    );
  });

  it("offers the Tokio mod's steps and hazards only on Java", () => {
    const javaOnly = ["morph", "unmorph"];
    const modHazards = ["meteor", "laser", "super_laser", "super_duper_laser"];
    const kinds = (edition: "bedrock" | "java") =>
      STEP_KINDS[edition].map((o) => o.value);
    const hazards = (edition: "bedrock" | "java") =>
      HAZARDS[edition].map((o) => o.value);

    expect(kinds("java").slice(0, 4)).toEqual([
      "spawn",
      "morph",
      "unmorph",
      "give",
    ]);
    expect(kinds("bedrock")).toEqual(
      kinds("java").filter((kind) => !javaOnly.includes(kind)),
    );
    expect(hazards("java")).toEqual(expect.arrayContaining(modHazards));
    expect(hazards("bedrock")).toEqual(
      hazards("java").filter((h) => !modHazards.includes(h)),
    );
  });

  it("turns the player into living mobs only", () => {
    const ids = MORPH_MOBS.map((o) => o.value);
    for (const id of [
      "tnt",
      "lightning_bolt",
      "end_crystal",
      "experience_orb",
      "firework_rocket",
    ]) {
      expect(MOBS.java.map((o) => o.value)).toContain(id);
      expect(ids).not.toContain(id);
    }
    expect(ids).toContain("zombie");
    expect(ids.length).toBe(MOBS.java.length - 5);
  });

  it("creates a valid step of every kind", () => {
    for (const { value } of STEP_KINDS.java) {
      const step = createStep(value);
      expect(step.type).toBe(value);
      expect(GameStepSchema.parse(step)).toEqual(step);
    }
  });

  it("lists each edition's mobs and items once each, by the game's ids", () => {
    for (const edition of MINECRAFT_EDITIONS) {
      for (const list of [MOBS[edition], ITEMS[edition]]) {
        const ids = list.map((option) => option.value);
        expect(ids.length).toBeGreaterThan(0);
        expect(new Set(ids).size).toBe(ids.length);
        ids.forEach((id) => expect(id).toMatch(/^[a-z0-9_]+$/));
      }
    }
    expect(MOBS.bedrock.map((o) => o.value)).toContain("evocation_illager");
    expect(MOBS.java.map((o) => o.value)).toContain("creeper");
    expect(ITEMS.java.map((o) => o.value)).toContain("totem_of_undying");
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
    expect(statusText({ state: "off" }, "en")).toBe("Off");
    expect(statusText({ state: "waiting" }, "en")).toBe(
      "Waiting for Minecraft",
    );
    expect(statusText({ state: "connected" }, "en")).toBe("Connected");
    expect(statusText({ state: "connected", edition: "bedrock" }, "en")).toBe(
      "Connected to Bedrock Edition",
    );
    expect(statusText({ state: "connected", edition: "java" }, "en")).toBe(
      "Connected to Java Edition",
    );
    expect(
      statusText({ state: "error", error: "Port 37892 is in use." }, "en"),
    ).toBe("Port 37892 is in use.");
  });

  it("writes each edition's connect command", () => {
    expect(connectCommand("localhost", "bedrock")).toBe(
      "/connect localhost:37892",
    );
    expect(connectCommand("10.0.0.5", "java")).toBe(
      "/tokio connect 10.0.0.5:37892",
    );
  });

  it("sums up a test by the commands that failed", () => {
    const result = (ok: boolean) => ({ command: "say hi", ok, message: "" });

    expect(testSummary([result(true)], "en")).toBe("1 command ran");
    expect(testSummary([result(true), result(false)], "en")).toBe(
      "1 of 2 commands failed",
    );
    expect(testSummary([result(false), result(false)], "en")).toBe(
      "2 commands failed",
    );
  });
});
