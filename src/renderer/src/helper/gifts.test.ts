import { MessageKey, translate } from "@/common/i18n";
import { gift } from "@test/fixtures";
import { describe, expect, it } from "vitest";
import {
  COIN_OPERATORS,
  coinsLabel,
  coinUnit,
  filterGifts,
  GIFT_SORTS,
  GiftFilter,
  giftsLabel,
} from "./gifts";

// The fixture's gifts cost their id in coins
const rose = gift(1, "Rose");
const heart = { ...gift(8, "Heart Me"), coins: 1 };
const doughnut = gift(30, "Doughnut");
const galaxy = gift(1000, "Galaxy");
const lion = gift(29999, "Lion");
const GIFTS = [lion, galaxy, doughnut, heart, rose];

const ANY: GiftFilter = {
  search: "",
  operator: "any",
  coins: 0,
  to: 0,
  sort: "cheapest",
};

const names = (filter: Partial<GiftFilter>, first?: ReadonlySet<number>) =>
  filterGifts(GIFTS, { ...ANY, ...filter }, first).map((g) => g.label);

describe("filterGifts", () => {
  it("keeps every gift without a filter, cheapest first, then by name", () => {
    expect(names({})).toEqual([
      "Heart Me",
      "Rose",
      "Doughnut",
      "Galaxy",
      "Lion",
    ]);
    expect(GIFTS).toEqual([lion, galaxy, doughnut, heart, rose]);
  });

  it("searches names, ignoring case and spaces", () => {
    expect(names({ search: "  RO " })).toEqual(["Rose"]);
    expect(names({ search: "o" })).toEqual(["Rose", "Doughnut", "Lion"]);
    expect(names({ search: "zzz" })).toEqual([]);
  });

  it.each([
    { operator: "eq", shown: ["Doughnut"] },
    { operator: "gt", shown: ["Galaxy", "Lion"] },
    { operator: "gte", shown: ["Doughnut", "Galaxy", "Lion"] },
    { operator: "lt", shown: ["Heart Me", "Rose"] },
    { operator: "lte", shown: ["Heart Me", "Rose", "Doughnut"] },
  ] as const)("compares the coins with $operator", ({ operator, shown }) => {
    expect(names({ operator, coins: 30 })).toEqual(shown);
  });

  it("keeps a range with both ends, whichever is bigger", () => {
    const shown = ["Doughnut", "Galaxy"];
    expect(names({ operator: "between", coins: 30, to: 1000 })).toEqual(shown);
    expect(names({ operator: "between", coins: 1000, to: 30 })).toEqual(shown);
    expect(names({ operator: "between", coins: 1, to: 1 })).toEqual([
      "Heart Me",
      "Rose",
    ]);
  });

  it("searches and filters by coins together", () => {
    expect(names({ search: "o", operator: "gte", coins: 30 })).toEqual([
      "Doughnut",
      "Lion",
    ]);
  });

  it.each([
    {
      sort: "priciest",
      shown: ["Lion", "Galaxy", "Doughnut", "Heart Me", "Rose"],
    },
    { sort: "az", shown: ["Doughnut", "Galaxy", "Heart Me", "Lion", "Rose"] },
    { sort: "za", shown: ["Rose", "Lion", "Heart Me", "Galaxy", "Doughnut"] },
  ] as const)("sorts by $sort", ({ sort, shown }) => {
    expect(names({ sort })).toEqual(shown);
  });

  it("lists the gifts asked first before the others, each part sorted", () => {
    const first = new Set([1000, 1]);

    expect(names({}, first)).toEqual([
      "Rose",
      "Galaxy",
      "Heart Me",
      "Doughnut",
      "Lion",
    ]);
    expect(names({ sort: "za" }, first)).toEqual([
      "Rose",
      "Galaxy",
      "Lion",
      "Heart Me",
      "Doughnut",
    ]);
    // The filters still apply to them
    expect(names({ operator: "lt", coins: 100 }, first)).toEqual([
      "Rose",
      "Heart Me",
      "Doughnut",
    ]);
  });

  it("sorts gifts with the same name cheapest first", () => {
    const bigRose = { ...gift(5, "Rose"), coins: 99 };
    const coins = (sort: GiftFilter["sort"]) =>
      filterGifts([bigRose, rose], { ...ANY, sort }).map((g) => g.coins);

    expect(coins("az")).toEqual([1, 99]);
    expect(coins("za")).toEqual([1, 99]);
  });
});

describe("COIN_OPERATORS and GIFT_SORTS", () => {
  it("offers the operators and the sorts in order", () => {
    const labels = (options: { label: MessageKey }[]) =>
      options.map(({ label }) => translate("en", label));

    expect(COIN_OPERATORS.map(({ value }) => value)).toEqual([
      "any",
      "eq",
      "gt",
      "gte",
      "lt",
      "lte",
      "between",
    ]);
    expect(labels(COIN_OPERATORS)).toEqual([
      "Any price",
      "Exactly",
      "More than",
      "At least",
      "Less than",
      "At most",
      "Between",
    ]);
    expect(labels(GIFT_SORTS)).toEqual([
      "Cheapest first",
      "Most expensive first",
      "Name, A to Z",
      "Name, Z to A",
    ]);
  });
});

describe("coinsLabel, giftsLabel and coinUnit", () => {
  it("count coins and gifts in the language", () => {
    expect(coinsLabel(1, "en")).toBe("1 coin");
    expect(coinsLabel(0, "en")).toBe("0 coins");
    expect(coinsLabel(29999, "en")).toBe("29,999 coins");
    expect(giftsLabel(1, "en")).toBe("1 gift");
    expect(giftsLabel(3, "en")).toBe("3 gifts");
    expect(coinUnit(1, "en")).toBe("coin");
    expect(coinUnit(2, "en")).toBe("coins");
    expect(coinsLabel(1, "es-419")).toBe("1 moneda");
    expect(giftsLabel(1500, "es-419")).toBe("1,500 regalos");
  });
});
