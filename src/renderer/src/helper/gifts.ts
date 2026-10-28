import { MessageKey, translate } from "@/common/i18n";
import { CustomGift } from "@/common/types";

export type CoinOperator =
  "any" | "eq" | "gt" | "gte" | "lt" | "lte" | "between";

export type GiftSort = "cheapest" | "priciest" | "az" | "za";

// `coins` is the operator's amount, `to` the other end of a range.
export type GiftFilter = {
  search: string;
  operator: CoinOperator;
  coins: number;
  to: number;
  sort: GiftSort;
};

const OPERATORS: Record<
  CoinOperator,
  {
    label: MessageKey;
    test: (coins: number, amount: number, to: number) => boolean;
  }
> = {
  any: { label: "gifts.operator.any", test: () => true },
  eq: { label: "gifts.operator.eq", test: (coins, amount) => coins === amount },
  gt: { label: "gifts.operator.gt", test: (coins, amount) => coins > amount },
  gte: {
    label: "gifts.operator.gte",
    test: (coins, amount) => coins >= amount,
  },
  lt: { label: "gifts.operator.lt", test: (coins, amount) => coins < amount },
  lte: {
    label: "gifts.operator.lte",
    test: (coins, amount) => coins <= amount,
  },
  // Either end can be the bigger one, both are in.
  between: {
    label: "gifts.operator.between",
    test: (coins, amount, to) =>
      coins >= Math.min(amount, to) && coins <= Math.max(amount, to),
  },
};

type Compare = (a: CustomGift, b: CustomGift) => number;

const byName: Compare = (a, b) => a.label.localeCompare(b.label);
const byCoins: Compare = (a, b) => a.coins - b.coins;

// Ties go to the name, or to the price when sorting by name.
const SORTS: Record<GiftSort, { label: MessageKey; compare: Compare }> = {
  cheapest: {
    label: "gifts.sort.cheapest",
    compare: (a, b) => byCoins(a, b) || byName(a, b),
  },
  priciest: {
    label: "gifts.sort.priciest",
    compare: (a, b) => byCoins(b, a) || byName(a, b),
  },
  az: {
    label: "gifts.sort.az",
    compare: (a, b) => byName(a, b) || byCoins(a, b),
  },
  za: {
    label: "gifts.sort.za",
    compare: (a, b) => byName(b, a) || byCoins(a, b),
  },
};

// A record's entries as choices, in its order, their labels keys (see
// useOptions)
function choices<K extends string>(
  record: Record<K, { label: MessageKey }>,
): { value: K; label: MessageKey }[] {
  const options: { value: K; label: MessageKey }[] = [];
  for (const value in record) {
    options.push({ value, label: record[value].label });
  }
  return options;
}

export const COIN_OPERATORS = choices(OPERATORS);
export const GIFT_SORTS = choices(SORTS);

/**
 * The gifts whose name has the search and whose price passes, sorted, with
 * the ones in `first` before the others.
 */
export function filterGifts(
  gifts: CustomGift[],
  { search, operator, coins, to, sort }: GiftFilter,
  first: ReadonlySet<number> = new Set(),
): CustomGift[] {
  const needle = search.trim().toLowerCase();
  const { test } = OPERATORS[operator];
  const { compare } = SORTS[sort];
  const rank = (gift: CustomGift) => (first.has(gift.value) ? 0 : 1);
  return gifts
    .filter(
      (gift) =>
        gift.label.toLowerCase().includes(needle) &&
        test(gift.coins, coins, to),
    )
    .sort((a, b) => rank(a) - rank(b) || compare(a, b));
}

// "coin" or "coins", after a number the user types
export const coinUnit = (coins: number, language: string) =>
  translate(language, "gifts.coinUnit", { count: coins });

// "1 coin", "1,000 coins"
export const coinsLabel = (coins: number, language: string) =>
  translate(language, "gifts.coins", { count: coins });

export const giftsLabel = (count: number, language: string) =>
  translate(language, "gifts.gifts", { count });
