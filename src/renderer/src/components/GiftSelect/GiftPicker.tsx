import { CustomGift } from "@/common/types";
import { cx } from "@/helper/cx";
import {
  COIN_OPERATORS,
  coinsLabel,
  coinUnit,
  filterGifts,
  GIFT_SORTS,
  GiftFilter,
  giftsLabel,
} from "@/helper/gifts";
import { FocusEvent, useMemo, useState } from "react";
import { Btn, Check, Input, NumberInput, Select } from "../Elements";
import { Modal } from "../Modal";
import styles from "./giftselect.module.css";

type Props = {
  gifts: CustomGift[];
  // Ids picked when it opened, maybe some the list doesn't have
  selected: number[];
  // Gifts are checked, then applied with Done
  multiple?: boolean;
  // The gift clicked, or the gifts checked
  onApply: (gifts: number[]) => void;
  onClose: () => void;
};

export function GiftPicker({
  gifts,
  selected,
  multiple,
  onApply,
  onClose,
}: Props) {
  const [filter, setFilter] = useState<GiftFilter>({
    search: "",
    operator: "any",
    coins: 0,
    to: 0,
    sort: "cheapest",
  });
  // What Done applies: the gifts picked first, then the ones checked here
  const [picked, setPicked] = useState(selected);
  // The gifts picked when it opened are listed first. Checking doesn't move
  // them, so rows stay under the pointer.
  const [first] = useState(() => new Set(selected));
  const shown = useMemo(
    () => filterGifts(gifts, filter, first),
    [gifts, filter, first],
  );

  return (
    <Modal
      title={multiple ? "Select gifts" : "Select a gift"}
      description={
        multiple
          ? "Search by name, filter by coins and sort the list. Select all shown checks every gift the filters leave."
          : "Search by name, filter by coins and sort the list."
      }
      maxWidth="640px"
      onClose={onClose}
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          {multiple && (
            <Btn variant="accent" onClick={() => onApply(picked)}>
              Done
            </Btn>
          )}
        </>
      }
    >
      <div className={styles.filters}>
        <Input
          autoFocus
          placeholder="Search gifts..."
          value={filter.search}
          onChange={(e) => setFilter({ ...filter, search: e.target.value })}
        />
        <Select
          className={styles.sort}
          options={GIFT_SORTS}
          value={filter.sort}
          onChange={(sort) => setFilter({ ...filter, sort })}
        />
      </div>

      <CoinFilter filter={filter} onChange={setFilter} />

      {multiple && (
        <SelectionBar
          shown={shown}
          total={gifts.length}
          picked={picked}
          onChange={setPicked}
        />
      )}

      <GiftList
        shown={shown}
        empty={gifts.length === 0 ? "No gifts available." : "No gifts match."}
        multiple={multiple}
        picked={picked}
        // Checking changes the picks, clicking a gift of a single pick applies it.
        onChange={multiple ? setPicked : onApply}
      />
    </Modal>
  );
}

// Typing replaces the amount
const selectText = (e: FocusEvent<HTMLInputElement>) => e.target.select();

type FilterProps = {
  filter: GiftFilter;
  onChange: (filter: GiftFilter) => void;
};

// An operator and its amount, or the two ends of a range
function CoinFilter({ filter, onChange }: FilterProps) {
  const { operator } = filter;
  const range = operator === "between";

  return (
    <div className={styles.filters}>
      <Select
        className={styles.operator}
        options={COIN_OPERATORS}
        value={operator}
        onChange={(value) => onChange({ ...filter, operator: value })}
      />
      {operator !== "any" && (
        <>
          <NumberInput
            integer
            min={0}
            aria-label="Coins"
            className={styles.amount}
            value={filter.coins}
            onFocus={selectText}
            onChange={(coins) => onChange({ ...filter, coins })}
          />
          {range && (
            <>
              <span className={styles.unit}>and</span>
              <NumberInput
                integer
                min={0}
                aria-label="To coins"
                className={styles.amount}
                value={filter.to}
                onFocus={selectText}
                onChange={(to) => onChange({ ...filter, to })}
              />
            </>
          )}
          <span className={styles.unit}>
            {coinUnit(range ? filter.to : filter.coins)}
          </span>
        </>
      )}
    </div>
  );
}

type SelectionProps = {
  shown: CustomGift[];
  // Gifts in the list, shown or not
  total: number;
  picked: number[];
  onChange: (picked: number[]) => void;
};

// How many gifts are shown and checked, and the actions on them
function SelectionBar({ shown, total, picked, onChange }: SelectionProps) {
  const checked = new Set(picked);
  const unchecked = shown
    .filter((gift) => !checked.has(gift.value))
    .map((gift) => gift.value);

  return (
    <div className={styles.toolbar}>
      <span className={styles.count}>
        {shown.length === total
          ? giftsLabel(total)
          : `${shown.length} of ${giftsLabel(total)}`}
        {` · ${picked.length} selected`}
      </span>
      <div className={styles.actions}>
        <Btn
          disabled={unchecked.length === 0}
          onClick={() => onChange([...picked, ...unchecked])}
        >
          Select all shown
        </Btn>
        <Btn disabled={picked.length === 0} onClick={() => onChange([])}>
          Clear
        </Btn>
      </div>
    </div>
  );
}

type ListProps = {
  shown: CustomGift[];
  // Said when no gift is shown
  empty: string;
  // Rows check gifts in and out instead of picking one
  multiple?: boolean;
  picked: number[];
  onChange: (picked: number[]) => void;
};

function GiftList({ shown, empty, multiple, picked, onChange }: ListProps) {
  const checked = new Set(picked);
  const current = multiple ? undefined : picked[0];

  const toggle = (id: number) =>
    onChange(
      checked.has(id)
        ? picked.filter((value) => value !== id)
        : [...picked, id],
    );

  return (
    <div className={styles.list}>
      {shown.map((gift) =>
        multiple ? (
          <label
            key={gift.value}
            className={cx(
              styles.row,
              checked.has(gift.value) && styles.current,
            )}
            title={gift.label}
          >
            <Check
              checked={checked.has(gift.value)}
              onChange={() => toggle(gift.value)}
            />
            <GiftInfo gift={gift} />
          </label>
        ) : (
          <button
            key={gift.value}
            type="button"
            className={cx(styles.row, gift.value === current && styles.current)}
            title={gift.label}
            onClick={() => onChange([gift.value])}
          >
            <GiftInfo gift={gift} />
          </button>
        ),
      )}

      {shown.length === 0 && <p className={styles.status}>{empty}</p>}
    </div>
  );
}

// Gifts without a picture keep its room, so the names line up.
function GiftInfo({ gift }: { gift: CustomGift }) {
  return (
    <>
      {gift.img ? (
        <img src={gift.img} alt="" loading="lazy" className={styles.img} />
      ) : (
        <span className={styles.img} />
      )}
      <span className={styles.name}>{gift.label}</span>
      <span className={styles.coins}>{coinsLabel(gift.coins)}</span>
    </>
  );
}
