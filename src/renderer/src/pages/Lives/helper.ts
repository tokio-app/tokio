import { MessageKey, translate } from "@/common/i18n";
import { LiveSummary } from "@/common/types";
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

export type DateOperator = "any" | "on" | "after" | "before" | "between";

// The operator and its days, "YYYY-MM-DD" as the date fields give them, ""
// until one is picked
export type DateFilter = { operator: DateOperator; date: string; to: string };

export const NO_FILTER: DateFilter = { operator: "any", date: "", to: "" };

export const DATE_OPERATORS: { value: DateOperator; label: MessageKey }[] = [
  { value: "any", label: "lives.filter.any" },
  { value: "on", label: "lives.filter.on" },
  { value: "after", label: "lives.filter.after" },
  { value: "before", label: "lives.filter.before" },
  { value: "between", label: "lives.filter.between" },
];

// From `from` (included) to `to` (left out), in ms
export type DateRange = { from?: number; to?: number };

// Local midnight at the start of a "YYYY-MM-DD" day, or of one `later`
const dayStart = (day: string, later = 0) => {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(year, month - 1, date + later).getTime();
};

/**
 * The LIVEs a filter keeps, by the local day they started. After and before
 * leave the day itself out; between takes both days, in either order. Null
 * while it keeps them all, or a day isn't picked yet.
 */
export function dateRange({
  operator,
  date,
  to,
}: DateFilter): DateRange | null {
  if (operator === "any" || !date) return null;
  if (operator === "on") return { from: dayStart(date), to: dayStart(date, 1) };
  if (operator === "after") return { from: dayStart(date, 1) };
  if (operator === "before") return { to: dayStart(date) };
  if (!to) return null;
  // Days in this form sort as they come
  const [first, last] = [date, to].sort();
  return { from: dayStart(first), to: dayStart(last, 1) };
}

export const inRange = (
  { startedAt }: LiveSummary,
  { from = -Infinity, to = Infinity }: DateRange,
) => startedAt >= from && startedAt < to;

// The totals' name: All time, or the days the filter keeps
export function periodText(filter: DateFilter, language: string): string {
  if (!dateRange(filter)) return translate(language, "lives.allTime.title");
  const day = (value: string) => formatDate(dayStart(value), language, "short");
  const { operator, date, to } = filter;
  switch (operator) {
    case "on":
      return translate(language, "lives.period.on", { date: day(date) });
    case "after":
      return translate(language, "lives.period.after", { date: day(date) });
    case "before":
      return translate(language, "lives.period.before", { date: day(date) });
    default: {
      const [first, last] = [date, to].sort();
      return translate(language, "lives.period.between", {
        from: day(first),
        to: day(last),
      });
    }
  }
}
