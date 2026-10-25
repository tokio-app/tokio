import { Trigger } from "@/common/schemas";
import {
  AppEvents,
  EMOTE_TRIGGER,
  GiftEvent,
  TOKIO_EVENTS,
  TokioEventMap,
} from "@/common/types";
import { takesRoles } from "@/common/util";
import { hasKeyword, isUser } from "@/helper/chat";

/**
 * Whether a live event sets off a trigger, an alert's or a game action's,
 * with its filters: gifts and their coins, keyword, user, emotes and the
 * viewer's roles.
 */
export function matchesTrigger(
  trigger: Trigger,
  type: AppEvents,
  payload: TokioEventMap[AppEvents],
  // The gifts a gift event adds, and the streak's count so far, see
  // GiftStreaks
  added: number,
  total: number,
) {
  const user =
    typeof payload === "object" && payload !== null && "user" in payload
      ? payload.user
      : null;
  const { roles } = trigger;
  const narrowed = roles.length > 0 && takesRoles(trigger.type);
  if (user && narrowed && !roles.some((role) => user[role])) return false;

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
    user
  ) {
    return isUser(user, trigger.user);
  }

  const gift = giftOf(type, payload);
  if (gift) {
    const { gifts, every_gift, min_coins } = trigger;
    const { id, coins, repeatEnd } = gift.gift;
    if (gifts.length > 0 && !gifts.includes(Number(id))) return false;
    // Each gift's worth, or the whole streak's when it ends, for any gift
    const worth = every_gift ? coins : coins * total;
    if (gifts.length === 0 && worth < min_coins) return false;
    // Once when the streak ends, or once for each gift sent
    return every_gift ? added > 0 : repeatEnd;
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
