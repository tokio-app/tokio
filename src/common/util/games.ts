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

type Names = Record<string, string>;
type Weather = Extract<GameStep, { type: "weather" }>["weather"];
type Time = Extract<GameStep, { type: "time" }>["time"];

// Every mob and item each edition's summon and give take, id → the name the
// game gives it in English (see .claude/rules/games.md)
export const MINECRAFT_NAMES: Record<
  MinecraftEdition,
  { mobs: Names; items: Names }
> = { bedrock, java };

export const WEATHER_NAMES: Record<Weather, string> = {
  clear: "Clear",
  rain: "Rain",
  thunder: "Thunder",
};

export const TIME_NAMES: Record<Time, string> = {
  day: "Day",
  noon: "Noon",
  night: "Night",
  midnight: "Midnight",
};

/**
 * The event's own text on the games overlay: the gifts' names, "100 likes",
 * Chat “tnt” (quoted like the timer's carousel), or the trigger's label.
 * For an id in gifts twice, the first entry wins, so TikTok's list goes first.
 */
export function gameEventText(action: GameAction, gifts: CustomGift[]) {
  const { trigger, likes_every } = action;
  const label = ALERT_TRIGGER_LABELS[trigger.type];
  if (trigger.type === TOKIO_EVENTS.GIFT) {
    if (trigger.gifts.length === 0) return "Any gift";
    const names = trigger.gifts.flatMap(
      (id) => gifts.find((gift) => gift.value === id)?.label ?? [],
    );
    // Gifts the lists don't have yet, until they load
    return names.length > 0 ? names.join(" or ") : label;
  }
  if (trigger.type === TOKIO_EVENTS.LIKE) {
    return `${likes_every} ${likes_every === 1 ? "like" : "likes"}`;
  }
  const keyword =
    trigger.type === TOKIO_EVENTS.CHAT ? trigger.keyword.trim() : "";
  return keyword ? `${label} “${keyword}”` : label;
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
 * What the action makes, as the game names it, the default of its name on
 * the games overlay: "Primed TNT", "Zombie ×5, Thunder". Commands have none.
 * With `counted`, its picture shows the first mob's or item's count, so the
 * name leaves it out: "Zombie, Thunder".
 */
export function gameStepsText({ edition, steps }: GameAction, counted = false) {
  const { mobs, items } = MINECRAFT_NAMES[edition];
  const first = counted ? firstCounted(steps) : undefined;
  // An id the list doesn't have names nothing, "constructor" included
  const named = (step: GameStep, names: Names, id: string, amount: number) =>
    !Object.hasOwn(names, id)
      ? []
      : amount > 1 && step !== first
        ? `${names[id]} ×${amount}`
        : names[id];
  return steps
    .flatMap((step) => {
      if (step.type === "spawn")
        return named(step, mobs, step.mob, step.amount);
      if (step.type === "give")
        return named(step, items, step.item, step.amount);
      if (step.type === "weather") return WEATHER_NAMES[step.weather];
      if (step.type === "time") return TIME_NAMES[step.time];
      return [];
    })
    .join(", ");
}

// The event's pictures: its gifts' or emotes', none for other events
export function gameEventPictures(
  action: GameAction,
  gifts: CustomGift[],
  emotes: SavedEmote[],
): string[] {
  const { trigger } = action;
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
 * order. mediaURL turns a Minecraft picture's file into the URL that loads it.
 */
export function gameOverlayRows(
  games: Profile["games"],
  {
    gifts,
    emotes,
    mediaURL,
  }: {
    gifts: CustomGift[];
    emotes: SavedEmote[];
    mediaURL: (file: string) => string;
  },
): GameOverlayRow[] {
  return games.actions.flatMap((action) => {
    const { overlay } = action;
    // On its picture's corner
    const count = overlay.image ? gameCount(action) : 0;
    const name = overlay.name.trim() || gameStepsText(action, count > 0);
    if (!action.enabled || !overlay.show || (!overlay.image && !name)) {
      return [];
    }
    return [
      {
        id: action.id,
        pictures: gameEventPictures(action, gifts, emotes),
        event: overlay.event.trim() || gameEventText(action, gifts),
        image: overlay.image ? mediaURL(overlay.image.file) : null,
        name,
        count,
        column: Math.min(overlay.column, games.overlay.columns),
      },
    ];
  });
}
