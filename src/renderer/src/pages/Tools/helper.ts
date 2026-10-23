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

// The triggers that add time, as rows that read "Follows [30] seconds each".
// Likes have the likes per cycle in theirs, and chat its keyword and cooldown.
// Their keys name their names in the carousel too.
export const TRIGGERS: {
  key: keyof TimerSettings["look"]["names"];
  label: string;
  rule: string;
}[] = [
  { key: "coin", label: "Coins", rule: "seconds per coin" },
  { key: "likes", label: "Likes", rule: "seconds every" },
  { key: "superfan", label: "New Super Fans", rule: "seconds each" },
  { key: "follow", label: "Follows", rule: "seconds each" },
  { key: "share", label: "Shares", rule: "seconds each" },
  { key: "chat", label: "Chat messages", rule: "seconds each" },
];
