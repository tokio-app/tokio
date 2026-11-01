import { MessageKey } from "@/common/i18n";
import { LiveSummary } from "@/common/types";

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
