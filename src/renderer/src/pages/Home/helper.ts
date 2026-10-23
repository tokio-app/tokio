import { ActivityFeed, Alert } from "@/common/schemas";
import { ActivityUser, LiveSession } from "@/common/types";
import { formatStat } from "@/helper";

// Until main answers
export const NO_SESSION: LiveSession = {
  startedAt: null,
  totals: { followers: 0, shares: 0, gifts: 0, coins: 0 },
  activity: [],
};

// The kinds of events the feed can show, as its settings list them
export const FEED_KINDS: { kind: keyof ActivityFeed; label: string }[] = [
  { kind: "chat", label: "Chats" },
  { kind: "gift", label: "Gifts" },
  { kind: "follow", label: "Follows" },
  { kind: "share", label: "Shares" },
  { kind: "superfan", label: "New Super Fans" },
  { kind: "join", label: "Viewers joining" },
];

const plural = (count: number, word: string) =>
  `${count} ${count === 1 ? word : `${word}s`}`;

export type Stat = { label: string; value: number };

// Short, with the exact number on hover. Dashes while offline.
export function statText(value: number, connected: boolean) {
  if (!connected) return { text: "--", title: undefined };
  const { short, full } = formatStat(value);
  return { text: short, title: full };
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
