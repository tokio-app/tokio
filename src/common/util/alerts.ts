import {
  AlertTrigger,
  AppEvents,
  EMOTE_TRIGGER,
  TOKIO_EVENTS,
  TokioEventMap,
} from "@/common/types";

const USER = ["username", "handle"];
const CHAT = [...USER, "comment"];

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
 * Fills a TTS alert's message with the live event's values. Variables the
 * event doesn't have stay as written.
 */
export function formatAlertMessage(
  message: string,
  payload: TokioEventMap[AppEvents],
): string {
  const values = messageValues(payload);
  return message.replace(
    /\{(\w+)\}/g,
    (match, name: string) => values.get(name) ?? match,
  );
}
