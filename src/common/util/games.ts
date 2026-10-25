import type { GameAction, Profile, SavedEmote } from "@/common/schemas";
import {
  ALERT_TRIGGER_LABELS,
  CustomGift,
  EMOTE_TRIGGER,
  GameOverlayRow,
  TOKIO_EVENTS,
} from "@/common/types";

// As many as the gift picker's field shows
const MAX_PICTURES = 3;

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
  return pictures.filter((src): src is string => !!src).slice(0, MAX_PICTURES);
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
    const name = overlay.name.trim();
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
        column: Math.min(overlay.column, games.overlay.columns),
      },
    ];
  });
}
