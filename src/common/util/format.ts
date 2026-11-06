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
