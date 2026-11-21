import { translate } from "../i18n";
import type { TimerSettings } from "../schemas/timer";
import {
  TOKIO_EVENTS,
  type AlertTrigger,
  type Platform,
} from "../types/connector";
import { triggersFor } from "./platforms";

// The event each trigger of the timer counts, so a profile's platforms say
// which ones apply
export const TIMER_TRIGGERS = {
  coin: TOKIO_EVENTS.GIFT,
  likes: TOKIO_EVENTS.LIKE,
  superfan: TOKIO_EVENTS.SUPER_FAN,
  follow: TOKIO_EVENTS.FOLLOW,
  share: TOKIO_EVENTS.SHARE,
  chat: TOKIO_EVENTS.CHAT,
  sub: TOKIO_EVENTS.SUBSCRIBE,
  gift_sub: TOKIO_EVENTS.GIFT_SUB,
  bit: TOKIO_EVENTS.CHEER,
} as const satisfies Record<keyof TimerSettings["look"]["names"], AlertTrigger>;

// "5s", "0.5s", "1:30", "1:00:00", as the countdown timer shows time added.
// The sign is the caller's.
export function formatAdded(ms: number): string {
  const seconds = Math.abs(ms) / 1000;
  // Tenths under 10 s, so 0.5 s per coin doesn't read as 1 s
  if (seconds < 10) return `${Math.round(seconds * 10) / 10}s`;
  const total = Math.round(seconds);
  if (total < 60) return `${total}s`;
  const pad = (n: number) => String(n).padStart(2, "0");
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return hours > 0
    ? `${hours}:${pad(minutes)}:${pad(total % 60)}`
    : `${minutes}:${pad(total % 60)}`;
}

// A trigger in the timer overlay's carousel: "Follow", "+1:00"
export interface TimerTrigger {
  label: string;
  value: string;
}

/**
 * The triggers that add time, in the timer page's order, as the carousel shows them:
 * the streamer's name for each (the language's when blank), counted for coins,
 * likes and Bits, and the time it adds with the multiplier. Triggers that add
 * nothing, or that none of the profile's platforms send, are left out.
 */
export function timerTriggers(
  { seconds, multiplier, chat, look }: TimerSettings,
  language: string,
  // TikTok alone until a caller passes the profile's
  platforms: readonly Platform[] = ["tiktok"],
): TimerTrigger[] {
  const sent = triggersFor(platforms);
  const name = (key: keyof typeof look.names) =>
    look.names[key].trim() || translate(language, `timer.names.${key}`);
  const keyword = chat.keyword.trim();
  const triggers: [keyof typeof TIMER_TRIGGERS, string, number][] = [
    ["coin", `1 ${name("coin")}`, seconds.coin],
    ["likes", `${seconds.likes_every} ${name("likes")}`, seconds.likes],
    ["superfan", name("superfan"), seconds.superfan],
    ["follow", name("follow"), seconds.follow],
    ["share", name("share"), seconds.share],
    // Only messages with the keyword count, so viewers need to see it
    [
      "chat",
      keyword ? `${name("chat")} “${keyword}”` : name("chat"),
      seconds.chat,
    ],
    ["sub", name("sub"), seconds.sub],
    ["gift_sub", name("gift_sub"), seconds.gift_sub],
    ["bit", `1 ${name("bit")}`, seconds.bit],
  ];
  return triggers
    .filter(
      ([key, , s]) => s * multiplier > 0 && sent.includes(TIMER_TRIGGERS[key]),
    )
    .map(([, label, s]) => ({
      label: label.trim(),
      value: `+${formatAdded(s * multiplier * 1000)}`,
    }));
}
