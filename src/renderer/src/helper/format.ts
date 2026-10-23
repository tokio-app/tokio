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

const compactFormat = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});
const exactFormat = new Intl.NumberFormat("en-US");

/**
 * A live stat as short text (1.2K) and as the exact number (1,234).
 */
export function formatStat(value: number) {
  return {
    short: compactFormat.format(value),
    full: exactFormat.format(value),
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
