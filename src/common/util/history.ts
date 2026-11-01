import type { LiveSummary } from "../types";

// From `from` (included) to `to` (left out), in ms
export type DateRange = { from?: number; to?: number };

type Span = Pick<LiveSummary, "startedAt" | "endedAt">;

// A LIVE is in some dates when it starts in them or runs into them
export const inRange = (
  { startedAt, endedAt }: Span,
  { from = -Infinity, to = Infinity }: DateRange,
) => startedAt < to && (startedAt >= from || endedAt > from);

// All of it is, so it counts whole
export const allInRange = (
  { startedAt, endedAt }: Span,
  { from = -Infinity, to = Infinity }: DateRange,
) => startedAt >= from && endedAt <= to;

type Viewer = { username: string; handle: string };

// A viewer search: trimmed, in any case, in their name or @handle. "@kai"
// finds kai too.
export const viewerMatcher = (query: string) => {
  const needle = query.trim().replace(/^@/, "").toLocaleLowerCase();
  return ({ username, handle }: Viewer) =>
    username.toLocaleLowerCase().includes(needle) ||
    handle.toLocaleLowerCase().includes(needle);
};
