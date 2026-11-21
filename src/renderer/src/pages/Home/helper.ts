import { listOf, MessageKey, translate } from "@/common/i18n";
import { ActivityFeed, Alert } from "@/common/schemas";
import {
  ActivityUser,
  AlertTrigger,
  LiveSession,
  Platform,
  TOKIO_EVENTS,
} from "@/common/types";
import { PLATFORM_TRIGGERS, triggersFor } from "@/common/util";
import type { IconType } from "react-icons";
import { FaTiktok, FaTwitch } from "react-icons/fa";

// Until main answers
export const NO_SESSION: LiveSession = {
  startedAt: null,
  totals: { followers: 0, shares: 0, gifts: 0, coins: 0 },
  activity: [],
  viewers: [],
};

// The platforms' logos, Font Awesome's
export const PLATFORM_ICONS: Record<Platform, IconType> = {
  tiktok: FaTiktok,
  twitch: FaTwitch,
};

// The kinds of events the feed can show, as its settings list them, with
// the event each comes from
const FEED_KINDS: {
  kind: keyof ActivityFeed;
  label: MessageKey;
  trigger: AlertTrigger;
}[] = [
  { kind: "chat", label: "home.feed.chat", trigger: TOKIO_EVENTS.CHAT },
  { kind: "gift", label: "home.feed.gift", trigger: TOKIO_EVENTS.GIFT },
  { kind: "follow", label: "home.feed.follow", trigger: TOKIO_EVENTS.FOLLOW },
  { kind: "share", label: "home.feed.share", trigger: TOKIO_EVENTS.SHARE },
  {
    kind: "superfan",
    label: "home.feed.superfan",
    trigger: TOKIO_EVENTS.SUPER_FAN,
  },
  { kind: "join", label: "home.feed.join", trigger: TOKIO_EVENTS.MEMBER_JOIN },
  { kind: "sub", label: "home.feed.sub", trigger: TOKIO_EVENTS.SUBSCRIBE },
  {
    kind: "giftsub",
    label: "home.feed.giftsub",
    trigger: TOKIO_EVENTS.GIFT_SUB,
  },
  { kind: "cheer", label: "home.feed.cheer", trigger: TOKIO_EVENTS.CHEER },
  { kind: "raid", label: "home.feed.raid", trigger: TOKIO_EVENTS.RAID },
  { kind: "redeem", label: "home.feed.redeem", trigger: TOKIO_EVENTS.REDEEM },
];

// The kinds the platforms send
export const feedKinds = (platforms: readonly Platform[]) => {
  const sent = triggersFor(platforms);
  return FEED_KINDS.filter(({ trigger }) => sent.includes(trigger));
};

// The stats the platforms have: likes and shares are TikTok's, gifts and
// coins come with a platform that sends gifts
export function liveStats(
  platforms: readonly Platform[],
  values: Record<"likes" | "views" | keyof LiveSession["totals"], number>,
): Stat[] {
  const tiktok = platforms.includes("tiktok");
  const gifts = platforms.some((p) =>
    PLATFORM_TRIGGERS[p].includes(TOKIO_EVENTS.GIFT),
  );
  const stats: (Stat | false)[] = [
    tiktok && { label: "home.stats.likes", value: values.likes },
    // Only TikTok counts a LIVE's total views; Twitch sends 0
    tiktok && { label: "home.stats.totalViews", value: values.views },
    { label: "home.totals.followers", value: values.followers },
    tiktok && { label: "home.totals.shares", value: values.shares },
    gifts && { label: "home.totals.gifts", value: values.gifts },
    gifts && { label: "home.totals.coins", value: values.coins },
  ];
  return stats.filter((stat) => stat !== false);
}

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

// Every music provider names a song "name - artist". A song's name can hold
// " - " itself ("Try - Live"), an artist's rarely does, so the last one splits
// them. Without one it's all name.
export function songParts(title: string): { name: string; artist: string } {
  const at = title.lastIndexOf(" - ");
  if (at === -1) return { name: title, artist: "" };
  return { name: title.slice(0, at), artist: title.slice(at + 3) };
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
