import { bestEnchantments } from "@/common/games/enchantments";
import { GameStep, MinecraftEdition } from "@/common/schemas";
import { NETHERITE_KIT, REPEATED_HAZARDS } from "@/common/util";

// The longest a viewer's text gets inside a command
const MAX_VALUE_LENGTH = 100;

// Mob and item ids as Bedrock writes them, like "zombie" (Java's take a
// "minecraft:" in front)
const ID = /^[a-z0-9_]+$/;

// TNT around the player, 3 blocks out
const RING = [
  [3, 0],
  [-3, 0],
  [0, 3],
  [0, -3],
  [2, 2],
  [2, -2],
  [-2, 2],
  [-2, -2],
];

// A command for the game, or a wait before the rest: they go once the
// commands before it are answered and its milliseconds have passed. A
// mayFail's failure counts as done (a clear that found nothing to take), and
// a oneOf sends one of its commands, picked as it's sent.
export type GameCommand =
  string | { wait: number } | { mayFail: string } | { oneOf: string[] };

// The time between the mobs of a step, so they come one at a time
export const SPAWN_GAP_MS = 250;

// The groups' commands, a wait apart
const spaced = (groups: GameCommand[][]): GameCommand[] =>
  groups.flatMap((group, i) =>
    i === 0 ? group : [{ wait: SPAWN_GAP_MS }, ...group],
  );

// The strongest levitation the effect command takes (amplifier 255). Both
// editions send it to the game whole.
const MAX_LEVEL = 256;

// The tick a launch reaches `height` blocks, or -1 if it never does. It plays
// Java's physics: each tick the speed eases toward 0.05 blocks per level by a
// fifth, then loses 2% to drag; once the push ends, gravity takes 0.08.
function reachedAt(level: number, pushTicks: number, height: number) {
  let y = 0;
  let speed = 0;
  for (let tick = 1; ; tick++) {
    speed =
      tick <= pushTicks
        ? (speed + (0.05 * level - speed) * 0.2) * 0.98
        : (speed - 0.08) * 0.98;
    if (speed <= 0) return -1;
    y += speed;
    if (y >= height) return tick;
  }
}

/**
 * The levitation that lifts the player `height` blocks in `seconds`, and when
 * to stop the climb, in milliseconds after it starts: the weakest level that
 * gets there within the push, else the strongest, which keeps climbing on its
 * momentum after the push until it gets there.
 */
export function launchPlan(height: number, seconds: number) {
  const ticks = seconds * 20;
  const within = (level: number) => {
    const tick = reachedAt(level, ticks, height);
    return tick > 0 && tick <= ticks;
  };
  let level = 1;
  while (level < MAX_LEVEL && !within(level)) level++;
  // Not before the push ends, or it would lift the player again
  return {
    level,
    stopMs: Math.max(reachedAt(level, ticks, height), ticks) * 50,
  };
}

// A Java item, enchanted with the best it takes: its enchantments component
// (Java 26.3's ItemEnchantments, a map of levels)
function javaItem(item: string, enchanted: boolean) {
  const levels = enchanted ? bestEnchantments(item) : [];
  const list = levels.map(([id, level]) => `${id}:${level}`).join(",");
  return `minecraft:${item}${list ? `[enchantments={${list}}]` : ""}`;
}

// Into the player's inventory, or at their feet when it's full. Bedrock's
// give takes no enchantments, and its enchant only works on the held item.
// Replacing, the player's own of that item go first, enchanted or not.
function give(
  java: boolean,
  item: string,
  amount: number,
  { enchanted = false, replace = false } = {},
): GameCommand[] {
  const command = java
    ? `give @s ${javaItem(item, enchanted)} ${amount}`
    : `give @p ${item} ${amount}`;
  if (!replace) return [command];
  // Both editions fail a clear that finds none, which is fine here
  return [
    { mayFail: java ? `clear @s minecraft:${item}` : `clear @p ${item}` },
    command,
  ];
}

// On the player, at its level minus one, as the game counts it
const effect = (java: boolean, id: string, seconds: number, amplifier = 0) =>
  java
    ? `effect give @s minecraft:${id} ${seconds} ${amplifier}`
    : `effect @p ${id} ${seconds} ${amplifier}`;

// A block id in the edition's syntax: Java's take a "minecraft:" in front
const block = (java: boolean, id: string) => (java ? `minecraft:${id}` : id);

// Both editions refuse a fill that changes nothing, as over a clear sky or
// around a trap already there. A structure void set first at `at`, a cell the
// fill writes, gives it a change; before a keep fill, which writes only air,
// it's made air again. The marker sits on the fill's farthest row, so it fails
// with a fill that reaches out of the world and is never left behind.
function sureFill(
  java: boolean,
  [from, to]: [string, string],
  id: string,
  at: string,
  mode?: "keep" | "outline",
) {
  const set = (marker: string) => `setblock ${at} ${block(java, marker)}`;
  const fill = `fill ${from} ${to} ${block(java, id)}${mode ? ` ${mode}` : ""}`;
  return mode === "keep"
    ? [set("structure_void"), set("air"), fill]
    : [set("structure_void"), fill];
}

// The rows of the column a launch clears in one fill. A fill past the world's
// top fails whole, so the clearing goes in pieces and only those up there fail.
const SHAFT_ROWS = 32;

// Empties the 3×3 column over the player's head, any 0.6-wide player's,
// up to where it is at the top of a climb of `height` blocks. A fill drops
// nothing (replace), and takes bedrock too, so from under the Nether's roof
// the player goes through it.
function clearUp(java: boolean, height: number) {
  const commands: string[] = [];
  for (let bottom = 2; bottom <= height + 2; bottom += SHAFT_ROWS) {
    const top = Math.min(bottom + SHAFT_ROWS - 1, height + 2);
    commands.push(
      ...sureFill(
        java,
        [`~-1 ~${bottom} ~-1`, `~1 ~${top} ~1`],
        "air",
        `~ ~${top} ~`,
      ),
    );
  }
  return commands;
}

// The bosses a random boss is one of, as Java and Bedrock name them: the
// deadliest next to the player. A summoned Ender Dragon circles the world's
// center (its fight origin) and an Elder Guardian can't move on land, so
// they're left out.
const BOSSES = [
  ["warden", "warden"],
  ["wither", "wither"],
  ["ravager", "ravager"],
  ["evoker", "evocation_illager"],
];

// What a hazard runs where the player stands. No NBT but the creeper's and
// the fuse, so they hold across game versions.
function hazardCommands(
  step: Extract<GameStep, { type: "hazard" }>,
  java: boolean,
): GameCommand[] {
  // Java takes any fuse, in ticks. Bedrock's TNT burns 4 s, or 0.5–2 s at
  // random with its from_explosion event.
  const tnt = (at: string) =>
    java
      ? `summon minecraft:tnt ${at} {fuse:${Math.round(step.fuse * 20)}}`
      : `summon tnt ${at}${step.fuse <= 2 ? " 0 0 from_explosion" : ""}`;
  // Teleporting in place drops the climb's speed, so the fall starts at the
  // top instead of drifting up on momentum
  const launch = () => {
    const { level, stopMs } = launchPlan(step.height, step.seconds);
    return [
      ...clearUp(java, step.height),
      effect(java, "levitation", step.seconds, level - 1),
      { wait: stopMs },
      `teleport ${java ? "@s" : "@p"} ~ ~ ~`,
    ];
  };
  switch (step.hazard) {
    case "tnt":
      return [tnt("~ ~10 ~")];
    case "tnt_ring":
      return RING.map(([x, z]) => tnt(`~${x} ~1 ~${z}`));
    case "lightning":
      return [
        java
          ? "summon minecraft:lightning_bolt ~ ~ ~"
          : "summon lightning_bolt ~ ~ ~",
      ];
    case "charged_creeper":
      return [
        java
          ? "summon minecraft:creeper ~ ~ ~ {powered:1b}"
          : "summon creeper ~ ~ ~ 0 0 minecraft:become_charged",
      ];
    case "evoker_fangs":
      return [
        java
          ? "summon minecraft:evoker_fangs ~ ~ ~"
          : "summon evocation_fang ~ ~ ~",
      ];
    case "anvil":
      // Bedrock can't summon a falling block, so the anvil is set in the air,
      // only where there's room (keep), and falls
      return [`setblock ~ ~20 ~ ${block(java, "anvil")} keep`];
    case "harming":
      return [effect(java, "instant_damage", 1, 1)];
    case "launch":
      return launch();
    case "launch_water":
      // In the inventory before the fall, for the player to save themselves
      return [...give(java, "water_bucket", 1), ...launch()];
    case "freeze":
      return [effect(java, "slowness", step.duration, 255)];
    case "lights_out":
      return [effect(java, "darkness", step.duration)];
    case "dizzy":
      return [effect(java, "nausea", step.duration)];
    case "turn_around":
      return [`teleport ${java ? "@s" : "@p"} ~ ~ ~ ~180 ~`];
    // Only into air, so nothing breaks: around the player, in their own
    // cells and over them
    case "cobweb_trap":
      return sureFill(
        java,
        ["~-1 ~ ~-1", "~1 ~2 ~1"],
        java ? "cobweb" : "web",
        "~ ~1 ~",
        "keep",
      );
    // A 5×5×5 shell around the 3×3 space the player stands in, under them too;
    // what's inside stays. Honey can't be in the player's cells as webs are
    // (they'd choke), so its floor slows them and stops their jumps.
    case "honey_trap":
    case "obsidian_prison":
      return sureFill(
        java,
        ["~-2 ~-1 ~-2", "~2 ~3 ~2"],
        step.hazard === "honey_trap" ? "honey_block" : "obsidian",
        "~ ~3 ~",
        "outline",
      );
    case "lava_lake":
      // The ground around the player turns to lava, a ring two blocks wide,
      // and the block they stand on to obsidian, an island to jump or build
      // off. The fill takes the island too, so a lake already there changes.
      return [
        `fill ~-2 ~-1 ~-2 ~2 ~-1 ~2 ${block(java, "lava")}`,
        `setblock ~ ~-1 ~ ${block(java, "obsidian")}`,
      ];
    case "hole": {
      // From the feet's own row (a slab, a carpet) down. One whose bottom is
      // bedrock, the world's floor, digs nothing, so it never opens the void.
      const bottom = `~ ~-${step.depth} ~`;
      const guard = `execute unless block ${bottom} ${block(java, "bedrock")} run`;
      return sureFill(
        java,
        ["~-1 ~ ~-1", `~1 ~-${step.depth} ~1`],
        "air",
        bottom,
      ).map((command) => `${guard} ${command}`);
    }
    case "clear_inventory": {
      // Both editions refuse to clear an empty inventory, so a stick goes in
      // first, over whatever the first hotbar slot holds
      const target = java ? "@s" : "@p";
      return [
        java
          ? "item replace entity @s hotbar.0 with minecraft:stick"
          : "replaceitem entity @p slot.hotbar 0 stick",
        `clear ${target}`,
      ];
    }
    case "random_boss":
      // A new one each run, picked as it's sent
      return [
        {
          oneOf: BOSSES.map(([javaId, bedrockId]) =>
            java
              ? `summon minecraft:${javaId} ~ ~ ~`
              : `summon ${bedrockId} ~ ~ ~`,
          ),
        },
      ];
    // The Tokio mod's own commands, which Bedrock has nothing like. The mod
    // drops every meteor around the player itself.
    case "meteor":
      return java ? [`tokio meteor ${step.amount}`] : [];
    case "laser":
      return java ? ["tokio laser"] : [];
    case "super_laser":
      return java ? ["tokio laser super"] : [];
    case "super_duper_laser":
      return java ? ["tokio laser super duper"] : [];
    default:
      // A random teleport, anywhere within the distance
      return [
        java
          ? `spreadplayers ~ ~ 0 ${step.distance} false @s`
          : `spreadplayers ~ ~ 0 ${step.distance} @p`,
      ];
  }
}

// Bedrock's mobs with minecraft:burns_in_daylight (bedrock-samples'
// behavior_pack/entities), but the fire-immune magma cube: spawned in the
// day, the sun would kill them before they did anything. The Tokio mod keeps
// Java's out of the sun itself.
const DAYLIGHT_BURNERS = [
  "bogged",
  "drowned",
  "phantom",
  "skeleton",
  "stray",
  "zombie",
  "zombie_horse",
  "zombie_nautilus",
  "zombie_villager",
];

// Bedrock's spawn events that set a mob neutral until provoked on the player
// at once (bedrock-samples' entities). Only the cave spider's anger brings a
// player target: the zombie pigman's and enderman's has none until hit, the
// spider's hostility ends in daylight, and piglins already attack. The Tokio
// mod sets Java's hostiles on the player itself.
const ANGER_EVENTS = new Map([["cave_spider", "minecraft:become_angry"]]);

// One of Bedrock's mobs, `name` the quoted name or "". Its summon takes no
// NBT, so a chicken jockey is a baby zombie that gets a new adult chicken
// under it (a chicken can be a baby, which has no seat). Summoning the rider,
// not the chicken, keeps chickens already nearby out of it, and c=1 picks the
// one just spawned at the player's feet, before it moves.
function bedrockMob(mob: string, name: string) {
  const jockey = mob === "chicken_jockey";
  const summoned = jockey ? "zombie" : mob;
  const event = jockey ? "minecraft:as_baby" : ANGER_EVENTS.get(mob);
  const spawned = `@e[type=${summoned},r=2,c=1]`;
  const commands = [
    event
      ? `summon ${summoned} ~ ~ ~ 0 0 ${event}${name}`
      : `summon ${summoned}${name} ~ ~ ~`,
  ];
  if (jockey) {
    commands.push(
      `ride ${spawned} summon_ride chicken no_ride_change minecraft:spawn_adult`,
    );
  }
  if (DAYLIGHT_BURNERS.includes(summoned)) {
    // For good, without the particles
    commands.push(`effect ${spawned} fire_resistance infinite 0 true`);
  }
  return commands;
}

type Help = Extract<GameStep, { type: "help" }>["help"];

// The effect each potion-like help puts on, and its amplifier: Regeneration
// II, Absorption IV (8 more hearts), Resistance IV (80% less damage), Speed,
// Jump Boost and Strength II, the rest I
const HELP_EFFECTS: Partial<Record<Help, [string, number]>> = {
  regeneration: ["regeneration", 1],
  absorption: ["absorption", 3],
  resistance: ["resistance", 3],
  fire_resistance: ["fire_resistance", 0],
  speed: ["speed", 1],
  jump_boost: ["jump_boost", 1],
  strength: ["strength", 1],
  slow_falling: ["slow_falling", 0],
  water_breathing: ["water_breathing", 0],
  night_vision: ["night_vision", 0],
  invisibility: ["invisibility", 0],
};

// Each armor slot, as Java and Bedrock name it, and its netherite piece
const ARMOR = [
  ["armor.head", "slot.armor.head", "netherite_helmet"],
  ["armor.chest", "slot.armor.chest", "netherite_chestplate"],
  ["armor.legs", "slot.armor.legs", "netherite_leggings"],
  ["armor.feet", "slot.armor.feet", "netherite_boots"],
];

// What a help gives or puts on the player
function helpCommands(
  step: Extract<GameStep, { type: "help" }>,
  java: boolean,
): GameCommand[] {
  const { help } = step;
  if (help === "netherite_armor" || help === "netherite_kit") {
    // The kit's are always enchanted, on Java
    const enchanted = help === "netherite_kit" || step.enchanted;
    // Put on at once, replacing what the player wears (the user's call)
    const armor = ARMOR.map(([javaSlot, bedrockSlot, item]) =>
      java
        ? `item replace entity @s ${javaSlot} with ${javaItem(item, enchanted)}`
        : `replaceitem entity @p ${bedrockSlot} 0 ${item}`,
    );
    if (help === "netherite_armor") return armor;
    return [
      ...armor,
      ...NETHERITE_KIT.flatMap(([item, amount]) =>
        give(java, item, amount, { enchanted, replace: step.replace }),
      ),
    ];
  }
  if (help === "heal") {
    // Health and hunger full; more than they hold is capped
    return [
      effect(java, "instant_health", 1, 4),
      effect(java, "saturation", 1, 19),
    ];
  }
  const found = HELP_EFFECTS[help];
  if (!found) return [];
  const [id, amplifier] = found;
  return [effect(java, id, step.duration, amplifier)];
}

/**
 * Makes viewer text safe inside a command: without quotes, backslashes,
 * brackets, braces, §, @ or *, a nickname can't end a string, add NBT
 * (`Passengers:[…]`), a target selector (`@e`) or name every score holder
 * (`*`, which the stripping alone would make of `[*]`).
 */
export function commandValue(text: string): string {
  return (
    text
      // Before the control characters go, so a line break still parts words
      .replace(/\s+/g, " ")
      .replace(/["'\\{}[\]§@*\p{Cc}]/gu, "")
      .replace(/ {2,}/g, " ")
      .trim()
      .slice(0, MAX_VALUE_LENGTH)
      // A lone surrogate, which the slice can leave, isn't text the game takes
      .replace(/\p{Cs}/gu, "")
      .trim()
  );
}

/**
 * The commands a step runs in the edition's syntax, as the connected player.
 * `fill` fills the trigger's variables in the step's text. A mob or item id
 * the game can't have runs nothing.
 */
export function gameCommands(
  step: GameStep,
  fill: (text: string) => string,
  edition: MinecraftEdition,
): GameCommand[] {
  const java = edition === "java";
  switch (step.type) {
    case "spawn": {
      if (!ID.test(step.mob)) return [];
      const name = commandValue(fill(step.name));
      const quoted = JSON.stringify(name);
      // One at a time, SPAWN_GAP_MS apart
      const each = (commands: string[]) =>
        spaced(Array.from({ length: step.amount }, () => commands));
      if (!java) return each(bedrockMob(step.mob, name ? ` ${quoted}` : ""));
      // ~ is where the player stands. Java's SNBT reads a plain string as a
      // text component. A jockey's name goes on its baby zombie.
      const command =
        step.mob === "chicken_jockey"
          ? `summon minecraft:chicken ~ ~ ~ {Passengers:[{id:"minecraft:zombie",IsBaby:1b${name ? `,CustomName:${quoted}` : ""}}]}`
          : `summon minecraft:${step.mob} ~ ~ ~${name ? ` {CustomName:${quoted}}` : ""}`;
      return each([command]);
    }
    // The Tokio mod's: for seconds, or until an unmorph
    case "morph": {
      if (!java || !ID.test(step.mob)) return [];
      const seconds = step.seconds === null ? "" : ` ${step.seconds}`;
      return [`tokio morph minecraft:${step.mob}${seconds}`];
    }
    case "unmorph":
      return java ? ["tokio unmorph"] : [];
    case "give": {
      if (!ID.test(step.item)) return [];
      return give(java, step.item, step.amount, step);
    }
    case "weather":
      return [`weather ${step.weather}`];
    case "time":
      return [`time set ${step.time}`];
    case "hazard": {
      const commands = hazardCommands(step, java);
      const times = REPEATED_HAZARDS.includes(step.hazard) ? step.amount : 1;
      const runs = Array.from({ length: times }, () => commands);
      // Mobs, which come one at a time as a spawn's do
      return step.hazard === "charged_creeper" ? spaced(runs) : runs.flat();
    }
    case "help":
      return helpCommands(step, java);
    default: {
      // A command step
      const command = fill(step.command).trim().replace(/^\//, "");
      return command ? [command] : [];
    }
  }
}
