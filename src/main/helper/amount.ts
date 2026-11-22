// YouTube's spaces (non-breaking ones too) as one plain space
const clean = (text: string) => text.replace(/\s+/gu, " ").trim();

// en-US currency symbols ("$", "MX$", "€", "ARS") to their codes, built on
// first use. Every supported currency's symbol is its own.
let symbols: Map<string, string> | null = null;

function codeOf(symbol: string): string | undefined {
  if (!symbols) {
    symbols = new Map();
    for (const code of Intl.supportedValuesOf("currency")) {
      const part = new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: code,
      })
        .formatToParts(1)
        .find((p) => p.type === "currency");
      symbols.set(code, code);
      if (part) symbols.set(clean(part.value), code);
    }
  }
  return symbols.get(symbol);
}

const AMOUNT = /^(.*?)\s?(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)$/;

/**
 * A Super Chat's amount as YouTube shows it ("$4.99", "MX$100.00",
 * "ARS 1,000.00") as its currency code and value, or null when it can't be
 * read.
 */
// shortcut: en-US amounts with the symbol first only, since YouTube is
// fetched with hl=en&gl=US; upgrade if YouTube changes how it writes them.
export function parseAmount(
  text: string,
): { currency: string; value: number } | null {
  const match = AMOUNT.exec(clean(text));
  if (!match) return null;
  const currency = codeOf(match[1]);
  if (!currency) return null;
  return { currency, value: Number(match[2].replaceAll(",", "")) };
}
