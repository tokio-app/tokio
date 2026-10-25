import {
  AlertTrigger,
  AppEvents,
  EMOTE_TRIGGER,
  TOKIO_EVENTS,
  TokioEventMap,
} from "../types/connector";

const USER = ["username", "handle"];
const CHAT = [...USER, "comment"];

export const AUDIO_EXTENSIONS = ["mp3", "wav", "ogg"];

// Also the Minecraft pictures', which are images only
export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp"];
const VIDEO_EXTENSIONS = ["mp4", "webm"];
// No SVG: opened from the overlay server, its scripts would run there.
export const MEDIA_EXTENSIONS = [...IMAGE_EXTENSIONS, ...VIDEO_EXTENSIONS];

// Whether a media library file is an image or a video, by its extension
export function mediaKind(file: string): "image" | "video" | null {
  const dot = file.lastIndexOf(".");
  const ext = dot === -1 ? "" : file.slice(dot + 1).toLowerCase();
  if (VIDEO_EXTENSIONS.includes(ext)) return "video";
  return IMAGE_EXTENSIONS.includes(ext) ? "image" : null;
}

// The window loads media library files through this scheme, for thumbnails,
// and sound library files, for their lengths. main serves it in
// src/main/index.ts, and the CSP allows it.
export const MEDIA_SCHEME = "tokio-media";

export const getMediaPreviewURL = (file: string) =>
  `${MEDIA_SCHEME}:///${encodeURIComponent(file)}`;

export const getSoundPreviewURL = (file: string) =>
  `${MEDIA_SCHEME}:///sounds/${encodeURIComponent(file)}`;

// A Minecraft picture's, by its folder's path in the app folder
export const getPicturePreviewURL = (file: string) =>
  `${MEDIA_SCHEME}:///games/minecraft/${encodeURIComponent(file)}`;

// Triggers whose viewer a role can't narrow: envelopes, Super Fan Boxes and
// songs come without one, and a follow's viewer only just followed.
const NO_ROLES: AlertTrigger[] = [
  TOKIO_EVENTS.FOLLOW,
  TOKIO_EVENTS.ENVELOPE,
  TOKIO_EVENTS.SUPER_FAN_BOX,
  TOKIO_EVENTS.MUSIC_CHANGE,
];

export const takesRoles = (trigger: AlertTrigger) =>
  !NO_ROLES.includes(trigger);

// What a TTS alert's message can say, by trigger. Typed as a Record so a new
// trigger can't be left out.
export const ALERT_MESSAGE_VARIABLES: Record<AlertTrigger, string[]> = {
  [TOKIO_EVENTS.CHAT]: CHAT,
  [EMOTE_TRIGGER]: CHAT,
  [TOKIO_EVENTS.SHARE]: USER,
  [TOKIO_EVENTS.FOLLOW]: USER,
  [TOKIO_EVENTS.GIFT]: [...USER, "gift", "count"],
  [TOKIO_EVENTS.LIKE]: [...USER, "count"],
  [TOKIO_EVENTS.ENVELOPE]: [],
  [TOKIO_EVENTS.SUPER_FAN]: USER,
  [TOKIO_EVENTS.SUPER_FAN_BOX]: [],
  [TOKIO_EVENTS.SUPER_FAN_JOIN]: USER,
  [TOKIO_EVENTS.MEMBER_JOIN]: USER,
  [TOKIO_EVENTS.MUSIC_CHANGE]: ["song"],
};

// Read from the payload's shape, so emote alerts get the chat's values.
function messageValues(payload: TokioEventMap[AppEvents]) {
  const values = new Map<string, string>();
  if (typeof payload !== "object" || payload === null) return values;

  if (Array.isArray(payload)) {
    // Music Change sends the whole queue
    values.set("song", payload.find((song) => song.playing)?.title ?? "");
    return values;
  }
  if ("user" in payload) {
    values.set("username", payload.user.username);
    values.set("handle", payload.user.handle);
  }
  if ("comment" in payload) values.set("comment", payload.comment.content);
  if ("gift" in payload) {
    values.set("gift", payload.gift.name);
    values.set("count", String(payload.gift.comboCount));
  }
  if ("likeCount" in payload) values.set("count", String(payload.likeCount));
  return values;
}

/**
 * Fills a TTS alert's message, or a game action's text, with the live
 * event's values. Variables the event doesn't have stay as written.
 */
export function formatAlertMessage(
  message: string,
  payload: TokioEventMap[AppEvents],
  // Applied to each value, so viewer text can't break a game command
  escape: (value: string) => string = (value) => value,
): string {
  const values = messageValues(payload);
  return message.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = values.get(name);
    return value === undefined ? match : escape(value);
  });
}
