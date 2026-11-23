import { Trigger } from "@/common/schemas";
import {
  AppEvents,
  EMOTE_TRIGGER,
  GiftEvent,
  TOKIO_EVENTS,
  TokioEventMap,
  UserData,
} from "@/common/types";
import { platformOf, takesRoles } from "@/common/util";
import { hasKeyword, isUser } from "@/helper/chat";
import type { GiftStreaks } from "@/helper/streaks";

/**
 * Whether a live event sets off a trigger, an alert's or a game action's,
 * with its filters: gifts and their coins, keyword, user, emotes, the
 * viewer's roles, and Bits', Super Chats' and gifted subs' minimums.
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
  const user = eventUser(payload);
  // Events without a viewer are TikTok's, but Music change is Tokio's own,
  // so only a trigger for any platform takes it
  if (trigger.platform) {
    if (type === TOKIO_EVENTS.MUSIC_CHANGE) return false;
    if (platformOf(user) !== trigger.platform) return false;
  }
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

  // A redeem's keyword is the reward's title, in any case
  if (type === TOKIO_EVENTS.REDEEM && payload && "reward" in payload) {
    const title = trigger.keyword.trim().toLowerCase();
    return !title || payload.reward.title.trim().toLowerCase() === title;
  }

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

  // Bits, Super Chats and gifted subs have a minimum in their own unit
  const worth = worthOf(type, payload);
  return worth === null || worth >= trigger.min_coins;
}

/**
 * A Bits, Super Chat or gift sub event's worth in its row's minimum: its
 * Bits, US dollars or subs. Null for other events, and for a Super Chat
 * without dollars, so a missing rate never silences it.
 */
function worthOf(
  type: AppEvents,
  payload: TokioEventMap[AppEvents],
): number | null {
  if (typeof payload !== "object" || payload === null) return null;
  if (type === TOKIO_EVENTS.CHEER && "bits" in payload) return payload.bits;
  if (type === TOKIO_EVENTS.SUPER_CHAT && "sticker" in payload) {
    return payload.usd ?? null;
  }
  if (
    type === TOKIO_EVENTS.GIFT_SUB &&
    "tier" in payload &&
    "count" in payload
  ) {
    return payload.count;
  }
  return null;
}

/**
 * The viewer a live event came from, null for the ones without one (a music
 * change, an envelope, a super fan box).
 */
export function eventUser(payload: TokioEventMap[AppEvents]): UserData | null {
  return typeof payload === "object" && payload !== null && "user" in payload
    ? payload.user
    : null;
}

/**
 * Counts a gift event in its streak, once per event. values is the payload
 * with the streak's count so far as {count}, not TikTok's; any other event
 * adds nothing and keeps its payload.
 */
export function streakOf(
  streaks: GiftStreaks,
  type: AppEvents,
  payload: TokioEventMap[AppEvents],
): { added: number; total: number; values: TokioEventMap[AppEvents] } {
  const gift = giftOf(type, payload);
  if (!gift) return { added: 0, total: 0, values: payload };
  const { added, total } = streaks.add(gift);
  return {
    added,
    total,
    values: { ...gift, gift: { ...gift.gift, comboCount: total } },
  };
}

// The event as a gift event, null for any other
function giftOf(
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
