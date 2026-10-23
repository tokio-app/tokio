import { TimerSettings, TimerStatus } from "@/common/schemas";
import { TimerData, TimerState } from "@/common/types";

// Result of the last test events sent to a test overlay
export type TestStatus = "sent" | "no-client";

export const STATUS_LABELS: Record<TestStatus, string> = {
  sent: "Test events sent.",
  "no-client": "No overlay connected with this ID.",
};

// The last TIMER from main, with the performance.now() it came at, which the
// preview counts down from
export type TimerPush = { data: TimerData; at: number };

const TIMER_LABELS: Record<TimerStatus, string> = {
  idle: "Ready",
  running: "Running",
  paused: "Paused",
  stopped: "Stopped",
};

export function timerStatusText({ status, remaining }: TimerState): string {
  if (status === "stopped" && remaining === 0) return "Time's up";
  return TIMER_LABELS[status];
}

// "5s", "1:30", "1:00:00", as the overlay shows added time
export function shortDuration(ms: number): string {
  const total = Math.round(Math.abs(ms) / 1000);
  if (total < 60) return `${total}s`;
  const pad = (n: number) => String(n).padStart(2, "0");
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = pad(total % 60);
  return hours > 0
    ? `${hours}:${pad(minutes)}:${seconds}`
    : `${minutes}:${seconds}`;
}

type Seconds = TimerSettings["seconds"];

// The triggers that add time, as rows that read "Follows [30] seconds each". Likes
// have their own row, with the likes per cycle.
export const TRIGGERS: {
  key: Exclude<keyof Seconds, "likes_every">;
  label: string;
  rule: string;
}[] = [
  { key: "coin", label: "Coins", rule: "seconds per coin" },
  { key: "likes", label: "Likes", rule: "seconds every" },
  { key: "superfan", label: "New Super Fans", rule: "seconds each" },
  { key: "superfan_box", label: "Super Fan boxes", rule: "seconds each" },
  { key: "envelope", label: "Envelopes", rule: "seconds each" },
  { key: "follow", label: "Follows", rule: "seconds each" },
  { key: "share", label: "Shares", rule: "seconds each" },
  { key: "chat", label: "Chat messages", rule: "seconds each" },
  { key: "join", label: "Viewers joining", rule: "seconds each" },
  { key: "superfan_join", label: "Super Fans joining", rule: "seconds each" },
];
