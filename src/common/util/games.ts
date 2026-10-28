import { listOf, MessageKey, translate } from "@/common/i18n";
import type {
  GameAction,
  GameStep,
  MinecraftEdition,
  Profile,
  SavedEmote,
} from "@/common/schemas";
import {
  ALERT_TRIGGER_LABELS,
  CustomGift,
  EMOTE_TRIGGER,
  GameOverlayRow,
  TOKIO_EVENTS,
} from "@/common/types";
import bedrock from "../games/minecraft-bedrock.json";
import java from "../games/minecraft-java.json";
import { EVENT_SPRITES } from "../games/sprites";

type Names = Record<string, string>;
type Weather = Extract<GameStep, { type: "weather" }>["weather"];
type Time = Extract<GameStep, { type: "time" }>["time"];
type Hazard = Extract<GameStep, { type: "hazard" }>["hazard"];
type Help = Extract<GameStep, { type: "help" }>["help"];

// Every mob and item each edition's summon and give take, id → the name the
// game gives it in English (see .claude/skills/minecraft-lists/SKILL.md)
export const MINECRAFT_NAMES: Record<
  MinecraftEdition,
  { mobs: Names; items: Names }
> = { bedrock, java };

// Keys of the names Tokio gives its own steps, translated where they show
export const WEATHER_NAMES: Record<Weather, MessageKey> = {
  clear: "minecraft.weather.clear",
  rain: "minecraft.weather.rain",
  thunder: "minecraft.weather.thunder",
};

export const TIME_NAMES: Record<Time, MessageKey> = {
  day: "minecraft.time.day",
  noon: "minecraft.time.noon",
  night: "minecraft.time.night",
  midnight: "minecraft.time.midnight",
};

export const HAZARD_NAMES: Record<Hazard, MessageKey> = {
  tnt: "minecraft.hazard.tnt",
  tnt_ring: "minecraft.hazard.tnt_ring",
  lightning: "minecraft.hazard.lightning",
  charged_creeper: "minecraft.hazard.charged_creeper",
  evoker_fangs: "minecraft.hazard.evoker_fangs",
  anvil: "minecraft.hazard.anvil",
  harming: "minecraft.hazard.harming",
  launch: "minecraft.hazard.launch",
  launch_water: "minecraft.hazard.launch_water",
  freeze: "minecraft.hazard.freeze",
  lights_out: "minecraft.hazard.lights_out",
  dizzy: "minecraft.hazard.dizzy",
  turn_around: "minecraft.hazard.turn_around",
  random_teleport: "minecraft.hazard.random_teleport",
};

export const HELP_NAMES: Record<Help, MessageKey> = {
  netherite_armor: "minecraft.help.netherite_armor",
  heal: "minecraft.help.heal",
  regeneration: "minecraft.help.regeneration",
  absorption: "minecraft.help.absorption",
  resistance: "minecraft.help.resistance",
  fire_resistance: "minecraft.help.fire_resistance",
  speed: "minecraft.help.speed",
  jump_boost: "minecraft.help.jump_boost",
  strength: "minecraft.help.strength",
  slow_falling: "minecraft.help.slow_falling",
  water_breathing: "minecraft.help.water_breathing",
  night_vision: "minecraft.help.night_vision",
  invisibility: "minecraft.help.invisibility",
};

// The hazards an amount repeats; the rest run once, as a second anvil has no
// room and a second effect does nothing
export const REPEATED_HAZARDS: readonly Hazard[] = [
  "lightning",
  "charged_creeper",
  "evoker_fangs",
];

/**
 * The gifts' names as the language lists them with "or", at most `max` of
 * them (see listOf), null while the lists don't have any of them yet. For an
 * id in gifts twice, the first entry wins.
 */
export function giftNames(
  ids: number[],
  gifts: CustomGift[],
  language: string,
  max?: number,
): string | null {
  const names = ids.flatMap(
    (id) => gifts.find((gift) => gift.value === id)?.label ?? [],
  );
  return names.length > 0 ? listOf(language, names, { type: "or", max }) : null;
}

/**
 * The event's own text on the games overlay, in the language: the gifts'
 * names, "100 likes", chat's keyword quoted like the timer's carousel (“tnt”,
 * none without one, as its bubble says chat), or the trigger's label.
 * For an id in gifts twice, the first entry wins, so TikTok's list goes first.
 */
export function gameEventText(
  action: GameAction,
  gifts: CustomGift[],
  language: string,
) {
  const { trigger, likes_every } = action;
  const label = translate(language, ALERT_TRIGGER_LABELS[trigger.type]);
  if (trigger.type === TOKIO_EVENTS.GIFT) {
    if (trigger.gifts.length === 0) {
      return translate(language, "common.anyGift");
    }
    return giftNames(trigger.gifts, gifts, language) ?? label;
  }
  if (trigger.type === TOKIO_EVENTS.LIKE) {
    return translate(language, "minecraft.likes", { count: likes_every });
  }
  if (trigger.type === TOKIO_EVENTS.CHAT) {
    const keyword = trigger.keyword.trim();
    return keyword ? `“${keyword}”` : "";
  }
  return label;
}

/**
 * How many likes a Like action takes, shown in its heart's corner like the
 * action's count. 0 for every like, and for other events.
 */
export function gameEventCount({ trigger, likes_every }: GameAction) {
  return trigger.type === TOKIO_EVENTS.LIKE && likes_every > 1
    ? likes_every
    : 0;
}

// The first mob or item the action makes
const firstCounted = (steps: GameStep[]) =>
  steps.find((step) => step.type === "spawn" || step.type === "give");

/**
 * How many of its first mob or item the action makes, shown in its picture's
 * corner like an inventory's stack. 0 for one, or none.
 */
export function gameCount({ steps }: GameAction) {
  const amount = firstCounted(steps)?.amount ?? 0;
  return amount > 1 ? amount : 0;
}

/**
 * What the action makes, the default of its name on the games overlay:
 * "Primed TNT", "Zombie ×5, Thunder". Mobs and items as the game names them
 * in English, Tokio's own steps in the language. Commands have none.
 * With `counted`, its picture shows the first mob's or item's count, so the
 * name leaves it out: "Zombie, Thunder".
 */
export function gameStepsText(
  { edition, steps }: GameAction,
  language: string,
  counted = false,
) {
  const { mobs, items } = MINECRAFT_NAMES[edition];
  const first = counted ? firstCounted(steps) : undefined;
  const t = (key: MessageKey) => translate(language, key);
  // An id the list doesn't have names nothing, "constructor" included
  const named = (step: GameStep, name: string | undefined, amount: number) =>
    name === undefined
      ? []
      : amount > 1 && step !== first
        ? `${name} ×${amount}`
        : name;
  const listed = (names: Names, id: string) =>
    Object.hasOwn(names, id) ? names[id] : undefined;
  return steps
    .flatMap((step) => {
      if (step.type === "spawn") {
        return named(step, listed(mobs, step.mob), step.amount);
      }
      if (step.type === "give") {
        return named(step, listed(items, step.item), step.amount);
      }
      if (step.type === "weather") return t(WEATHER_NAMES[step.weather]);
      if (step.type === "time") return t(TIME_NAMES[step.time]);
      if (step.type === "hazard") {
        const repeated = REPEATED_HAZARDS.includes(step.hazard);
        return named(
          step,
          t(HAZARD_NAMES[step.hazard]),
          repeated ? step.amount : 1,
        );
      }
      if (step.type === "help") return t(HELP_NAMES[step.help]);
      return [];
    })
    .join(", ");
}

// The event's pictures: its gifts' or emotes', Tokio's own for follows,
// shares, likes, chat and Super Fans, none without any picked
export function gameEventPictures(
  action: GameAction,
  gifts: CustomGift[],
  emotes: SavedEmote[],
): string[] {
  const { trigger } = action;
  const sprite = EVENT_SPRITES[trigger.type];
  if (sprite) return [sprite];
  const pictures =
    trigger.type === TOKIO_EVENTS.GIFT
      ? trigger.gifts.map((id) => gifts.find((g) => g.value === id)?.img)
      : trigger.type === EMOTE_TRIGGER
        ? trigger.emotes.map((id) => emotes.find((e) => e.id === id)?.image)
        : [];
  // They take turns in one place, so two gifts with one picture show it once
  return [...new Set(pictures.filter((src): src is string => !!src))];
}

/**
 * The rows of the games overlay, for main to send and the Games page to
 * preview: each enabled action shown on it, with a picture or a name, in
 * order, its automatic texts in the language. mediaURL turns a Minecraft
 * picture's file into the URL that loads it.
 */
export function gameOverlayRows(
  games: Profile["games"],
  {
    gifts,
    emotes,
    mediaURL,
    language,
  }: {
    gifts: CustomGift[];
    emotes: SavedEmote[];
    mediaURL: (file: string) => string;
    language: string;
  },
): GameOverlayRow[] {
  return games.actions.flatMap((action) => {
    const { overlay } = action;
    // On its picture's corner
    const count = overlay.image ? gameCount(action) : 0;
    const name =
      overlay.name.trim() || gameStepsText(action, language, count > 0);
    if (!action.enabled || !overlay.show || (!overlay.image && !name)) {
      return [];
    }
    return [
      {
        id: action.id,
        pictures: gameEventPictures(action, gifts, emotes),
        event: overlay.event.trim() || gameEventText(action, gifts, language),
        // A chat's message shows beside its bubble
        withText: action.trigger.type === TOKIO_EVENTS.CHAT,
        eventCount: gameEventCount(action),
        image: overlay.image ? mediaURL(overlay.image.file) : null,
        name,
        count,
        column: Math.min(overlay.column, games.overlay.columns),
      },
    ];
  });
}
