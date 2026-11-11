import { GAME_HELPS, GameStep, GameStepSchema } from "@/common/schemas";
import { describe, expect, it } from "vitest";
import {
  commandValue,
  gameCommands,
  launchPlan,
  SPAWN_GAP_MS,
} from "./commands";

const step = (input: Record<string, unknown>): GameStep =>
  GameStepSchema.parse(input);
const none = (text: string) => text;
// Between two mobs of a step
const gap = { wait: SPAWN_GAP_MS };

describe("commandValue", () => {
  it("drops what could break out of a command", () => {
    expect(commandValue('Aku"} ,Passengers:[{id:"tnt"}]')).toBe(
      "Aku ,Passengers:id:tnt",
    );
    expect(commandValue("@e[type=player] 'x' \\ §cRed")).toBe(
      "etype=player x cRed",
    );
  });

  it("drops *, which names every score holder", () => {
    expect(commandValue("[*]")).toBe("");
    expect(commandValue("@*")).toBe("");
    expect(commandValue("*")).toBe("");
  });

  it("drops control characters and collapses whitespace", () => {
    expect(commandValue("  a\n\tb\u0000c\u007f   d  ")).toBe("a bc d");
  });

  it("caps the text at 100 characters", () => {
    expect(commandValue("x".repeat(150))).toHaveLength(100);
  });

  it("never leaves half an emoji at the cap", () => {
    const value = commandValue(`${"x".repeat(99)}😀`);
    expect(value).toBe("x".repeat(99));
    expect(value).not.toMatch(/\p{Cs}/u);
  });
});

describe("gameCommands in Bedrock", () => {
  const run = (input: Record<string, unknown>, fill = none) =>
    gameCommands(step(input), fill, "bedrock");

  it("spawns where the player stands, named and repeated", () => {
    expect(run({ type: "spawn", mob: "cow" })).toEqual(["summon cow ~ ~ ~"]);
    expect(
      run(
        { type: "spawn", mob: "chicken", amount: 2, name: "{username}" },
        () => 'Aku"} @e',
      ),
    ).toEqual([
      'summon chicken "Aku e" ~ ~ ~',
      gap,
      'summon chicken "Aku e" ~ ~ ~',
    ]);
  });

  it("keeps mobs that burn in daylight out of the sun's fire, each as it comes", () => {
    const zombie = [
      "summon zombie ~ ~ ~",
      "effect @e[type=zombie,r=2,c=1] fire_resistance infinite 0 true",
    ];
    expect(run({ type: "spawn", mob: "zombie", amount: 2 })).toEqual([
      ...zombie,
      gap,
      ...zombie,
    ]);
  });

  it("spawns neutral hostiles angry", () => {
    expect(run({ type: "spawn", mob: "cave_spider", name: "Lucia" })).toEqual([
      'summon cave_spider ~ ~ ~ 0 0 minecraft:become_angry "Lucia"',
    ]);
    expect(run({ type: "spawn", mob: "zombie_pigman" })).toEqual([
      "summon zombie_pigman ~ ~ ~",
    ]);
  });

  it("spawns chicken jockeys as baby zombies given chickens", () => {
    const jockey = [
      'summon zombie ~ ~ ~ 0 0 minecraft:as_baby "Lucia"',
      "ride @e[type=zombie,r=2,c=1] summon_ride chicken no_ride_change minecraft:spawn_adult",
      "effect @e[type=zombie,r=2,c=1] fire_resistance infinite 0 true",
    ];
    expect(
      run({ type: "spawn", mob: "chicken_jockey", amount: 2, name: "Lucia" }),
    ).toEqual([...jockey, gap, ...jockey]);
    expect(run({ type: "spawn", mob: "chicken_jockey" })[0]).toBe(
      "summon zombie ~ ~ ~ 0 0 minecraft:as_baby",
    );
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
    // Bedrock's give takes no enchantments
    expect(
      run({ type: "give", item: "netherite_sword", enchanted: true }),
    ).toEqual(["give @p netherite_sword 1"]);
    // Replacing, the player's own go first, if they have any
    expect(
      run({ type: "give", item: "diamond", amount: 5, replace: true }),
    ).toEqual([{ mayFail: "clear @p diamond" }, "give @p diamond 5"]);
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

  it("keeps a nickname from naming every score holder", () => {
    const fill = (text: string) =>
      text.replace("{username}", commandValue("[*]"));
    const [command] = run(
      { type: "command", command: "scoreboard players add {username} gifts 1" },
      fill,
    );
    expect(command).not.toContain("*");
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
      gap,
      'summon minecraft:chicken ~ ~ ~ {CustomName:"Aku"}',
    ]);
  });

  it("leaves the sun and the anger to the Tokio mod", () => {
    expect(run({ type: "spawn", mob: "zombie" })).toEqual([
      "summon minecraft:zombie ~ ~ ~",
    ]);
    expect(run({ type: "spawn", mob: "cave_spider" })).toEqual([
      "summon minecraft:cave_spider ~ ~ ~",
    ]);
  });

  it("spawns chicken jockeys, the name on the baby zombie", () => {
    expect(run({ type: "spawn", mob: "chicken_jockey" })).toEqual([
      'summon minecraft:chicken ~ ~ ~ {Passengers:[{id:"minecraft:zombie",IsBaby:1b}]}',
    ]);
    expect(
      run(
        { type: "spawn", mob: "chicken_jockey", amount: 3, name: "{username}" },
        () => 'Lu"cia}',
      ),
    ).toEqual(
      [1, 2, 3].flatMap((n) => [
        ...(n > 1 ? [gap] : []),
        'summon minecraft:chicken ~ ~ ~ {Passengers:[{id:"minecraft:zombie",IsBaby:1b,CustomName:"Lucia"}]}',
      ]),
    );
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

  it("gives an item with the best enchantments it takes", () => {
    const enchanted = (item: string) =>
      run({ type: "give", item, amount: 2, enchanted: true });
    expect(enchanted("netherite_sword")).toEqual([
      "give @s minecraft:netherite_sword[enchantments={sharpness:5,sweeping_edge:3,fire_aspect:2,knockback:2,looting:3,unbreaking:3,mending:1}] 2",
    ]);
    // Infinity, which can't go with Mending
    expect(enchanted("bow")).toEqual([
      "give @s minecraft:bow[enchantments={power:5,flame:1,punch:2,unbreaking:3,infinity:1}] 2",
    ]);
    expect(enchanted("turtle_helmet")).toEqual([
      "give @s minecraft:turtle_helmet[enchantments={protection:4,respiration:3,aqua_affinity:1,thorns:3,unbreaking:3,mending:1}] 2",
    ]);
    // Replacing, the player's own go first, enchanted or not
    expect(
      run({ type: "give", item: "bow", enchanted: true, replace: true }),
    ).toEqual([
      { mayFail: "clear @s minecraft:bow" },
      "give @s minecraft:bow[enchantments={power:5,flame:1,punch:2,unbreaking:3,infinity:1}] 1",
    ]);
    // Nothing to enchant
    expect(enchanted("diamond")).toEqual(["give @s minecraft:diamond 2"]);
    expect(enchanted("constructor")).toEqual([
      "give @s minecraft:constructor 2",
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
    expect(run("launch", "java").slice(4)).toEqual([
      `effect give @s minecraft:levitation 1 ${level - 1}`,
      { wait: stopMs },
      "teleport @s ~ ~ ~",
    ]);
    // Stopped as the push ends
    expect(stopMs).toBe(1000);
    const slow = launchPlan(100, 3);
    expect(
      run("launch", "bedrock", { height: 100, seconds: 3 }).slice(8),
    ).toEqual([
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

  it("clears the way up first, in 32-block fills that change something", () => {
    expect(run("launch", "java").slice(0, 4)).toEqual([
      "setblock ~ ~33 ~ minecraft:structure_void",
      "fill ~-1 ~2 ~-1 ~1 ~33 ~1 minecraft:air",
      "setblock ~ ~52 ~ minecraft:structure_void",
      "fill ~-1 ~34 ~-1 ~1 ~52 ~1 minecraft:air",
    ]);
    expect(run("launch", "bedrock", { height: 5 }).slice(0, 2)).toEqual([
      "setblock ~ ~7 ~ structure_void",
      "fill ~-1 ~2 ~-1 ~1 ~7 ~1 air",
    ]);
    // Up to where the head is at the top: 302 blocks in 10 fills
    const high = run("launch", "bedrock", { height: 300 });
    expect(
      high.filter((c) => typeof c === "string" && c.startsWith("fill")),
    ).toHaveLength(10);
    expect(high[19]).toBe("fill ~-1 ~290 ~-1 ~1 ~302 ~1 air");
  });

  it("gives the water bucket before the launch", () => {
    expect(run("launch_water", "bedrock").slice(5)).toEqual([
      `effect @p levitation 1 ${launchPlan(50, 1).level - 1}`,
      { wait: 1000 },
      "teleport @p ~ ~ ~",
    ]);
    expect(run("launch_water", "bedrock")[0]).toBe("give @p water_bucket 1");
    expect(run("launch_water", "java")[0]).toBe(
      "give @s minecraft:water_bucket 1",
    );
    expect(run("launch_water", "java")[1]).toBe(
      "setblock ~ ~33 ~ minecraft:structure_void",
    );
  });

  it("repeats only the hazards an amount counts", () => {
    expect(run("lightning", "java", { amount: 3 })).toHaveLength(3);
    // Mobs come one at a time
    const creeper = "summon minecraft:creeper ~ ~ ~ {powered:1b}";
    expect(run("charged_creeper", "java", { amount: 3 })).toEqual([
      creeper,
      gap,
      creeper,
      gap,
      creeper,
    ]);
    expect(run("tnt", "java", { amount: 3 })).toHaveLength(1);
    expect(run("tnt_ring", "java", { amount: 3 })).toHaveLength(8);
    expect(run("launch_water", "bedrock", { amount: 3 })).toHaveLength(8);
    expect(run("hole", "bedrock", { amount: 3 })).toHaveLength(2);
  });

  it("traps the player in cobwebs, only where there's air", () => {
    expect(run("cobweb_trap", "bedrock")).toEqual([
      "setblock ~ ~1 ~ structure_void",
      "setblock ~ ~1 ~ air",
      "fill ~-1 ~ ~-1 ~1 ~2 ~1 web keep",
    ]);
    expect(run("cobweb_trap", "java")).toEqual([
      "setblock ~ ~1 ~ minecraft:structure_void",
      "setblock ~ ~1 ~ minecraft:air",
      "fill ~-1 ~ ~-1 ~1 ~2 ~1 minecraft:cobweb keep",
    ]);
  });

  it("shuts the player in honey or obsidian, leaving what's inside", () => {
    expect(run("honey_trap", "bedrock")).toEqual([
      "setblock ~ ~3 ~ structure_void",
      "fill ~-2 ~-1 ~-2 ~2 ~3 ~2 honey_block outline",
    ]);
    expect(run("obsidian_prison", "java")).toEqual([
      "setblock ~ ~3 ~ minecraft:structure_void",
      "fill ~-2 ~-1 ~-2 ~2 ~3 ~2 minecraft:obsidian outline",
    ]);
  });

  it("rings the player with lava, on an obsidian island", () => {
    expect(run("lava_lake", "bedrock")).toEqual([
      "fill ~-2 ~-1 ~-2 ~2 ~-1 ~2 lava",
      "setblock ~ ~-1 ~ obsidian",
    ]);
    expect(run("lava_lake", "java")).toEqual([
      "fill ~-2 ~-1 ~-2 ~2 ~-1 ~2 minecraft:lava",
      "setblock ~ ~-1 ~ minecraft:obsidian",
    ]);
  });

  it("digs a hole as deep as set, never on the world's bedrock floor", () => {
    expect(run("hole", "bedrock", { depth: 20 })).toEqual([
      "execute unless block ~ ~-20 ~ bedrock run setblock ~ ~-20 ~ structure_void",
      "execute unless block ~ ~-20 ~ bedrock run fill ~-1 ~ ~-1 ~1 ~-20 ~1 air",
    ]);
    expect(run("hole", "java")).toEqual([
      "execute unless block ~ ~-10 ~ minecraft:bedrock run setblock ~ ~-10 ~ minecraft:structure_void",
      "execute unless block ~ ~-10 ~ minecraft:bedrock run fill ~-1 ~ ~-1 ~1 ~-10 ~1 minecraft:air",
    ]);
  });

  it("clears the inventory, with a stick in it so it's never empty", () => {
    expect(run("clear_inventory", "bedrock")).toEqual([
      "replaceitem entity @p slot.hotbar 0 stick",
      "clear @p",
    ]);
    expect(run("clear_inventory", "java")).toEqual([
      "item replace entity @s hotbar.0 with minecraft:stick",
      "clear @s",
    ]);
  });

  it("drops the meteors in one command, and fires the lasers, in Java", () => {
    expect(run("meteor", "java", { amount: 5 })).toEqual(["tokio meteor 5"]);
    expect(run("meteor", "java")).toEqual(["tokio meteor 1"]);
    expect(run("laser", "java", { amount: 3 })).toEqual(["tokio laser"]);
    expect(run("super_laser", "java")).toEqual(["tokio laser super"]);
    expect(run("super_duper_laser", "java")).toEqual([
      "tokio laser super duper",
    ]);
  });

  it("summons one of the bosses, picked as it's sent", () => {
    expect(run("random_boss", "java")).toEqual([
      {
        oneOf: [
          "summon minecraft:warden ~ ~ ~",
          "summon minecraft:wither ~ ~ ~",
          "summon minecraft:ravager ~ ~ ~",
          "summon minecraft:evoker ~ ~ ~",
        ],
      },
    ]);
    expect(run("random_boss", "bedrock")).toEqual([
      {
        oneOf: [
          "summon warden ~ ~ ~",
          "summon wither ~ ~ ~",
          "summon ravager ~ ~ ~",
          "summon evocation_illager ~ ~ ~",
        ],
      },
    ]);
  });

  it("runs none of the Tokio mod's hazards in Bedrock", () => {
    for (const hazard of [
      "meteor",
      "laser",
      "super_laser",
      "super_duper_laser",
    ]) {
      expect(run(hazard, "bedrock", { amount: 5 })).toEqual([]);
    }
  });
});

describe("gameCommands for morphs", () => {
  const run = (input: Record<string, unknown>, edition: "bedrock" | "java") =>
    gameCommands(step(input), none, edition);

  it("turns the player into the mob until turned back, or for seconds", () => {
    expect(run({ type: "morph", mob: "zombie" }, "java")).toEqual([
      "tokio morph minecraft:zombie",
    ]);
    expect(run({ type: "morph", mob: "creeper", seconds: 30 }, "java")).toEqual(
      ["tokio morph minecraft:creeper 30"],
    );
  });

  it("turns the player back", () => {
    expect(run({ type: "unmorph" }, "java")).toEqual(["tokio unmorph"]);
  });

  it("runs nothing for a bad mob id, or in Bedrock", () => {
    expect(run({ type: "morph", mob: "zombie ~ ~ ~" }, "java")).toEqual([]);
    expect(run({ type: "morph", mob: "zombie" }, "bedrock")).toEqual([]);
    expect(run({ type: "unmorph" }, "bedrock")).toEqual([]);
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

  it("puts the armor on enchanted in Java only", () => {
    const enchanted = { enchanted: true };
    expect(run("netherite_armor", "java", enchanted)).toEqual([
      "item replace entity @s armor.head with minecraft:netherite_helmet[enchantments={protection:4,respiration:3,aqua_affinity:1,thorns:3,unbreaking:3,mending:1}]",
      "item replace entity @s armor.chest with minecraft:netherite_chestplate[enchantments={protection:4,thorns:3,unbreaking:3,mending:1}]",
      "item replace entity @s armor.legs with minecraft:netherite_leggings[enchantments={protection:4,swift_sneak:3,thorns:3,unbreaking:3,mending:1}]",
      "item replace entity @s armor.feet with minecraft:netherite_boots[enchantments={protection:4,feather_falling:4,soul_speed:3,depth_strider:3,thorns:3,unbreaking:3,mending:1}]",
    ]);
    expect(run("netherite_armor", "bedrock", enchanted)).toEqual(
      run("netherite_armor", "bedrock"),
    );
  });

  it("puts the kit's armor on and gives its weapons and tools, enchanted in Java", () => {
    expect(run("netherite_kit", "java")).toEqual([
      ...run("netherite_armor", "java", { enchanted: true }),
      "give @s minecraft:netherite_sword[enchantments={sharpness:5,sweeping_edge:3,fire_aspect:2,knockback:2,looting:3,unbreaking:3,mending:1}] 1",
      "give @s minecraft:bow[enchantments={power:5,flame:1,punch:2,unbreaking:3,infinity:1}] 1",
      "give @s minecraft:arrow 64",
      "give @s minecraft:netherite_pickaxe[enchantments={fortune:3,efficiency:5,unbreaking:3,mending:1}] 1",
      "give @s minecraft:netherite_axe[enchantments={sharpness:5,fortune:3,efficiency:5,unbreaking:3,mending:1}] 1",
    ]);
    // Replacing, the player's own of each go first
    expect(run("netherite_kit", "bedrock", { replace: true })).toEqual([
      ...run("netherite_armor", "bedrock"),
      { mayFail: "clear @p netherite_sword" },
      "give @p netherite_sword 1",
      { mayFail: "clear @p bow" },
      "give @p bow 1",
      { mayFail: "clear @p arrow" },
      "give @p arrow 64",
      { mayFail: "clear @p netherite_pickaxe" },
      "give @p netherite_pickaxe 1",
      { mayFail: "clear @p netherite_axe" },
      "give @p netherite_axe 1",
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
