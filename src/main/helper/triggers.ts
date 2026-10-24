import { Trigger } from "@/common/schemas";
import {
  AppEvents,
  EMOTE_TRIGGER,
  GiftEvent,
  TOKIO_EVENTS,
  TokioEventMap,
} from "@/common/types";
import { hasKeyword, isUser } from "@/helper/chat";

/**
 * Whether a live event sets off a trigger, an alert's or a game action's,
 * with its filters: gifts, keyword, user and emotes.
 */
export function matchesTrigger(
  trigger: Trigger,
  type: AppEvents,
  payload: TokioEventMap[AppEvents],
  // The gifts a gift event adds, see GiftStreaks
  added: number,
) {
  const chat =
    type === TOKIO_EVENTS.CHAT &&
    typeof payload === "object" &&
    payload !== null &&
    "comment" in payload
      ? payload.comment
      : null;

  // Emote triggers aren't a live event of their own, they match chats.
  if (trigger.type === EMOTE_TRIGGER) {
    if (!chat) return false;
    const { emotes } = trigger;
    return emotes.length === 0
      ? chat.emotes.length > 0
      : chat.emotes.some((emote) => emotes.includes(emote.emoteID));
  }

  if (trigger.type !== type) return false;

  if (chat) return hasKeyword(chat.content, trigger.keyword);

  if (
    (type === TOKIO_EVENTS.MEMBER_JOIN ||
      type === TOKIO_EVENTS.SUPER_FAN_JOIN) &&
    typeof payload === "object" &&
    payload !== null &&
    "user" in payload
  ) {
    return isUser(payload.user, trigger.user);
  }

  const gift = giftOf(type, payload);
  if (gift) {
    const { gifts, every_gift } = trigger;
    if (gifts.length > 0 && !gifts.includes(Number(gift.gift.id))) return false;
    // Once when the streak ends, or once for each gift sent
    return every_gift ? added > 0 : gift.gift.repeatEnd;
  }

  return true;
}

/** The event as a gift event, null for any other. */
export function giftOf(
  type: AppEvents,
  payload: TokioEventMap[AppEvents],
): GiftEvent | null {
  return type === TOKIO_EVENTS.GIFT &&
    typeof payload === "object" &&
    payload !== null &&
    "gift" in payload
    ? payload
    : null;
}
