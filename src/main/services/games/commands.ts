import { GameStep, MinecraftEdition } from "@/common/schemas";

// The longest a viewer's text gets inside a command
const MAX_VALUE_LENGTH = 100;

// Mob and item ids as Bedrock writes them, like "zombie" (Java's take a
// "minecraft:" in front)
const ID = /^[a-z0-9_]+$/;

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
): string[] {
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
      return [
        java
          ? `give @s minecraft:${step.item} ${step.amount}`
          : `give @p ${step.item} ${step.amount}`,
      ];
    }
    case "weather":
      return [`weather ${step.weather}`];
    case "time":
      return [`time set ${step.time}`];
    default: {
      // A command step
      const command = fill(step.command).trim().replace(/^\//, "");
      return command ? [command] : [];
    }
  }
}
