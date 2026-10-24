import { GameStep } from "@/common/schemas";

// The longest a viewer's text gets inside a command
const MAX_VALUE_LENGTH = 100;

// Mob and item ids as the game writes them, like "zombie"
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
 * The Bedrock commands a step runs, as the connected player. `fill` fills
 * the trigger's variables in the step's text. A mob or item id the game
 * can't have runs nothing.
 */
export function gameCommands(
  step: GameStep,
  fill: (text: string) => string,
): string[] {
  switch (step.type) {
    case "spawn": {
      if (!ID.test(step.mob)) return [];
      const name = commandValue(fill(step.name));
      // ~ is where the player stands
      const command = name
        ? `summon ${step.mob} ${JSON.stringify(name)} ~ ~ ~`
        : `summon ${step.mob} ~ ~ ~`;
      return Array.from({ length: step.amount }, () => command);
    }
    case "give":
      return ID.test(step.item) ? [`give @p ${step.item} ${step.amount}`] : [];
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
