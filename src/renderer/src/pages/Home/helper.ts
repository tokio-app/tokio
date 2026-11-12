import { listOf, MessageKey, translate } from "@/common/i18n";
import { ActivityFeed, Alert } from "@/common/schemas";
import { ActivityUser, LiveSession } from "@/common/types";

// Until main answers
export const NO_SESSION: LiveSession = {
  startedAt: null,
  totals: { followers: 0, shares: 0, gifts: 0, coins: 0 },
  activity: [],
  viewers: [],
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

// The chart's points, x and y from 0 to 100 with y down, as the SVG's viewBox
// reads them: the peak at the top, 0 on the baseline, a lone point on the
// right edge, where now is
export function chartPoints(values: number[]): { x: number; y: number }[] {
  const peak = Math.max(0, ...values);
  const last = values.length - 1;
  return values.map((value, i) => ({
    x: last > 0 ? (i / last) * 100 : 100,
    y: peak > 0 ? 100 - (value / peak) * 100 : 100,
  }));
}

// The point nearest a spot across the chart, given as a share of its width
export function nearestIndex(ratio: number, count: number): number {
  if (count <= 1) return 0;
  return Math.round(Math.min(Math.max(ratio, 0), 1) * (count - 1));
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

// "2 overlays", whether the server runs or not: its switch says that
export function overlaysStatus(overlays: number, language: string): string {
  if (overlays === 0) return translate(language, "home.features.noOverlays");
  return translate(language, "home.features.overlays", { count: overlays });
}
