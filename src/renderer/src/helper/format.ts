/**
 * Splits comma separated text into its trimmed, non-empty items.
 */
export function parseList(text: string): string[] {
  return text
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

export function formatList(items: string[]): string {
  return items.join(", ");
}

// A font named by the streamer, with the app's (and the overlays') as the
// fallback. One CSSOM property, so a name can't add any other style.
export const fontFamily = (font: string) =>
  font.trim()
    ? `${JSON.stringify(font.trim())}, "Archivo Variable", sans-serif`
    : undefined;

// Shared with main, which fills studio overlays' numbers with it
export { formatStat } from "@/common/util/format";

const DATE_STYLES = {
  // "Friday, October 31, 2026"
  long: { dateStyle: "full" },
  // "Oct 31, 2026"
  short: { dateStyle: "medium" },
  // "8:14 PM"
  time: { timeStyle: "short" },
  // "Oct 31, 2026, 8:14 PM"
  shortTime: { dateStyle: "medium", timeStyle: "short" },
  // "Friday, October 31, 2026 at 8:14 PM"
  dateTime: { dateStyle: "full", timeStyle: "short" },
} satisfies Record<string, Intl.DateTimeFormatOptions>;

export type DateStyle = keyof typeof DATE_STYLES;

// Made once per language and style, a list of LIVEs formats many dates
const dateFormats = new Map<string, Intl.DateTimeFormat>();

// A time in ms since the epoch, as the language writes it
export function formatDate(ms: number, language: string, style: DateStyle) {
  const key = `${language} ${style}`;
  let format = dateFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat(language, DATE_STYLES[style]);
    dateFormats.set(key, format);
  }
  return format.format(ms);
}

// "45%", as the language writes it
export const formatPercent = (percent: number, language: string) =>
  new Intl.NumberFormat(language, { style: "percent" }).format(percent / 100);

// "00:42:13". Hours keep counting past a day.
export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const parts = [
    Math.floor(seconds / 3600),
    Math.floor((seconds % 3600) / 60),
    seconds % 60,
  ];
  return parts.map((n) => String(n).padStart(2, "0")).join(":");
}
