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

// Made once per language, a busy LIVE formats stats many times a second
const formats = new Map<
  string,
  { short: Intl.NumberFormat; full: Intl.NumberFormat }
>();

/**
 * A live stat as short text (1.2K) and as the exact number (1,234), as the
 * language writes them.
 */
export function formatStat(value: number, language: string) {
  let format = formats.get(language);
  if (!format) {
    format = {
      short: new Intl.NumberFormat(language, {
        notation: "compact",
        maximumFractionDigits: 1,
      }),
      full: new Intl.NumberFormat(language),
    };
    formats.set(language, format);
  }
  return {
    short: format.short.format(value),
    full: format.full.format(value),
  };
}

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
