import { MessageKey, translate } from "@/common/i18n";
import {
  HistoryTotals,
  LiveSummary,
  Platform,
  PLATFORMS,
  TOKIO_EVENTS,
} from "@/common/types";
import {
  allInRange,
  Currency,
  DateRange,
  formatMoney,
  formatStat,
  PLATFORM_CURRENCY,
  platformParts,
  triggersFor,
} from "@/common/util";
import { DateTimeValue, NO_DATE } from "@/components";
import { formatDate } from "@/helper";

// Each platform's part of a LIVE or of some dates
export type Parts = Partial<Record<Platform, HistoryTotals>>;

// A platform's numbers, or all of them
export type StatsTab = Platform | "all";

const NO_PART: HistoryTotals = { amount: 0, gifts: 0, giftSubs: 0 };

/**
 * The platforms the LIVEs were on, in Home's order: an older LIVE was
 * TikTok's. TikTok's alone without LIVEs.
 */
export function historyPlatforms(lives: LiveSummary[]): Platform[] {
  const found = PLATFORMS.filter((p) =>
    lives.some((live) => platformParts(live)[p]),
  );
  return found.length > 0 ? found : ["tiktok"];
}

// A tab per platform, then All with two or more, as on Home
export const statsTabs = (platforms: Platform[]): StatsTab[] =>
  platforms.length > 1 ? [...platforms, "all"] : platforms;

// A LIVE's part on the tab: its platform's money, or every gift on All
export const liveValue = (live: LiveSummary, tab: StatsTab) =>
  tab === "all" ? live.gifts : (platformParts(live)[tab]?.amount ?? 0);

/**
 * The LIVEs' parts added up, and how long they ran in ms. With dates, how
 * long they ran in them, and only the parts of the LIVEs all in them: main
 * adds up the gifts in them of a LIVE they cut.
 */
export function allTime(
  lives: LiveSummary[],
  range: DateRange = {},
): { parts: Parts; length: number } {
  const { from = -Infinity, to = Infinity } = range;
  const parts: Parts = {};
  let length = 0;
  for (const live of lives) {
    length += Math.min(live.endedAt, to) - Math.max(live.startedAt, from);
    if (!allInRange(live, range)) continue;
    const own = platformParts(live);
    for (const p of PLATFORMS) {
      const part = own[p];
      if (!part) continue;
      const sum = (parts[p] ??= { ...NO_PART });
      sum.amount += part.amount;
      sum.gifts += part.gifts;
      sum.giftSubs += part.giftSubs;
    }
  }
  return { parts, length };
}

// Each currency's tile
const MONEY: Record<Currency, MessageKey> = {
  coins: "coinStats.stats.coins",
  jewels: "coinStats.stats.jewels",
  kicks: "coinStats.stats.kicks",
  bits: "coinStats.stats.bits",
  usd: "coinStats.stats.superChats",
};

// A tile: money in its currency, or a count without one
export type Stat = { label: MessageKey; value: number; currency?: Currency };

/**
 * The summary's tiles. A platform's tab: its money, then its gifts and
 * gifted subs where it sends them. All: each platform's money on its own
 * tile, never added up, then every gift and every gifted sub.
 */
export function readout(
  tab: StatsTab,
  platforms: Platform[],
  parts: Parts,
): Stat[] {
  const shown = tab === "all" ? platforms : [tab];
  const sent = triggersFor(shown);
  const sum = (key: "gifts" | "giftSubs") =>
    shown.reduce((n, p) => n + (parts[p]?.[key] ?? 0), 0);
  const stats: (Stat | false)[] = [
    ...shown.map((p) => ({
      label: MONEY[PLATFORM_CURRENCY[p]],
      value: parts[p]?.amount ?? 0,
      currency: PLATFORM_CURRENCY[p],
    })),
    sent.includes(TOKIO_EVENTS.GIFT) && {
      label: "coinStats.stats.gifts",
      value: sum("gifts"),
    },
    sent.includes(TOKIO_EVENTS.GIFT_SUB) && {
      label: "coinStats.stats.giftSubs",
      value: sum("giftSubs"),
    },
  ];
  return stats.filter((stat) => stat !== false);
}

// Short with the exact number on hover: US dollars as money, the rest as
// counts
export const statText = (
  value: number,
  currency: Currency | undefined,
  language: string,
) => (currency === "usd" ? formatMoney : formatStat)(value, language);

/**
 * The LIVE to select when the list changes, by its startedAt, or null for All
 * time. The same one while it's there; after a delete, the one that took its
 * place, or the one before when it was the last. Nothing selected yet
 * (undefined) gets the newest.
 */
export function keepSelection(
  selected: number | null | undefined,
  before: LiveSummary[],
  after: LiveSummary[],
): number | null {
  if (selected === null) return null;
  if (after.some((live) => live.startedAt === selected)) return selected!;
  const index = before.findIndex((live) => live.startedAt === selected);
  return (
    after[Math.min(Math.max(index, 0), after.length - 1)]?.startedAt ?? null
  );
}

// Spanish dates start with the weekday in lowercase, "sábado, 31 de octubre"
export const capitalize = (text: string, language: string) =>
  text.charAt(0).toLocaleUpperCase(language) + text.slice(1);

// Counting back from now, or custom dates
export type DatePreset = "all" | "day" | "week" | "month" | "year" | "custom";
export type DateOperator = "on" | "after" | "before" | "between";

// A preset, or custom dates: the operator and its days and times
export type DateFilter = {
  preset: DatePreset;
  operator: DateOperator;
  from: DateTimeValue;
  // Between's other end
  to: DateTimeValue;
};

export const NO_FILTER: DateFilter = {
  preset: "all",
  operator: "between",
  from: NO_DATE,
  to: NO_DATE,
};

export const DATE_PRESETS: { value: DatePreset; label: MessageKey }[] = [
  { value: "all", label: "coinStats.filter.all" },
  { value: "day", label: "coinStats.filter.day" },
  { value: "week", label: "coinStats.filter.week" },
  { value: "month", label: "coinStats.filter.month" },
  { value: "year", label: "coinStats.filter.year" },
  { value: "custom", label: "coinStats.filter.custom" },
];

export const DATE_OPERATORS: { value: DateOperator; label: MessageKey }[] = [
  { value: "on", label: "coinStats.filter.on" },
  { value: "after", label: "coinStats.filter.after" },
  { value: "before", label: "coinStats.filter.before" },
  { value: "between", label: "coinStats.filter.between" },
];

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

// The picked minute in local time, or the day's start without a time, or
// the start of a day `later`
const moment = ({ date, time }: DateTimeValue, later = 0) => {
  const [year, month, day] = date.split("-").map(Number);
  const [hours, minutes] = time ? time.split(":").map(Number) : [0, 0];
  return new Date(year, month - 1, day + later, hours, minutes).getTime();
};

// Past the picked minute, or the whole day without a time
const momentEnd = (value: DateTimeValue) =>
  value.time ? moment(value) + MINUTE : moment(value, 1);

// The days back each preset reaches; 12 months follow the calendar
const PRESET_DAYS = { day: 1, week: 7, month: 30 };

/**
 * The dates a filter takes. The presets count back from `now`. A custom day
 * without a time is the whole day: after and before leave it out, and between
 * takes both ends, in either order. On is always a whole day. Null while it
 * takes everything, or a day isn't picked yet.
 */
export function dateRange(
  { preset, operator, from, to }: DateFilter,
  now: number,
): DateRange | null {
  if (preset === "all") return null;
  if (preset === "year") {
    const since = new Date(now);
    since.setFullYear(since.getFullYear() - 1);
    return { from: since.getTime() };
  }
  if (preset !== "custom") return { from: now - PRESET_DAYS[preset] * DAY };
  if (!from.date) return null;
  if (operator === "on") {
    const day = { date: from.date, time: "" };
    return { from: moment(day), to: moment(day, 1) };
  }
  if (operator === "after")
    return { from: from.time ? moment(from) : moment(from, 1) };
  if (operator === "before") return { to: moment(from) };
  if (!to.date) return null;
  return {
    from: Math.min(moment(from), moment(to)),
    to: Math.max(momentEnd(from), momentEnd(to)),
  };
}

// The totals' name: All time, the preset, or the custom dates
export function periodText(
  filter: DateFilter,
  language: string,
  now: number,
): string {
  if (!dateRange(filter, now))
    return translate(language, "coinStats.allTime.title");
  const { preset, operator, from, to } = filter;
  if (preset !== "custom") {
    return translate(language, `coinStats.filter.${preset}`);
  }
  // With its time when one was picked
  const text = (value: DateTimeValue) =>
    formatDate(moment(value), language, value.time ? "shortTime" : "short");
  switch (operator) {
    case "on":
      return translate(language, "coinStats.period.on", {
        date: text({ date: from.date, time: "" }),
      });
    case "after":
      return translate(language, "coinStats.period.after", {
        date: text(from),
      });
    case "before":
      return translate(language, "coinStats.period.before", {
        date: text(from),
      });
    default: {
      const [first, last] =
        moment(from) <= moment(to) ? [from, to] : [to, from];
      return translate(language, "coinStats.period.between", {
        from: text(first),
        to: text(last),
      });
    }
  }
}
