import { MessageKey, translate } from "@/common/i18n";
import { LiveSummary } from "@/common/types";
import { DateTimeValue, NO_DATE } from "@/components";
import { formatDate } from "@/helper";

export type Totals = Pick<
  LiveSummary,
  "coins" | "gifts" | "followers" | "shares" | "likes" | "views" | "peakViewers"
>;

// The readout's two rows, the bigger numbers first
export const READOUT: { key: keyof Totals; label: MessageKey }[][] = [
  [
    { key: "coins", label: "lives.stats.coins" },
    { key: "gifts", label: "lives.stats.gifts" },
    { key: "followers", label: "lives.stats.followers" },
  ],
  [
    { key: "shares", label: "lives.stats.shares" },
    { key: "likes", label: "lives.stats.likes" },
    { key: "peakViewers", label: "lives.stats.peakViewers" },
    { key: "views", label: "lives.stats.views" },
  ],
];

// Every LIVE's numbers added up, with the best peak instead of a sum, and how
// long they ran in ms
export function allTime(lives: LiveSummary[]): Totals & { length: number } {
  const sum = {
    coins: 0,
    gifts: 0,
    followers: 0,
    shares: 0,
    likes: 0,
    views: 0,
    peakViewers: 0,
    length: 0,
  };
  for (const live of lives) {
    sum.coins += live.coins;
    sum.gifts += live.gifts;
    sum.followers += live.followers;
    sum.shares += live.shares;
    sum.likes += live.likes;
    sum.views += live.views;
    sum.peakViewers = Math.max(sum.peakViewers, live.peakViewers);
    sum.length += live.endedAt - live.startedAt;
  }
  return sum;
}

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
  { value: "all", label: "lives.filter.all" },
  { value: "day", label: "lives.filter.day" },
  { value: "week", label: "lives.filter.week" },
  { value: "month", label: "lives.filter.month" },
  { value: "year", label: "lives.filter.year" },
  { value: "custom", label: "lives.filter.custom" },
];

export const DATE_OPERATORS: { value: DateOperator; label: MessageKey }[] = [
  { value: "on", label: "lives.filter.on" },
  { value: "after", label: "lives.filter.after" },
  { value: "before", label: "lives.filter.before" },
  { value: "between", label: "lives.filter.between" },
];

// From `from` (included) to `to` (left out), in ms
export type DateRange = { from?: number; to?: number };

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
 * The LIVEs a filter keeps, by when they started. The presets count back from
 * `now`. A custom day without a time is the whole day: after and before leave
 * it out, and between takes both ends, in either order. On is always a whole
 * day. Null while it keeps them all, or a day isn't picked yet.
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

export const inRange = (
  { startedAt }: LiveSummary,
  { from = -Infinity, to = Infinity }: DateRange,
) => startedAt >= from && startedAt < to;

// The totals' name: All time, the preset, or the custom dates
export function periodText(
  filter: DateFilter,
  language: string,
  now: number,
): string {
  if (!dateRange(filter, now))
    return translate(language, "lives.allTime.title");
  const { preset, operator, from, to } = filter;
  if (preset !== "custom") {
    return translate(language, `lives.filter.${preset}`);
  }
  // With its time when one was picked
  const text = (value: DateTimeValue) =>
    formatDate(moment(value), language, value.time ? "shortTime" : "short");
  switch (operator) {
    case "on":
      return translate(language, "lives.period.on", {
        date: text({ date: from.date, time: "" }),
      });
    case "after":
      return translate(language, "lives.period.after", { date: text(from) });
    case "before":
      return translate(language, "lives.period.before", { date: text(from) });
    default: {
      const [first, last] =
        moment(from) <= moment(to) ? [from, to] : [to, from];
      return translate(language, "lives.period.between", {
        from: text(first),
        to: text(last),
      });
    }
  }
}
