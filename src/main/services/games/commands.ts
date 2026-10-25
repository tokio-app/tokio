import { GameStep, MinecraftEdition } from "@/common/schemas";
import { REPEATED_HAZARDS } from "@/common/util";

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
// commands before it are answered and its milliseconds have passed
export type GameCommand = string | { wait: number };

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

// Into the player's inventory, or at their feet when it's full
const give = (java: boolean, item: string, amount: number) =>
  java ? `give @s minecraft:${item} ${amount}` : `give @p ${item} ${amount}`;

// On the player, at its level minus one, as the game counts it
const effect = (java: boolean, id: string, seconds: number, amplifier = 0) =>
  java
    ? `effect give @s minecraft:${id} ${seconds} ${amplifier}`
    : `effect @p ${id} ${seconds} ${amplifier}`;

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
      return [`setblock ~ ~20 ~ ${java ? "minecraft:" : ""}anvil keep`];
    case "harming":
      return [effect(java, "instant_damage", 1, 1)];
    case "launch":
      return launch();
    case "launch_water":
      // In the inventory before the fall, for the player to save themselves
      return [give(java, "water_bucket", 1), ...launch()];
    case "freeze":
      return [effect(java, "slowness", step.duration, 255)];
    case "lights_out":
      return [effect(java, "darkness", step.duration)];
    case "dizzy":
      return [effect(java, "nausea", step.duration)];
    case "turn_around":
      return [`teleport ${java ? "@s" : "@p"} ~ ~ ~ ~180 ~`];
    default:
      // A random teleport, anywhere within the distance
      return [
        java
          ? `spreadplayers ~ ~ 0 ${step.distance} false @s`
          : `spreadplayers ~ ~ 0 ${step.distance} @p`,
      ];
  }
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
  if (help === "netherite_armor") {
    // Put on at once, replacing what the player wears (the user's call)
    return ARMOR.map(([javaSlot, bedrockSlot, item]) =>
      java
        ? `item replace entity @s ${javaSlot} with minecraft:${item}`
        : `replaceitem entity @p ${bedrockSlot} 0 ${item}`,
    );
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
 * brackets, braces, § or @, a nickname can't end a string, add NBT
 * (`Passengers:[…]`) or a target selector (`@e`).
 */
export function commandValue(text: string): string {
  return (
    text
      // Before the control characters go, so a line break still parts words
      .replace(/\s+/g, " ")
      .replace(/["'\\{}[\]§@\p{Cc}]/gu, "")
      .replace(/ {2,}/g, " ")
      .trim()
      .slice(0, MAX_VALUE_LENGTH)
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
      // ~ is where the player stands. Java's SNBT reads a plain string as a
      // text component.
      const command = java
        ? `summon minecraft:${step.mob} ~ ~ ~${name ? ` {CustomName:${quoted}}` : ""}`
        : `summon ${step.mob}${name ? ` ${quoted}` : ""} ~ ~ ~`;
      return Array.from({ length: step.amount }, () => command);
    }
    case "give": {
      if (!ID.test(step.item)) return [];
      return [give(java, step.item, step.amount)];
    }
    case "weather":
      return [`weather ${step.weather}`];
    case "time":
      return [`time set ${step.time}`];
    case "hazard": {
      const commands = hazardCommands(step, java);
      const times = REPEATED_HAZARDS.includes(step.hazard) ? step.amount : 1;
      return Array.from({ length: times }, () => commands).flat();
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
