import { GameAction, GameStep, MinecraftEdition } from "@/common/schemas";
import {
  CommandResult,
  GameStatus,
  MINECRAFT_EDITION_NAMES,
  TOKIO_EVENTS,
} from "@/common/types";
import { MINECRAFT_PORT } from "@/common/util";
import { SelectOption } from "@/components";
import bedrock from "./minecraft-bedrock.json";
import java from "./minecraft-java.json";

export type StepKind = GameStep["type"];
type Step<K extends StepKind> = Extract<GameStep, { type: K }>;

export const EDITIONS: SelectOption<MinecraftEdition>[] = [
  { value: "bedrock", label: "Bedrock" },
  { value: "java", label: "Java" },
];

// What each edition's chat takes to join Tokio, from this PC or another
// device. Java's command comes from the Tokio mod.
export const connectCommand = (host: string, edition: MinecraftEdition) =>
  `${edition === "java" ? "/tokio connect" : "/connect"} ${host}:${MINECRAFT_PORT}`;

// Every mob and item each edition's summon and give take, named as the game
// names them in English (see .claude/rules/games.md)
const options = (names: Record<string, string>): SelectOption<string>[] =>
  Object.entries(names).map(([value, label]) => ({ value, label }));

export const MOBS: Record<MinecraftEdition, SelectOption<string>[]> = {
  bedrock: options(bedrock.mobs),
  java: options(java.mobs),
};
export const ITEMS: Record<MinecraftEdition, SelectOption<string>[]> = {
  bedrock: options(bedrock.items),
  java: options(java.items),
};

// The first words of each step's sentence
export const STEP_KINDS: SelectOption<StepKind>[] = [
  { value: "spawn", label: "Spawn mob" },
  { value: "give", label: "Give item" },
  { value: "weather", label: "Weather" },
  { value: "time", label: "Time of day" },
  { value: "command", label: "Command" },
];

export const WEATHERS: SelectOption<Step<"weather">["weather"]>[] = [
  { value: "clear", label: "Clear" },
  { value: "rain", label: "Rain" },
  { value: "thunder", label: "Thunder" },
];

export const TIMES: SelectOption<Step<"time">["time"]>[] = [
  { value: "day", label: "Day" },
  { value: "noon", label: "Noon" },
  { value: "night", label: "Night" },
  { value: "midnight", label: "Midnight" },
];

const NEW_STEPS: { [K in StepKind]: Step<K> } = {
  spawn: { type: "spawn", mob: "zombie", amount: 1, name: "" },
  give: { type: "give", item: "diamond", amount: 1 },
  weather: { type: "weather", weather: "clear" },
  time: { type: "time", time: "day" },
  command: { type: "command", command: "" },
};

export const createStep = (kind: StepKind): GameStep => ({
  ...NEW_STEPS[kind],
});

export function createAction(edition: MinecraftEdition): GameAction {
  return {
    id: crypto.randomUUID(),
    enabled: true,
    edition,
    trigger: {
      type: TOKIO_EVENTS.FOLLOW,
      gifts: [],
      every_gift: false,
      emotes: [],
      keyword: "",
      user: "",
    },
    steps: [createStep("spawn")],
  };
}

// Bedrock's ids that Java names differently
const JAVA_IDS: Record<string, string> = {
  web: "cobweb",
  evocation_illager: "evoker",
  zombie_pigman: "zombified_piglin",
};
const BEDROCK_IDS = Object.fromEntries(
  Object.entries(JAVA_IDS).map(([bedrock, java]) => [java, bedrock]),
);

// The same mob or item in the other edition, or the fallback when it has none
function idIn(
  edition: MinecraftEdition,
  list: SelectOption<string>[],
  id: string,
  fallback: string,
) {
  const renamed = (edition === "java" ? JAVA_IDS : BEDROCK_IDS)[id];
  if (renamed) return renamed;
  return list.some((option) => option.value === id) ? id : fallback;
}

// The action for another edition, with its mobs and items moved over
export function withEdition(
  action: GameAction,
  edition: MinecraftEdition,
): GameAction {
  if (action.edition === edition) return action;
  const steps = action.steps.map((step): GameStep => {
    if (step.type === "spawn")
      return { ...step, mob: idIn(edition, MOBS[edition], step.mob, "zombie") };
    if (step.type === "give")
      return {
        ...step,
        item: idIn(edition, ITEMS[edition], step.item, "diamond"),
      };
    return step;
  });
  return { ...action, edition, steps };
}

// The text a step's variables go into, if it has one
export function stepText(step: GameStep): string | null {
  if (step.type === "spawn") return step.name;
  if (step.type === "command") return step.command;
  return null;
}

export function withText(step: GameStep, text: string): GameStep {
  if (step.type === "spawn") return { ...step, name: text };
  if (step.type === "command") return { ...step, command: text };
  return step;
}

// How a test went, in a few words
export function testSummary(results: CommandResult[]) {
  const failed = results.filter((result) => !result.ok).length;
  const commands = `${results.length} ${results.length === 1 ? "command" : "commands"}`;
  if (failed === 0) return `${commands} ran`;
  if (failed === results.length) return `${commands} failed`;
  return `${failed} of ${commands} failed`;
}

const STATUS_TEXT: Record<GameStatus["state"], string> = {
  off: "Off",
  waiting: "Waiting for Minecraft",
  connected: "Connected",
  error: "Minecraft can't connect.",
};

// An error says why, a connection which edition
export function statusText(status: GameStatus) {
  if (status.state === "connected" && status.edition)
    return `Connected to ${MINECRAFT_EDITION_NAMES[status.edition]}`;
  return (
    (status.state === "error" && status.error) || STATUS_TEXT[status.state]
  );
}
