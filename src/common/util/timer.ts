import { translate } from "../i18n";
import type { TimerSettings } from "../schemas/timer";

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
 * The triggers that add time, in Tools' order, as the carousel shows them:
 * the streamer's name for each (the language's when blank), counted for coins
 * and likes, and the time it adds with the multiplier. Triggers that add
 * nothing are left out.
 */
export function timerTriggers(
  { seconds, multiplier, chat, look }: TimerSettings,
  language: string,
): TimerTrigger[] {
  const name = (key: keyof typeof look.names) =>
    look.names[key].trim() || translate(language, `timer.names.${key}`);
  const keyword = chat.keyword.trim();
  const triggers: [string, number][] = [
    [`1 ${name("coin")}`, seconds.coin],
    [`${seconds.likes_every} ${name("likes")}`, seconds.likes],
    [name("superfan"), seconds.superfan],
    [name("follow"), seconds.follow],
    [name("share"), seconds.share],
    // Only messages with the keyword count, so viewers need to see it
    [keyword ? `${name("chat")} “${keyword}”` : name("chat"), seconds.chat],
  ];
  return triggers
    .filter(([, s]) => s * multiplier > 0)
    .map(([label, s]) => ({
      label: label.trim(),
      value: `+${formatAdded(s * multiplier * 1000)}`,
    }));
}
