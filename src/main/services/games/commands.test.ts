import { GAME_HELPS, GameStep, GameStepSchema } from "@/common/schemas";
import { describe, expect, it } from "vitest";
import { commandValue, gameCommands, launchPlan } from "./commands";

const step = (input: Record<string, unknown>): GameStep =>
  GameStepSchema.parse(input);
const none = (text: string) => text;

describe("commandValue", () => {
  it("drops what could break out of a command", () => {
    expect(commandValue('Aku"} ,Passengers:[{id:"tnt"}]')).toBe(
      "Aku ,Passengers:id:tnt",
    );
    expect(commandValue("@e[type=player] 'x' \\ §cRed")).toBe(
      "etype=player x cRed",
    );
  });

  it("drops control characters and collapses whitespace", () => {
    expect(commandValue("  a\n\tb\u0000c\u007f   d  ")).toBe("a bc d");
  });

  it("caps the text at 100 characters", () => {
    expect(commandValue("x".repeat(150))).toHaveLength(100);
  });
});

describe("gameCommands in Bedrock", () => {
  const run = (input: Record<string, unknown>, fill = none) =>
    gameCommands(step(input), fill, "bedrock");

  it("spawns where the player stands, named and repeated", () => {
    expect(run({ type: "spawn", mob: "zombie" })).toEqual([
      "summon zombie ~ ~ ~",
    ]);
    expect(
      run(
        { type: "spawn", mob: "chicken", amount: 2, name: "{username}" },
        () => 'Aku"} @e',
      ),
    ).toEqual(['summon chicken "Aku e" ~ ~ ~', 'summon chicken "Aku e" ~ ~ ~']);
  });

  it("escapes the whole name, not only its variables", () => {
    expect(run({ type: "spawn", mob: "pig", name: 'A "pig"' })).toEqual([
      'summon pig "A pig" ~ ~ ~',
    ]);
  });

  it("gives, sets the weather and the time", () => {
    expect(run({ type: "give", item: "diamond", amount: 5 })).toEqual([
      "give @p diamond 5",
    ]);
    expect(run({ type: "weather", weather: "thunder" })).toEqual([
      "weather thunder",
    ]);
    expect(run({ type: "time", time: "midnight" })).toEqual([
      "time set midnight",
    ]);
  });

  it("runs nothing for ids the game can't have", () => {
    expect(run({ type: "spawn", mob: "zombie ~ ~ ~ {}" })).toEqual([]);
    expect(run({ type: "give", item: "minecraft:diamond" })).toEqual([]);
  });

  it("fills a command, without its leading slash", () => {
    const fill = (text: string) => text.replace("{username}", "Aku");
    expect(
      run({ type: "command", command: " /say Hi {username}" }, fill),
    ).toEqual(["say Hi Aku"]);
    expect(run({ type: "command", command: "  " }, fill)).toEqual([]);
  });
});

describe("gameCommands in Java Edition", () => {
  const run = (input: Record<string, unknown>, fill = none) =>
    gameCommands(step(input), fill, "java");

  it("spawns where the player stands, named and repeated", () => {
    expect(run({ type: "spawn", mob: "zombie" })).toEqual([
      "summon minecraft:zombie ~ ~ ~",
    ]);
    expect(
      run(
        { type: "spawn", mob: "chicken", amount: 2, name: "{username}" },
        () => "Aku",
      ),
    ).toEqual([
      'summon minecraft:chicken ~ ~ ~ {CustomName:"Aku"}',
      'summon minecraft:chicken ~ ~ ~ {CustomName:"Aku"}',
    ]);
  });

  it("keeps a nickname inside the name's string", () => {
    expect(
      run(
        { type: "spawn", mob: "pig", name: "{username}" },
        () => String.raw`Aku"}, Passengers:[{id:"tnt"}] \"{`,
      ),
    ).toEqual([
      'summon minecraft:pig ~ ~ ~ {CustomName:"Aku, Passengers:id:tnt"}',
    ]);
  });

  it("gives to the player, sets the weather and the time", () => {
    expect(run({ type: "give", item: "diamond", amount: 5 })).toEqual([
      "give @s minecraft:diamond 5",
    ]);
    expect(run({ type: "weather", weather: "thunder" })).toEqual([
      "weather thunder",
    ]);
    expect(run({ type: "time", time: "midnight" })).toEqual([
      "time set midnight",
    ]);
  });

  it("runs nothing for ids the game can't have", () => {
    expect(run({ type: "spawn", mob: "zombie ~ ~ ~ {}" })).toEqual([]);
    expect(run({ type: "give", item: "minecraft:diamond" })).toEqual([]);
  });

  it("fills a command, without its leading slash", () => {
    const fill = (text: string) => text.replace("{username}", "Aku");
    expect(
      run({ type: "command", command: "/say Hi {username}" }, fill),
    ).toEqual(["say Hi Aku"]);
  });
});

describe("gameCommands for hazards", () => {
  const run = (
    hazard: string,
    edition: "bedrock" | "java",
    more: Record<string, unknown> = {},
  ) => gameCommands(step({ type: "hazard", hazard, ...more }), none, edition);

  it("runs each hazard in each edition's syntax", () => {
    const both = (hazard: string) => [
      ...run(hazard, "bedrock"),
      ...run(hazard, "java"),
    ];
    expect(both("lightning")).toEqual([
      "summon lightning_bolt ~ ~ ~",
      "summon minecraft:lightning_bolt ~ ~ ~",
    ]);
    expect(both("charged_creeper")).toEqual([
      "summon creeper ~ ~ ~ 0 0 minecraft:become_charged",
      "summon minecraft:creeper ~ ~ ~ {powered:1b}",
    ]);
    expect(both("evoker_fangs")).toEqual([
      "summon evocation_fang ~ ~ ~",
      "summon minecraft:evoker_fangs ~ ~ ~",
    ]);
    expect(both("anvil")).toEqual([
      "setblock ~ ~20 ~ anvil keep",
      "setblock ~ ~20 ~ minecraft:anvil keep",
    ]);
    expect(both("harming")).toEqual([
      "effect @p instant_damage 1 1",
      "effect give @s minecraft:instant_damage 1 1",
    ]);
    expect(both("freeze")).toEqual([
      "effect @p slowness 10 255",
      "effect give @s minecraft:slowness 10 255",
    ]);
    expect(both("lights_out")).toEqual([
      "effect @p darkness 10 0",
      "effect give @s minecraft:darkness 10 0",
    ]);
    expect(both("dizzy")).toEqual([
      "effect @p nausea 10 0",
      "effect give @s minecraft:nausea 10 0",
    ]);
    expect(both("turn_around")).toEqual([
      "teleport @p ~ ~ ~ ~180 ~",
      "teleport @s ~ ~ ~ ~180 ~",
    ]);
    expect(both("random_teleport")).toEqual([
      "spreadplayers ~ ~ 0 1000 @p",
      "spreadplayers ~ ~ 0 1000 false @s",
    ]);
  });

  it("lasts the duration set, and teleports within the distance", () => {
    expect(run("freeze", "java", { duration: 3 })).toEqual([
      "effect give @s minecraft:slowness 3 255",
    ]);
    expect(run("lights_out", "bedrock", { duration: 30 })).toEqual([
      "effect @p darkness 30 0",
    ]);
    expect(run("random_teleport", "java", { distance: 5000 })).toEqual([
      "spreadplayers ~ ~ 0 5000 false @s",
    ]);
  });

  it("drops TNT with its fuse, which Bedrock has only two of", () => {
    expect(run("tnt", "java", { fuse: 1.5 })).toEqual([
      "summon minecraft:tnt ~ ~10 ~ {fuse:30}",
    ]);
    expect(run("tnt", "bedrock")).toEqual(["summon tnt ~ ~10 ~"]);
    expect(run("tnt", "bedrock", { fuse: 2 })).toEqual([
      "summon tnt ~ ~10 ~ 0 0 from_explosion",
    ]);
    const ring = run("tnt_ring", "java", { fuse: 0 });
    expect(ring).toHaveLength(8);
    expect(ring[0]).toBe("summon minecraft:tnt ~3 ~1 ~0 {fuse:0}");
  });

  it("launches as high and as fast as asked, then stops at the top", () => {
    const { level, stopMs } = launchPlan(50, 1);
    expect(run("launch", "java")).toEqual([
      `effect give @s minecraft:levitation 1 ${level - 1}`,
      { wait: stopMs },
      "teleport @s ~ ~ ~",
    ]);
    // Stopped as the push ends
    expect(stopMs).toBe(1000);
    const slow = launchPlan(100, 3);
    expect(run("launch", "bedrock", { height: 100, seconds: 3 })).toEqual([
      `effect @p levitation 3 ${slow.level - 1}`,
      { wait: 3000 },
      "teleport @p ~ ~ ~",
    ]);
    // Higher takes more, slower less
    expect(launchPlan(100, 1).level).toBeGreaterThan(level);
    expect(slow.level).toBeLessThan(launchPlan(100, 1).level);
    expect(launchPlan(5, 10).level).toBe(1);
  });

  it("climbs on its momentum where the strongest push falls short", () => {
    // 300 blocks in a second is past the strongest levitation's reach
    const { level, stopMs } = launchPlan(300, 1);
    expect(level).toBe(256);
    expect(stopMs).toBeGreaterThan(1000);
    expect(launchPlan(300, 2)).toMatchObject({ stopMs: 2000 });
  });

  it("gives the water bucket before the launch", () => {
    expect(run("launch_water", "bedrock")).toEqual([
      "give @p water_bucket 1",
      `effect @p levitation 1 ${launchPlan(50, 1).level - 1}`,
      { wait: 1000 },
      "teleport @p ~ ~ ~",
    ]);
    expect(run("launch_water", "java")[0]).toBe(
      "give @s minecraft:water_bucket 1",
    );
  });

  it("repeats only the hazards an amount counts", () => {
    expect(run("lightning", "java", { amount: 3 })).toHaveLength(3);
    expect(run("tnt", "java", { amount: 3 })).toHaveLength(1);
    expect(run("tnt_ring", "java", { amount: 3 })).toHaveLength(8);
    expect(run("launch_water", "bedrock", { amount: 3 })).toHaveLength(4);
  });
});

describe("gameCommands for helps", () => {
  const run = (
    help: string,
    edition: "bedrock" | "java",
    more: Record<string, unknown> = {},
  ) => gameCommands(step({ type: "help", help, ...more }), none, edition);

  it("puts netherite armor on, over what the player wears", () => {
    expect(run("netherite_armor", "bedrock")).toEqual([
      "replaceitem entity @p slot.armor.head 0 netherite_helmet",
      "replaceitem entity @p slot.armor.chest 0 netherite_chestplate",
      "replaceitem entity @p slot.armor.legs 0 netherite_leggings",
      "replaceitem entity @p slot.armor.feet 0 netherite_boots",
    ]);
    expect(run("netherite_armor", "java")).toEqual([
      "item replace entity @s armor.head with minecraft:netherite_helmet",
      "item replace entity @s armor.chest with minecraft:netherite_chestplate",
      "item replace entity @s armor.legs with minecraft:netherite_leggings",
      "item replace entity @s armor.feet with minecraft:netherite_boots",
    ]);
  });

  it("fills health and hunger", () => {
    expect(run("heal", "java")).toEqual([
      "effect give @s minecraft:instant_health 1 4",
      "effect give @s minecraft:saturation 1 19",
    ]);
    expect(run("heal", "bedrock")).toEqual([
      "effect @p instant_health 1 4",
      "effect @p saturation 1 19",
    ]);
  });

  it("puts an effect on for the duration set", () => {
    expect(run("regeneration", "bedrock")).toEqual([
      "effect @p regeneration 30 1",
    ]);
    expect(run("resistance", "java", { duration: 60 })).toEqual([
      "effect give @s minecraft:resistance 60 3",
    ]);
    expect(run("night_vision", "java", { duration: 600 })).toEqual([
      "effect give @s minecraft:night_vision 600 0",
    ]);
  });

  it("runs every help in both editions", () => {
    for (const help of GAME_HELPS) {
      expect(run(help, "bedrock").length).toBeGreaterThan(0);
      expect(run(help, "java").length).toBeGreaterThan(0);
    }
  });
});
