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
  const short = format.short.format(value);
  return {
    // ICU writes Spanish "3.5 K" below 10,000 but "52.4 k" above, so one
    // row would mix them: "K" throughout
    short: language.startsWith("es") ? short.replace(/k$/, "K") : short,
    full: format.full.format(value),
  };
}

const moneyFormats = new Map<
  string,
  { cents: Intl.NumberFormat; compact: Intl.NumberFormat }
>();

// Stands in for dollars before the exchange rates load
export const NO_MONEY = "—";

/**
 * US dollars as short text ($57.40, then $1.23K from a thousand on, never
 * rounded up) and in full ($1,234.56), as the language writes them.
 */
export function formatMoney(usd: number, language: string) {
  let format = moneyFormats.get(language);
  if (!format) {
    const money = { style: "currency", currency: "USD" } as const;
    format = {
      cents: new Intl.NumberFormat(language, money),
      compact: new Intl.NumberFormat(language, {
        ...money,
        notation: "compact",
        maximumSignificantDigits: 3,
        roundingMode: "trunc",
      }),
    };
    moneyFormats.set(language, format);
  }
  const full = format.cents.format(usd);
  return { short: usd < 1000 ? full : format.compact.format(usd), full };
}

/**
 * A length in whole minutes, else seconds, as the language writes it: "30
 * seconds", or with a max "1–2 minutes".
 */
export function formatSeconds(language: string, seconds: number, max?: number) {
  const minutes = seconds % 60 === 0 && (max ?? 0) % 60 === 0;
  const per = minutes ? 60 : 1;
  const format = new Intl.NumberFormat(language, {
    style: "unit",
    unit: minutes ? "minute" : "second",
    unitDisplay: "long",
  });
  return max === undefined
    ? format.format(seconds / per)
    : format.formatRange(seconds / per, max / per);
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
