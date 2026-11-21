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
};

// Their names, the platforms' own, never translated
export const PLATFORM_LABELS: Record<Platform, string> = {
  tiktok: "TikTok",
  twitch: "Twitch",
};

// What a profile types for each on Home: a channel's name, or nothing for
// the account signed in to in Settings
export const PLATFORM_INPUT: Record<Platform, "channel" | "account"> = {
  tiktok: "channel",
  twitch: "account",
};

export const isPlatform = (value: unknown): value is Platform =>
  PLATFORMS.includes(value as Platform);

// The platform a viewer is on: missing means TikTok
export const platformOf = (user?: Pick<UserData, "platform"> | null) =>
  user?.platform ?? "tiktok";

// The platforms a trigger comes from, none for Music change
export const platformsOf = (trigger: AlertTrigger): Platform[] =>
  PLATFORMS.filter((platform) => PLATFORM_TRIGGERS[platform].includes(trigger));

/**
 * The triggers any of the platforms sends, in ALERT_TRIGGERS' order, with
 * Music change, which comes from Tokio.
 */
export const triggersFor = (platforms: readonly Platform[]): AlertTrigger[] =>
  ALERT_TRIGGERS.filter((trigger) => {
    const from = platformsOf(trigger);
    return from.length === 0 || from.some((p) => platforms.includes(p));
  });
