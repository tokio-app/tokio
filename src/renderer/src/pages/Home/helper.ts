import { Alert } from "@/common/schemas";
import { ActivityUser, LiveSession } from "@/common/types";
import { formatStat } from "@/helper";

// Until main answers
export const NO_SESSION: LiveSession = {
  startedAt: null,
  totals: { followers: 0, shares: 0, gifts: 0, coins: 0 },
  activity: [],
};

const plural = (count: number, word: string) =>
  `${count} ${count === 1 ? word : `${word}s`}`;

export type Stat = { label: string; value: number };

// Short, with the exact number on hover. Dashes while offline.
export function statText(value: number, connected: boolean) {
  if (!connected) return { text: "--", title: undefined };
  const { short, full } = formatStat(value);
  return { text: short, title: full };
}

// "00:42:13". Hours keep counting past a day.
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const parts = [
    Math.floor(seconds / 3600),
    Math.floor((seconds % 3600) / 60),
    seconds % 60,
  ];
  return parts.map((n) => String(n).padStart(2, "0")).join(":");
}

// "kai joined", "kai and yui joined", "kai, yui and 3 others joined"
export function joinedText(users: ActivityUser[], count: number): string {
  const names = users.map((user) => user.name);
  const others = count - names.length;
  if (others > 0) {
    return `${names.join(", ")} and ${plural(others, "other")} joined`;
  }
  return `${names.join(" and ")} joined`;
}

// "3 of 4 alerts on"
export function alertsStatus(alerts: Alert[]): string {
  if (alerts.length === 0) return "No alerts yet";
  const on = alerts.filter((alert) => alert.enabled).length;
  return `${on} of ${plural(alerts.length, "alert")} on`;
}

// "Running · 2 overlays"
export function serverStatus(enabled: boolean, overlays: number): string {
  if (!enabled) return "Off · turn it on in Settings";
  return `Running · ${plural(overlays, "overlay")}`;
}
