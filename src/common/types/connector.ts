import { OverlayConfigRedux } from "./overlay";

export interface UserData {
  username: string;
  handle: string;
  profilePictures: string[];
  superfan?: boolean;
  follower?: boolean;
  moderator?: boolean;
  fanLevel?: number;
}

export interface ChatEvent {
  user: UserData;
  comment: {
    content: string;
    emotes: Emotes[];
    lang: string;
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

  // EXTERNAL - TIKTOK
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
  [TOKIO_EVENTS.CONNECTED]: { success: boolean; error?: Error };
  // reason is "ended" when the LIVE ended, "lost" when the connection dropped
  // and couldn't come back, not set when the user disconnected
  [TOKIO_EVENTS.DISCONNECTED]: { reason?: "ended" | "lost" } | undefined;
  [TOKIO_EVENTS.MUSIC_PROCCESS_ENDED]: void;

  // EXTERNAL - TIKTOK
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

// Typed as Record<AlertTrigger, ...> so a new live event can't be left out of the alert triggers.
export const ALERT_TRIGGER_LABELS: Record<AlertTrigger, string> = {
  [TOKIO_EVENTS.CHAT]: "Chat",
  [EMOTE_TRIGGER]: "Emote",
  [TOKIO_EVENTS.SHARE]: "Share",
  [TOKIO_EVENTS.FOLLOW]: "Follow",
  [TOKIO_EVENTS.GIFT]: "Gift",
  [TOKIO_EVENTS.LIKE]: "Like",
  [TOKIO_EVENTS.ENVELOPE]: "Envelope",
  [TOKIO_EVENTS.SUPER_FAN]: "Super Fan",
  [TOKIO_EVENTS.SUPER_FAN_BOX]: "Super Fan Box",
  [TOKIO_EVENTS.SUPER_FAN_JOIN]: "Super Fan Join",
  [TOKIO_EVENTS.MEMBER_JOIN]: "Member Join",
  [TOKIO_EVENTS.MUSIC_CHANGE]: "Music Change",
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
    };

export interface TokioPreviewMessage {
  action: "TOKIO_PREVIEW";
  payload: TokioPayload;
}
