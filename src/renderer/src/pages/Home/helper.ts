import { listOf, MessageKey, translate } from "@/common/i18n";
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
export const FEED_KINDS: { kind: keyof ActivityFeed; label: MessageKey }[] = [
  { kind: "chat", label: "home.feed.chat" },
  { kind: "gift", label: "home.feed.gift" },
  { kind: "follow", label: "home.feed.follow" },
  { kind: "share", label: "home.feed.share" },
  { kind: "superfan", label: "home.feed.superfan" },
  { kind: "join", label: "home.feed.join" },
];

export type Stat = { label: MessageKey; value: number };

// Short, with the exact number on hover, as the language writes them. Dashes
// while offline.
export function statText(value: number, connected: boolean, language: string) {
  if (!connected) return { text: "--", title: undefined };
  const { short, full } = formatStat(value, language);
  return { text: short, title: full };
}

// "kai joined", "kai and yui joined", "kai, yui, and 3 others joined"
export function joinedText(
  users: ActivityUser[],
  count: number,
  language: string,
): string {
  const names = users.map((user) => user.name);
  const others = count - names.length;
  if (others > 0) {
    names.push(translate(language, "home.activity.others", { count: others }));
  }
  // count picks the verb's number: "kai se unió", "kai y yui se unieron"
  return translate(language, "home.activity.joined", {
    names: listOf(language, names),
    count,
  });
}

// "3 of 4 alerts on"
export function alertsStatus(alerts: Alert[], language: string): string {
  if (alerts.length === 0) return translate(language, "home.features.noAlerts");
  const on = alerts.filter((alert) => alert.enabled).length;
  return translate(language, "home.features.alertsOn", {
    on,
    count: alerts.length,
  });
}

// "Running · 2 overlays"
export function serverStatus(
  enabled: boolean,
  overlays: number,
  language: string,
): string {
  if (!enabled) return translate(language, "home.features.serverOff");
  return translate(language, "home.features.serverOn", { count: overlays });
}
