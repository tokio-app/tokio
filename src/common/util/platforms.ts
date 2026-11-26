import { ALERT_TRIGGERS } from "../schemas/profile";
import {
  EMOTE_TRIGGER,
  PLATFORMS,
  TOKIO_EVENTS,
  type AlertTrigger,
  type Platform,
  type UserData,
} from "../types/connector";

// The triggers each platform sends, a row each so a new platform adds only
// its own. Music change comes from Tokio's music, not from a platform.
export const PLATFORM_TRIGGERS: Record<Platform, readonly AlertTrigger[]> = {
  tiktok: [
    TOKIO_EVENTS.CHAT,
    EMOTE_TRIGGER,
    TOKIO_EVENTS.SHARE,
    TOKIO_EVENTS.FOLLOW,
    TOKIO_EVENTS.GIFT,
    TOKIO_EVENTS.LIKE,
    TOKIO_EVENTS.ENVELOPE,
    TOKIO_EVENTS.SUPER_FAN,
    TOKIO_EVENTS.SUPER_FAN_BOX,
    TOKIO_EVENTS.SUPER_FAN_JOIN,
    TOKIO_EVENTS.MEMBER_JOIN,
  ],
  twitch: [
    TOKIO_EVENTS.CHAT,
    EMOTE_TRIGGER,
    TOKIO_EVENTS.FOLLOW,
    TOKIO_EVENTS.SUBSCRIBE,
    TOKIO_EVENTS.GIFT_SUB,
    TOKIO_EVENTS.CHEER,
    TOKIO_EVENTS.RAID,
    TOKIO_EVENTS.REDEEM,
  ],
  // Gifts are YouTube's Gifts (Jewels), subscriptions its memberships
  youtube: [
    TOKIO_EVENTS.CHAT,
    EMOTE_TRIGGER,
    TOKIO_EVENTS.GIFT,
    TOKIO_EVENTS.SUBSCRIBE,
    TOKIO_EVENTS.GIFT_SUB,
    TOKIO_EVENTS.SUPER_CHAT,
  ],
  // Kicks are its money, like Twitch's Bits, and raids its hosts; its chat
  // feed carries no follows
  kick: [
    TOKIO_EVENTS.CHAT,
    EMOTE_TRIGGER,
    TOKIO_EVENTS.KICKS,
    TOKIO_EVENTS.SUBSCRIBE,
    TOKIO_EVENTS.GIFT_SUB,
    TOKIO_EVENTS.RAID,
    TOKIO_EVENTS.REDEEM,
  ],
};

// Their names, the platforms' own, never translated
export const PLATFORM_LABELS: Record<Platform, string> = {
  tiktok: "TikTok",
  twitch: "Twitch",
  youtube: "YouTube",
  kick: "Kick",
};

// What a profile types for each on Home: a channel's name, or nothing for
// the account signed in to in Settings
export const PLATFORM_INPUT: Record<Platform, "channel" | "account"> = {
  tiktok: "channel",
  twitch: "account",
  youtube: "channel",
  kick: "channel",
};

// The currencies gifts are priced in
const GIFT_CURRENCIES = ["coins"] as const;
export type GiftCurrency = (typeof GIFT_CURRENCIES)[number];

// What each platform's gifts cost in: TikTok's coins. YouTube's Gifts say no
// price, and Twitch and Kick send none: their Bits and Kicks are events of
// their own (the user's call).
export const GIFT_CURRENCY: Record<Platform, GiftCurrency | null> = {
  tiktok: "coins",
  twitch: null,
  youtube: null,
  kick: null,
};

// What viewers spend on each platform, each counted on its own and never
// added to another (the user's call): TikTok's coins (its gifts' prices),
// Kick's Kicks, Twitch's Bits (cheers) and YouTube's Super Chats in US
// dollars
export type Currency = GiftCurrency | "kicks" | "bits" | "usd";
export const PLATFORM_CURRENCY: Record<Platform, Currency> = {
  tiktok: "coins",
  twitch: "bits",
  youtube: "usd",
  kick: "kicks",
};

// The gift currencies the platforms pay in, in GIFT_CURRENCIES' order
export const giftCurrencies = (platforms: readonly Platform[]) =>
  GIFT_CURRENCIES.filter((currency) =>
    platforms.some((p) => GIFT_CURRENCY[p] === currency),
  );

export const isPlatform = (value: unknown): value is Platform =>
  (PLATFORMS as readonly unknown[]).includes(value);

// The platform a viewer is on: missing means TikTok
export const platformOf = (user?: Pick<UserData, "platform"> | null) =>
  user?.platform ?? "tiktok";

type OnPlatform = Pick<UserData, "platform">;

// Counts each platform's items as it's called, giving the one's place
export const placer = () => {
  const places = new Map<Platform, number>();
  return (item: OnPlatform) => {
    const platform = platformOf(item);
    const place = (places.get(platform) ?? 0) + 1;
    places.set(platform, place);
    return place;
  };
};

// The items within their platform's first `count`, in their order
export const topOfEach = <T extends OnPlatform>(items: T[], count: number) => {
  const place = placer();
  return items.filter((item) => place(item) <= count);
};

// The platforms a trigger comes from, none for Music change
export const platformsOf = (trigger: AlertTrigger): Platform[] =>
  PLATFORMS.filter((platform) => PLATFORM_TRIGGERS[platform].includes(trigger));

// An id's platform, from its prefix ("twitch:25", "kick:"): the other
// platforms namespace theirs, TikTok's are bare
export const idPlatform = (id: string): Platform => {
  const prefix = id.slice(0, Math.max(0, id.indexOf(":")));
  return isPlatform(prefix) ? prefix : "tiktok";
};

/**
 * The platforms a trigger row covers: its own, else the profile's that send
 * its event. The emotes, roles and variables it offers follow them.
 */
export const rowPlatforms = (
  row: { type: AlertTrigger; platform?: Platform },
  profilePlatforms: readonly Platform[],
): Platform[] =>
  row.platform
    ? [row.platform]
    : platformsOf(row.type).filter((p) => profilePlatforms.includes(p));

/**
 * The triggers any of the platforms sends, in ALERT_TRIGGERS' order, with
 * Music change, which comes from Tokio.
 */
export const triggersFor = (platforms: readonly Platform[]): AlertTrigger[] =>
  ALERT_TRIGGERS.filter((trigger) => {
    const from = platformsOf(trigger);
    return from.length === 0 || from.some((p) => platforms.includes(p));
  });

/**
 * The event a new alert, game action or Studio element starts on: Follow
 * where the profile's platforms send follows, else a subscription, which
 * YouTube's memberships and Kick's subs are. Never one they can't send.
 */
export const newRowTrigger = (platforms: readonly Platform[]): AlertTrigger =>
  triggersFor(platforms).includes(TOKIO_EVENTS.FOLLOW)
    ? TOKIO_EVENTS.FOLLOW
    : TOKIO_EVENTS.SUBSCRIBE;
