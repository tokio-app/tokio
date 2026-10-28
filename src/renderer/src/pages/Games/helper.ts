import { MessageKey, translate } from "@/common/i18n";
import {
  GAME_HAZARDS,
  GAME_HELPS,
  GameAction,
  GameStep,
  MinecraftEdition,
} from "@/common/schemas";
import {
  CommandResult,
  GameStatus,
  MINECRAFT_EDITION_NAMES,
  TOKIO_EVENTS,
} from "@/common/types";
import {
  HAZARD_NAMES,
  HELP_NAMES,
  MINECRAFT_NAMES,
  MINECRAFT_PORT,
  TIME_NAMES,
  WEATHER_NAMES,
} from "@/common/util";
import { SelectOption, TRIGGER_OPTIONS } from "@/components";

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
// names them in English (see .claude/skills/minecraft-lists/SKILL.md)
const options = (names: Record<string, string>): SelectOption<string>[] =>
  Object.entries(names).map(([value, label]) => ({ value, label }));

export const MOBS: Record<MinecraftEdition, SelectOption<string>[]> = {
  bedrock: options(MINECRAFT_NAMES.bedrock.mobs),
  java: options(MINECRAFT_NAMES.java.mobs),
};
export const ITEMS: Record<MinecraftEdition, SelectOption<string>[]> = {
  bedrock: options(MINECRAFT_NAMES.bedrock.items),
  java: options(MINECRAFT_NAMES.java.items),
};

// The events an action can run on: the alerts' but the joins, envelopes,
// Super Fan Boxes and song changes
const LEFT_OUT: string[] = [
  TOKIO_EVENTS.SUPER_FAN_JOIN,
  TOKIO_EVENTS.MEMBER_JOIN,
  TOKIO_EVENTS.ENVELOPE,
  TOKIO_EVENTS.SUPER_FAN_BOX,
  TOKIO_EVENTS.MUSIC_CHANGE,
];
export const GAME_TRIGGERS = TRIGGER_OPTIONS.filter(
  ({ value }) => !LEFT_OUT.includes(value),
);

// The first words of each step's sentence
export const STEP_KINDS: { value: StepKind; label: MessageKey }[] = [
  { value: "spawn", label: "games.steps.spawn" },
  { value: "give", label: "games.steps.give" },
  { value: "weather", label: "games.steps.weather" },
  { value: "time", label: "games.steps.time" },
  { value: "hazard", label: "games.steps.hazard" },
  { value: "help", label: "games.steps.help" },
  { value: "command", label: "games.steps.command" },
];

export const WEATHERS = (["clear", "rain", "thunder"] as const).map(
  (value) => ({ value, label: WEATHER_NAMES[value] }),
);

export const TIMES = (["day", "noon", "night", "midnight"] as const).map(
  (value) => ({ value, label: TIME_NAMES[value] }),
);

export const HAZARDS = GAME_HAZARDS.map((value) => ({
  value,
  label: HAZARD_NAMES[value],
}));

export const HELPS = GAME_HELPS.map((value) => ({
  value,
  label: HELP_NAMES[value],
}));

const NEW_STEPS: { [K in StepKind]: Step<K> } = {
  spawn: { type: "spawn", mob: "zombie", amount: 1, name: "" },
  give: { type: "give", item: "diamond", amount: 1 },
  weather: { type: "weather", weather: "clear" },
  time: { type: "time", time: "day" },
  hazard: {
    type: "hazard",
    hazard: "tnt",
    amount: 1,
    fuse: 4,
    height: 50,
    seconds: 1,
    duration: 10,
    distance: 1000,
  },
  help: { type: "help", help: "netherite_armor", duration: 30 },
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
      min_coins: 0,
      roles: [],
    },
    likes_every: 100,
    steps: [createStep("spawn")],
    overlay: { show: true, image: null, event: "", name: "", column: 1 },
  };
}

// Bedrock and Java ids for the same thing whose English names differ too
const PAIRS = [
  ["ender_crystal", "end_crystal"],
  ["zombie_pigman_spawn_egg", "zombified_piglin_spawn_egg"],
  ["silver_glazed_terracotta", "light_gray_glazed_terracotta"],
  ["undyed_shulker_box", "shulker_box"],
];
const RENAMED = new Map(
  PAIRS.flatMap(
    ([a, b]) =>
      [
        [a, b],
        [b, a],
      ] as const,
  ),
);

// The same mob or item in the other edition: the same id, or the one with the
// same English name (Bedrock's "web" is Java's "cobweb"), or the fallback
function idIn(
  from: MinecraftEdition,
  to: MinecraftEdition,
  kind: "mobs" | "items",
  id: string,
  fallback: string,
) {
  const names = MINECRAFT_NAMES[to][kind];
  if (Object.hasOwn(names, id)) return id;
  const renamed = RENAMED.get(id);
  if (renamed && Object.hasOwn(names, renamed)) return renamed;
  const name = MINECRAFT_NAMES[from][kind][id]?.toLowerCase();
  const same = Object.keys(names).find(
    (other) => names[other].toLowerCase() === name,
  );
  return same ?? fallback;
}

// The action for another edition, with its mobs and items moved over
export function withEdition(
  action: GameAction,
  edition: MinecraftEdition,
): GameAction {
  const from = action.edition;
  if (from === edition) return action;
  const steps = action.steps.map((step): GameStep => {
    if (step.type === "spawn")
      return { ...step, mob: idIn(from, edition, "mobs", step.mob, "zombie") };
    if (step.type === "give")
      return {
        ...step,
        item: idIn(from, edition, "items", step.item, "diamond"),
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
export function testSummary(results: CommandResult[], language: string) {
  const failed = results.filter((result) => !result.ok).length;
  const count = results.length;
  if (failed === 0) return translate(language, "games.test.ran", { count });
  if (failed === count)
    return translate(language, "games.test.failed", { count });
  return translate(language, "games.test.someFailed", {
    count,
    failed: String(failed),
  });
}

const STATUS_TEXT: Record<GameStatus["state"], MessageKey> = {
  off: "games.status.off",
  waiting: "games.status.waiting",
  connected: "common.connected",
  error: "games.status.error",
};

// An error says why, a connection which edition
export function statusText(status: GameStatus, language: string) {
  if (status.state === "connected" && status.edition)
    return translate(language, "games.status.connectedTo", {
      edition: MINECRAFT_EDITION_NAMES[status.edition],
    });
  return (
    (status.state === "error" && status.error) ||
    translate(language, STATUS_TEXT[status.state])
  );
}
