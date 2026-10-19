import { CustomGift } from "@/common/types";
import type { SelectOption } from "@/components/Elements";
import { formatStat } from "./format";

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
    label: string;
    test: (coins: number, amount: number, to: number) => boolean;
  }
> = {
  any: { label: "Any price", test: () => true },
  eq: { label: "Exactly", test: (coins, amount) => coins === amount },
  gt: { label: "More than", test: (coins, amount) => coins > amount },
  gte: { label: "At least", test: (coins, amount) => coins >= amount },
  lt: { label: "Less than", test: (coins, amount) => coins < amount },
  lte: { label: "At most", test: (coins, amount) => coins <= amount },
  // Either end can be the bigger one, both are in.
  between: {
    label: "Between",
    test: (coins, amount, to) =>
      coins >= Math.min(amount, to) && coins <= Math.max(amount, to),
  },
};

type Compare = (a: CustomGift, b: CustomGift) => number;

const byName: Compare = (a, b) => a.label.localeCompare(b.label);
const byCoins: Compare = (a, b) => a.coins - b.coins;

// Ties go to the name, or to the price when sorting by name.
const SORTS: Record<GiftSort, { label: string; compare: Compare }> = {
  cheapest: {
    label: "Cheapest first",
    compare: (a, b) => byCoins(a, b) || byName(a, b),
  },
  priciest: {
    label: "Most expensive first",
    compare: (a, b) => byCoins(b, a) || byName(a, b),
  },
  az: {
    label: "Name, A to Z",
    compare: (a, b) => byName(a, b) || byCoins(a, b),
  },
  za: {
    label: "Name, Z to A",
    compare: (a, b) => byName(b, a) || byCoins(a, b),
  },
};

// A record's entries as choices, in its order
function choices<K extends string>(
  record: Record<K, { label: string }>,
): SelectOption<K>[] {
  const options: SelectOption<K>[] = [];
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

export const coinUnit = (coins: number) => (coins === 1 ? "coin" : "coins");

// "1 coin", "1,000 coins"
export const coinsLabel = (coins: number) =>
  `${formatStat(coins).full} ${coinUnit(coins)}`;

export const giftsLabel = (count: number) =>
  `${formatStat(count).full} ${count === 1 ? "gift" : "gifts"}`;
