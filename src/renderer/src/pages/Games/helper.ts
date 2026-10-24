import { GameAction, GameStep } from "@/common/schemas";
import { CommandResult, GameStatus, TOKIO_EVENTS } from "@/common/types";
import { MINECRAFT_PORT } from "@/common/util";
import { SelectOption } from "@/components";
import minecraft from "./minecraft.json";

export type StepKind = GameStep["type"];
type Step<K extends StepKind> = Extract<GameStep, { type: K }>;

// What Minecraft's chat takes to join Tokio, from this PC or another device
export const connectCommand = (host: string) =>
  `/connect ${host}:${MINECRAFT_PORT}`;

// Every mob and item the game's summon and give take, named as the game
// names them in English: Mojang's bedrock-samples metadata, each id checked
// in the game (see .claude/rules/games.md)
const options = (names: Record<string, string>): SelectOption<string>[] =>
  Object.entries(names).map(([value, label]) => ({ value, label }));

export const MOBS = options(minecraft.mobs);
export const ITEMS = options(minecraft.items);

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

export function createAction(): GameAction {
  return {
    id: crypto.randomUUID(),
    enabled: true,
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

// An error says why
export const statusText = (status: GameStatus) =>
  (status.state === "error" && status.error) || STATUS_TEXT[status.state];
