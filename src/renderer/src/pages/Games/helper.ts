import { GameAction, GameStep } from "@/common/schemas";
import { GameStatus, TOKIO_EVENTS } from "@/common/types";
import { MINECRAFT_PORT } from "@/common/util";
import { SelectOption } from "@/components";

export type StepKind = GameStep["type"];
type Step<K extends StepKind> = Extract<GameStep, { type: K }>;

// What Minecraft's chat takes to join Tokio, from this PC or another device
export const connectCommand = (host: string) =>
  `/connect ${host}:${MINECRAFT_PORT}`;

// Bedrock's ids, which the commands use
export const MOBS: SelectOption<string>[] = [
  { value: "zombie", label: "Zombie" },
  { value: "zombie_villager", label: "Zombie Villager" },
  { value: "husk", label: "Husk" },
  { value: "drowned", label: "Drowned" },
  { value: "skeleton", label: "Skeleton" },
  { value: "stray", label: "Stray" },
  { value: "wither_skeleton", label: "Wither Skeleton" },
  { value: "creeper", label: "Creeper" },
  { value: "spider", label: "Spider" },
  { value: "cave_spider", label: "Cave Spider" },
  { value: "enderman", label: "Enderman" },
  { value: "witch", label: "Witch" },
  { value: "slime", label: "Slime" },
  { value: "magma_cube", label: "Magma Cube" },
  { value: "phantom", label: "Phantom" },
  { value: "blaze", label: "Blaze" },
  { value: "ghast", label: "Ghast" },
  { value: "piglin", label: "Piglin" },
  // Bedrock's id, Java's is zombified_piglin
  { value: "zombie_pigman", label: "Zombified Piglin" },
  { value: "hoglin", label: "Hoglin" },
  { value: "breeze", label: "Breeze" },
  { value: "pillager", label: "Pillager" },
  { value: "vindicator", label: "Vindicator" },
  // Bedrock's id, Java's is evoker
  { value: "evocation_illager", label: "Evoker" },
  { value: "ravager", label: "Ravager" },
  { value: "warden", label: "Warden" },
  { value: "wither", label: "Wither" },
  { value: "ender_dragon", label: "Ender Dragon" },
  { value: "iron_golem", label: "Iron Golem" },
  { value: "snow_golem", label: "Snow Golem" },
  { value: "villager", label: "Villager" },
  { value: "wolf", label: "Wolf" },
  { value: "cat", label: "Cat" },
  { value: "fox", label: "Fox" },
  { value: "pig", label: "Pig" },
  { value: "cow", label: "Cow" },
  { value: "sheep", label: "Sheep" },
  { value: "chicken", label: "Chicken" },
  { value: "horse", label: "Horse" },
  { value: "llama", label: "Llama" },
  { value: "panda", label: "Panda" },
  { value: "parrot", label: "Parrot" },
  { value: "polar_bear", label: "Polar Bear" },
  { value: "dolphin", label: "Dolphin" },
  { value: "bee", label: "Bee" },
  { value: "axolotl", label: "Axolotl" },
  { value: "goat", label: "Goat" },
  { value: "frog", label: "Frog" },
  { value: "armadillo", label: "Armadillo" },
  { value: "tnt", label: "Primed TNT" },
  { value: "lightning_bolt", label: "Lightning" },
];

export const ITEMS: SelectOption<string>[] = [
  { value: "diamond", label: "Diamond" },
  { value: "emerald", label: "Emerald" },
  { value: "gold_ingot", label: "Gold Ingot" },
  { value: "iron_ingot", label: "Iron Ingot" },
  { value: "netherite_ingot", label: "Netherite Ingot" },
  { value: "coal", label: "Coal" },
  { value: "apple", label: "Apple" },
  { value: "golden_apple", label: "Golden Apple" },
  { value: "enchanted_golden_apple", label: "Enchanted Golden Apple" },
  { value: "golden_carrot", label: "Golden Carrot" },
  { value: "totem_of_undying", label: "Totem of Undying" },
  { value: "bread", label: "Bread" },
  { value: "cooked_beef", label: "Steak" },
  { value: "cake", label: "Cake" },
  { value: "cookie", label: "Cookie" },
  { value: "tnt", label: "TNT" },
  { value: "end_crystal", label: "End Crystal" },
  { value: "ender_pearl", label: "Ender Pearl" },
  { value: "wind_charge", label: "Wind Charge" },
  { value: "arrow", label: "Arrow" },
  { value: "bow", label: "Bow" },
  { value: "trident", label: "Trident" },
  { value: "mace", label: "Mace" },
  { value: "shield", label: "Shield" },
  { value: "diamond_sword", label: "Diamond Sword" },
  { value: "netherite_sword", label: "Netherite Sword" },
  { value: "diamond_pickaxe", label: "Diamond Pickaxe" },
  { value: "elytra", label: "Elytra" },
  { value: "firework_rocket", label: "Firework Rocket" },
  { value: "torch", label: "Torch" },
  // Bedrock's id, Java's is cobweb
  { value: "web", label: "Cobweb" },
  { value: "cobblestone", label: "Cobblestone" },
  { value: "oak_log", label: "Oak Log" },
  { value: "dirt", label: "Dirt" },
  { value: "bucket", label: "Bucket" },
  { value: "water_bucket", label: "Water Bucket" },
  { value: "lava_bucket", label: "Lava Bucket" },
  { value: "saddle", label: "Saddle" },
  { value: "name_tag", label: "Name Tag" },
  { value: "experience_bottle", label: "Bottle o' Enchanting" },
  { value: "egg", label: "Egg" },
  { value: "snowball", label: "Snowball" },
];

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

const STATUS_TEXT: Record<GameStatus["state"], string> = {
  off: "Off",
  waiting: "Waiting for Minecraft",
  connected: "Connected",
  error: "Minecraft can't connect.",
};

// An error says why
export const statusText = (status: GameStatus) =>
  (status.state === "error" && status.error) || STATUS_TEXT[status.state];
