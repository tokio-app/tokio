import type { GiftEvent } from "@/common/types";

// A lower count this soon after a streak's last update is an update that came
// late, not a new streak. TikTok ends a streak 3 to 4 s after its last gift.
export const LATE_MS = 2000;

interface Streak {
  // The last count TikTok sent
  last: number;
  // The gifts counted so far: more than `last` when the same count came again
  total: number;
  // When the last event that counted came
  at: number;
}

/**
 * Each viewer's streak of a gift, counted like the gift jar overlay's Tally:
 * TikTok sends a streak as events whose count grows, then one that ends it. A
 * count that grows adds the growth, the same count again before the end is the
 * gift sent again, and a lower one within LATE_MS is an update that came late.
 * Streaks don't expire with time: a late end would then count one twice.
 */
export class GiftStreaks {
  private _streaks = new Map<string, Streak>();

  /** The gifts an event adds, and the streak's count with them. */
  public add(
    { user, gift }: GiftEvent,
    now = Date.now(),
  ): { added: number; total: number } {
    const key = `${user.handle || user.username}:${gift.id}`;
    const count = Math.max(1, gift.comboCount);
    const streak = this._streaks.get(key);
    let added = count;
    let total = count;
    if (streak && (count >= streak.last || now - streak.at < LATE_MS)) {
      if (count > streak.last) added = count - streak.last;
      else if (count < streak.last || gift.repeatEnd) added = 0;
      total = streak.total + added;
    }

    if (gift.repeatEnd) this._streaks.delete(key);
    else if (added > 0) this._streaks.set(key, { last: count, total, at: now });
    return { added, total };
  }

  public clear() {
    this._streaks.clear();
  }
}
