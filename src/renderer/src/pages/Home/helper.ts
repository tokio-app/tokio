import { listOf, MessageKey, translate } from "@/common/i18n";
import { ActivityFeed, Alert } from "@/common/schemas";
import {
  ActivityUser,
  AlertTrigger,
  APP_EVENTS_RESPONSE,
  AppEventsResponseMap,
  Gifter,
  LiveSession,
  Platform,
  PLATFORMS,
  PlatformStatus,
  TOKIO_EVENTS,
} from "@/common/types";
import {
  Currency,
  giftCurrencies,
  PLATFORM_CURRENCY,
  triggersFor,
} from "@/common/util";
import { amountLabel } from "@/helper/gifts";

// Until main answers
export const NO_SESSION: LiveSession = {
  startedAt: null,
  totals: {
    followers: 0,
    shares: 0,
    gifts: 0,
    coins: 0,
    kicks: 0,
    bits: 0,
    superChats: 0,
    giftSubs: 0,
  },
  activity: [],
  viewers: [],
  platforms: {},
  usd: 0,
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
  {
    kind: "superchat",
    label: "home.feed.superchat",
    trigger: TOKIO_EVENTS.SUPER_CHAT,
  },
];

// The kinds the platforms send
export const feedKinds = (platforms: readonly Platform[]) => {
  const sent = triggersFor(platforms);
  return FEED_KINDS.filter(({ trigger }) => sent.includes(trigger));
};

// The stats the platforms have: likes and shares are TikTok's, and each
// currency gets its own tile, never added to another (the user's call)
function liveStats(
  platforms: readonly Platform[],
  values: Record<"likes" | "views" | keyof LiveSession["totals"], number>,
  usd: number | null,
): Stat[] {
  const tiktok = platforms.includes("tiktok");
  const sent = triggersFor(platforms);
  const currencies = giftCurrencies(platforms);
  const stats: (Stat | false)[] = [
    tiktok && { label: "home.stats.likes", value: values.likes },
    // Only TikTok counts a LIVE's total views; Twitch sends 0
    tiktok && { label: "home.stats.totalViews", value: values.views },
    // YouTube sends no follows
    sent.includes(TOKIO_EVENTS.FOLLOW) && {
      label: "home.totals.followers",
      value: values.followers,
    },
    tiktok && { label: "home.totals.shares", value: values.shares },
    sent.includes(TOKIO_EVENTS.GIFT) && {
      label: "home.totals.gifts",
      value: values.gifts,
    },
    // Twitch's, YouTube's gifted memberships and Kick's
    sent.includes(TOKIO_EVENTS.GIFT_SUB) && {
      label: "home.totals.giftSubs",
      value: values.giftSubs,
    },
    currencies.includes("coins") && {
      label: "home.totals.coins",
      value: values.coins,
    },
    currencies.includes("kicks") && {
      label: "home.totals.kicks",
      value: values.kicks,
    },
    sent.includes(TOKIO_EVENTS.CHEER) && {
      label: "home.totals.bits",
      value: values.bits,
    },
    // In US dollars, null until the exchange rates load
    sent.includes(TOKIO_EVENTS.SUPER_CHAT) && {
      label: "home.totals.superChats",
      value: usd,
      money: true,
    },
  ];
  return stats.filter((stat) => stat !== false);
}

// money: value is US dollars. null: not known yet.
export type Stat = { label: MessageKey; value: number | null; money?: boolean };

// The platforms in the LIVE, in Home's order: up now, or with numbers in it
export const livePlatforms = (
  status: Partial<Record<Platform, PlatformStatus>>,
  session: LiveSession,
): Platform[] =>
  PLATFORMS.filter(
    (p) =>
      status[p] === "connected" ||
      status[p] === "reconnecting" ||
      session.platforms[p] !== undefined,
  );

// Home's tabs: a platform's connection and numbers, or all their numbers
export type HomeTab = Platform | "all";

// The viewers now (everyone's and each platform's) and TikTok's total views
export type Views = {
  current: number;
  total: number;
  platformViewers: Partial<Record<Platform, number>>;
};

// Each platform's top gifters in this LIVE
export type LiveGifters =
  AppEventsResponseMap[APP_EVENTS_RESPONSE.LIVE_GIFTERS];

// What a tab shows. All adds up the LIVE's platforms; likes, total views and
// shares are TikTok's alone, so they're the same on both. Top gifters show
// on each platform's tab, in its currency, never on All, which would rank
// one currency against another.
export function liveView(
  tab: HomeTab,
  platforms: readonly Platform[],
  numbers: {
    session: LiveSession;
    views: Views;
    likes: number;
    gifters: LiveGifters;
  },
): {
  viewers: number;
  minutes: number[];
  stats: Stat[];
  gifters: { currency: Currency; list: Gifter[] } | null;
} {
  const { session, views, likes, gifters } = numbers;
  const all = tab === "all";
  const shown = all ? platforms : [tab];
  // Either has the totals and each minute's viewers
  const part = all ? session : (session.platforms[tab] ?? NO_SESSION);
  return {
    viewers: all ? views.current : (views.platformViewers[tab] ?? 0),
    minutes: part.viewers,
    // Super Chats are YouTube's alone, so the session's dollars are its own
    stats: liveStats(
      shown,
      { ...part.totals, likes, views: views.total },
      session.usd,
    ),
    gifters: all
      ? null
      : {
          currency: PLATFORM_CURRENCY[tab],
          list: gifters.byPlatform[tab] ?? [],
        },
  };
}

// "500 Bits · 3 gifted subs": what a top gifter sent, only their subs when
// they sent nothing else
export function sentLabel(
  { coins, giftSubs }: Pick<Gifter, "coins" | "giftSubs">,
  currency: Currency,
  language: string,
): string {
  const subs = translate(language, "gifts.giftSubs", { count: giftSubs });
  if (giftSubs > 0 && coins === 0) return subs;
  const amount = amountLabel(coins, currency, language);
  return giftSubs > 0 ? `${amount} · ${subs}` : amount;
}

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
