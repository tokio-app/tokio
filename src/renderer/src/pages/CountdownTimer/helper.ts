import { MessageKey, translate } from "@/common/i18n";
import { TimerSettings, TimerStatus } from "@/common/schemas";
import { TimerData, TimerState } from "@/common/types";

// The last TIMER from main, with the performance.now() it came at, which the
// preview counts down from
export type TimerPush = { data: TimerData; at: number };

/**
 * The ms left on the clock at `now` (a performance.now()): the starting time
 * in minutes while idle, counted down from the push while running.
 */
export function timeLeft(timer: TimerPush, start: number, now: number) {
  const { state } = timer.data;
  if (state.status === "idle") return start * 60_000;
  if (state.status !== "running") return state.remaining;
  return Math.max(0, state.remaining - Math.max(0, now - timer.at));
}

const TIMER_LABELS: Record<TimerStatus, MessageKey> = {
  idle: "tools.timer.idle",
  running: "tools.timer.running",
  paused: "tools.timer.paused",
  stopped: "tools.timer.stopped",
};

export function timerStatusText(
  { status, remaining }: TimerState,
  language: string,
): string {
  if (status === "stopped" && remaining === 0) {
    return translate(language, "tools.timer.timeUp");
  }
  return translate(language, TIMER_LABELS[status]);
}

// The triggers that add time, as rows that read "Follows [30] seconds each".
// Likes have the likes per cycle in theirs, and chat its keyword and cooldown.
// Their keys name their names in the carousel too.
export const TRIGGERS: {
  key: keyof TimerSettings["look"]["names"];
  label: MessageKey;
  // With the seconds field as {input}, and the likes per cycle as {likes}
  rule: MessageKey;
}[] = [
  { key: "coin", label: "tools.triggers.coin", rule: "tools.rules.perCoin" },
  { key: "likes", label: "tools.triggers.likes", rule: "tools.rules.likes" },
  {
    key: "superfan",
    label: "tools.triggers.superfan",
    rule: "tools.rules.each",
  },
  { key: "follow", label: "tools.triggers.follow", rule: "tools.rules.each" },
  { key: "share", label: "tools.triggers.share", rule: "tools.rules.each" },
  { key: "chat", label: "tools.triggers.chat", rule: "tools.rules.each" },
];
