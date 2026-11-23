import type { MessageKey } from "../i18n";
import { OverlayConfigRedux } from "./overlay";

// The platforms Tokio connects to, in the order Home lists them. A new one
// gets its provider, its row in PLATFORM_TRIGGERS and its texts.
export const PLATFORMS = ["tiktok", "twitch", "youtube", "kick"] as const;
export type Platform = (typeof PLATFORMS)[number];

// How a platform's connection is doing while it's on: connecting, connected,
// coming back after a drop, or looking for a LIVE that stopped on its own
export type PlatformStatus =
  "connecting" | "connected" | "reconnecting" | "waiting";

export interface UserData {
  username: string;
  handle: string;
  profilePictures: string[];
  superfan?: boolean;
  follower?: boolean;
  moderator?: boolean;
  fanLevel?: number;
  // The picture of the fan level's badge, a heart that changes every 10
  // levels, without the number
  fanBadge?: string;
  // The platform's id for the account, which stays when the handle changes.
  // Other platforms' start with their name ("twitch:1234"), so they never
  // match TikTok's, which are saved bare.
  userId?: string;
  // Where the viewer is. Missing means TikTok, as everything sent or saved
  // before other platforms.
  platform?: Platform;
  // How long they've been subscribed (Twitch, Kick) or a member (YouTube), in
  // months, when their chat badge says so. YouTube's badge says only its
  // milestone: 1 year is 12.
  subMonths?: number;
}

// A fan the active profile keeps: TikTok's fan club, by level, and the other
// platforms' subscribers (Twitch, Kick) and members (YouTube). Overlays get
// TikTok's with tokio:fans. No profile picture: TikTok's links expire within
// days. The badge's don't.
export interface Fan {
  userId: string;
  username: string;
  handle: string;
  // TikTok's; 0 on the other platforms
  fanLevel: number;
  fanBadge: string;
  // A Super Fan subscriber, as their last chat, gift or Super Fan event said.
  // Always true on the other platforms, whose fans are their subscribers.
  superfan: boolean;
  // Months subscribed or a member, on the other platforms, when known
  months?: number;
  // When they were last seen in a LIVE, in ms since the epoch
  seenAt: number;
  // Missing means TikTok
  platform?: Platform;
}

// A viewer in tokio:gifters' top 10s, with their coins and gifts in this LIVE
// (0 when they sent none in it) and in all the profile's LIVEs, this one
// included. Coins are in their platform's gift currency: TikTok's coins or
// Kick's Kicks.
export interface TopGifter {
  userId: string;
  username: string;
  handle: string;
  // TikTok's link from their latest gift, which can expire. Empty when TikTok
  // sent none.
  picture: string;
  live: { coins: number; gifts: number };
  allTime: { coins: number; gifts: number };
  // When their last gift came, in ms since the epoch
  giftedAt: number;
  // Missing means TikTok
  platform?: Platform;
}

// A chat message translated into the language Settings → Chat translation
// picked. Codes are lowercase BCP 47 tags, like "en" and "zh-hans".
export interface ChatTranslation {
  text: string;
  // The language the engine read
  from: string;
  to: string;
}

export interface ChatEvent {
  user: UserData;
  comment: {
    // As the viewer typed it. Emotes' indexes point into it.
    content: string;
    emotes: Emotes[];
    lang: string;
    // Only when it was translated: Chat translation is on, and TikTok tagged
    // the message with another language
    translation?: ChatTranslation;
  };
}

export type RoomUserEvent = {
  ranks: (UserData & { score: number; position: number })[];
  views: number;
  viewers: number;
};

export interface Emotes {
  emoteID: string;
  index: number;
  images: string[];
}

export interface ShareEvent {
  shareCount: number;
  user: UserData;
}

interface SingleUserEvent {
  user: UserData;
}

export type FollowEvent = SingleUserEvent;

export type SuperFanEvent = SingleUserEvent;

export type MemberEvent = SingleUserEvent;

export type SuperFanJoinEvent = SingleUserEvent;

export interface GiftEvent {
  user: UserData;
  gift: {
    id: string;
    coins: number;
    repeatEnd: boolean;
    type: number;
    name: string;
    comboCount: number;
    image: string;
  };
}

export interface LikeEvent {
  user: UserData;
  likeCount: number;
  totalLikes: number;
}

// A paid subscription or membership, new or renewed
export interface SubscribeEvent {
  user: UserData;
  // The platform's own tier, like Twitch's "1000", "2000", "3000" or "prime";
  // "" when it has none
  tier: string;
  // Months subscribed so far, 1 for a new one
  months: number;
  // What the viewer wrote with it, "" for nothing
  message: string;
}

// Subscriptions or memberships a viewer gave to others, all at once
export interface GiftSubEvent {
  user: UserData;
  count: number;
  tier: string;
}

// Bits a viewer spent on Twitch: a cheer, or a Power-up
export interface CheerEvent {
  user: UserData;
  bits: number;
  // A cheer's message without its cheermotes, "" for none
  message: string;
}

// Another channel sending its viewers over: the user is its streamer
export interface RaidEvent {
  user: UserData;
  viewers: number;
}

// A channel points reward a viewer redeemed
export interface RedeemEvent {
  user: UserData;
  reward: { id: string; title: string; cost: number };
  // What the reward asked the viewer to type, "" for none
  input: string;
}

// A Super Chat or Super Sticker a viewer bought on YouTube
export interface SuperChatEvent {
  user: UserData;
  // As YouTube shows it, in the viewer's currency: "$5.00", "MX$100.00"
  amount: string;
  // What the viewer wrote, "" for none or a sticker
  message: string;
  // A Super Sticker's picture, "" for a Super Chat
  sticker: string;
  // In US dollars at the day's exchange rates; null or missing when the
  // amount can't be read or the rates haven't loaded
  usd?: number | null;
}

export interface Gift {
  id: number;
  name: string;
  coins: number;
  image: string;
}

export enum TOKIO_EVENTS {
  // INTERNAL
  CONNECTED = "tokio:event:connected",
  DISCONNECTED = "tokio:event:disconnected",
  MUSIC_PROCCESS_ENDED = "tokio:event:music:ended",

  // EXTERNAL - TikTok's names, also for other platforms' events like them
  // (PLATFORM_TRIGGERS says who sends each)
  CHAT = "tokio:event:chat",
  SHARE = "tokio:event:share",
  FOLLOW = "tokio:event:follow",
  GIFT = "tokio:event:gift",
  LIKE = "tokio:event:like",
  ENVELOPE = "tokio:event:envelope",
  SUPER_FAN = "tokio:event:superfan",
  SUPER_FAN_BOX = "tokio:event:superfanbox",
  SUPER_FAN_JOIN = "tokio:event:superfanjoin",
  MEMBER_JOIN = "tokio:event:memberjoin",
  ROOM_USER = "tokio:event:roomuser",

  // EXTERNAL - TikTok has none of these
  SUBSCRIBE = "tokio:event:subscribe",
  GIFT_SUB = "tokio:event:giftsub",
  CHEER = "tokio:event:cheer",
  RAID = "tokio:event:raid",
  REDEEM = "tokio:event:redeem",
  SUPER_CHAT = "tokio:event:superchat",

  // EXTERNAL - MUSIC
  MUSIC_CHANGE = "tokio:event:music:change",
}

export type MusicInfo = {
  title: string;
  thumbnail: string;
  playing: boolean;
  played: boolean;
};

export interface TokioEventMap {
  // INTERNAL
  // Only for a connect that worked; a failed one is connect()'s result
  [TOKIO_EVENTS.CONNECTED]: void;
  // reason is "ended" when the LIVE ended, "lost" when the connection dropped
  // and couldn't come back, not set when the user disconnected
  [TOKIO_EVENTS.DISCONNECTED]: { reason?: "ended" | "lost" } | undefined;
  [TOKIO_EVENTS.MUSIC_PROCCESS_ENDED]: void;

  // EXTERNAL
  [TOKIO_EVENTS.CHAT]: ChatEvent;
  [TOKIO_EVENTS.SHARE]: ShareEvent;
  [TOKIO_EVENTS.FOLLOW]: FollowEvent;
  [TOKIO_EVENTS.GIFT]: GiftEvent;
  [TOKIO_EVENTS.LIKE]: LikeEvent;
  [TOKIO_EVENTS.ENVELOPE]: void;
  [TOKIO_EVENTS.SUPER_FAN_BOX]: void;
  [TOKIO_EVENTS.SUPER_FAN]: SuperFanEvent;
  [TOKIO_EVENTS.MEMBER_JOIN]: MemberEvent;
  [TOKIO_EVENTS.SUPER_FAN_JOIN]: SuperFanJoinEvent;
  [TOKIO_EVENTS.ROOM_USER]: RoomUserEvent;
  [TOKIO_EVENTS.SUBSCRIBE]: SubscribeEvent;
  [TOKIO_EVENTS.GIFT_SUB]: GiftSubEvent;
  [TOKIO_EVENTS.CHEER]: CheerEvent;
  [TOKIO_EVENTS.RAID]: RaidEvent;
  [TOKIO_EVENTS.REDEEM]: RedeemEvent;
  [TOKIO_EVENTS.SUPER_CHAT]: SuperChatEvent;

  // EXTERNAL - MUSIC
  [TOKIO_EVENTS.MUSIC_CHANGE]: MusicInfo[];
}

export type AppEvents = Exclude<
  TOKIO_EVENTS,
  | TOKIO_EVENTS.CONNECTED
  | TOKIO_EVENTS.DISCONNECTED
  | TOKIO_EVENTS.MUSIC_PROCCESS_ENDED
>;

const INTERNAL_EVENTS: TOKIO_EVENTS[] = [
  TOKIO_EVENTS.CONNECTED,
  TOKIO_EVENTS.DISCONNECTED,
  TOKIO_EVENTS.MUSIC_PROCCESS_ENDED,
];

// Live events reach overlays; internal ones stay in the app.
export const isLiveEvent = (event: TOKIO_EVENTS): event is AppEvents =>
  !INTERNAL_EVENTS.includes(event);

// An alert trigger that isn't a live event: chat messages with emotes.
export const EMOTE_TRIGGER = "tokio:alert:emote";

// Room Users isn't one: it comes every few seconds and is meant for overlays.
// Keep it in sync with the exclude list of AlertTriggerSchema.
export type AlertTrigger =
  Exclude<AppEvents, TOKIO_EVENTS.ROOM_USER> | typeof EMOTE_TRIGGER;

// Typed as Record<AlertTrigger, ...> so a new live event can't be left out of
// the alert triggers. Keys of their names, translated where they're shown.
export const ALERT_TRIGGER_LABELS: Record<AlertTrigger, MessageKey> = {
  [TOKIO_EVENTS.CHAT]: "triggers.chat",
  [EMOTE_TRIGGER]: "triggers.emote",
  [TOKIO_EVENTS.SHARE]: "triggers.share",
  [TOKIO_EVENTS.FOLLOW]: "triggers.follow",
  [TOKIO_EVENTS.GIFT]: "triggers.gift",
  [TOKIO_EVENTS.LIKE]: "triggers.like",
  [TOKIO_EVENTS.ENVELOPE]: "triggers.envelope",
  [TOKIO_EVENTS.SUPER_FAN]: "triggers.superfan",
  [TOKIO_EVENTS.SUPER_FAN_BOX]: "triggers.superfanBox",
  [TOKIO_EVENTS.SUPER_FAN_JOIN]: "triggers.superfanJoin",
  [TOKIO_EVENTS.MEMBER_JOIN]: "triggers.memberJoin",
  [TOKIO_EVENTS.SUBSCRIBE]: "triggers.subscribe",
  [TOKIO_EVENTS.GIFT_SUB]: "triggers.giftSub",
  [TOKIO_EVENTS.CHEER]: "triggers.cheer",
  [TOKIO_EVENTS.RAID]: "triggers.raid",
  [TOKIO_EVENTS.REDEEM]: "triggers.redeem",
  [TOKIO_EVENTS.SUPER_CHAT]: "triggers.superChat",
  [TOKIO_EVENTS.MUSIC_CHANGE]: "triggers.musicChange",
};

export type TokioPayload =
  | {
      [K in AppEvents]: {
        type: K;
        data: TokioEventMap[K];
      };
    }[AppEvents]
  | {
      type: "tokio:config";
      data: OverlayConfigRedux;
    }
  | {
      type: "tokio:fans";
      data: { fans: Fan[] };
    }
  // live is empty while Tokio isn't connected
  | {
      type: "tokio:gifters";
      data: { live: TopGifter[]; allTime: TopGifter[] };
    };

export interface TokioPreviewMessage {
  action: "TOKIO_PREVIEW";
  payload: TokioPayload;
}
