import { LiveSummary } from "@/common/types";
import { PLATFORM_CURRENCY } from "@/common/util";
import { DateTimePicker, EmptyState, Select } from "@/components";
import { cx, formatDate, formatDuration } from "@/helper";
import { amountLabel, giftsLabel } from "@/helper/gifts";
import { rich, useLanguage, useOptions, useT } from "@/ui/i18n";
import { KeyboardEvent } from "react";
import styles from "../coinstats.module.css";
import {
  DATE_OPERATORS,
  DATE_PRESETS,
  DateFilter,
  liveValue,
  StatsTab,
  statText,
} from "../helper";

interface Props {
  // The ones the filter keeps on the tab, newest first
  lives: LiveSummary[];
  // The first row's: All time, or the days the filter keeps
  title: string;
  // The first row's: the tab's money, or every gift on All
  amount: number;
  tab: StatsTab;
  filter: DateFilter;
  // The filter keeps only some of the LIVEs
  filtered: boolean;
  // A LIVE's startedAt, or null for the first row
  selected: number | null;
  onSelect: (selected: number | null) => void;
  onFilter: (filter: DateFilter) => void;
}

type FilterProps = {
  filter: DateFilter;
  onChange: (filter: DateFilter) => void;
};

// A preset, or custom dates: an operator and its day, or the two ends of a
// range, like the gift picker's coin filter. Days can take a time, except On's.
function DateFilterBar({ filter, onChange }: FilterProps) {
  const t = useT();
  const presets = useOptions(DATE_PRESETS);
  const operators = useOptions(DATE_OPERATORS);
  const { operator } = filter;

  return (
    <div className={styles.filters}>
      <Select
        className={styles.preset}
        aria-label={t("coinStats.filter.label")}
        options={presets}
        value={filter.preset}
        onChange={(preset) => onChange({ ...filter, preset })}
      />
      {filter.preset === "custom" && (
        <>
          <Select
            aria-label={t("coinStats.filter.operator")}
            options={operators}
            value={operator}
            onChange={(value) => onChange({ ...filter, operator: value })}
          />
          <DateTimePicker
            aria-label={t("coinStats.filter.date")}
            withTime={operator !== "on"}
            value={filter.from}
            onChange={(from) => onChange({ ...filter, from })}
          />
          {operator === "between" && (
            <>
              <span className={styles.and}>{t("coinStats.filter.and")}</span>
              <DateTimePicker
                aria-label={t("coinStats.filter.toDate")}
                withTime
                value={filter.to}
                onChange={(to) => onChange({ ...filter, to })}
              />
            </>
          )}
        </>
      )}
    </div>
  );
}

// One tab stop for the whole list, however many LIVEs it has
const MOVES: Record<string, (index: number, last: number) => number> = {
  ArrowDown: (index, last) => Math.min(index + 1, last),
  ArrowUp: (index) => Math.max(index - 1, 0),
  Home: () => 0,
  End: (_, last) => last,
};

export function ListSection({
  lives,
  title,
  amount,
  tab,
  filter,
  filtered,
  selected,
  onSelect,
  onFilter,
}: Props) {
  const t = useT();
  const language = useLanguage();
  const options = [null, ...lives.map((live) => live.startedAt)];
  // The tab's money, or the gift count on All
  const currency = tab === "all" ? undefined : PLATFORM_CURRENCY[tab];
  const valueOf = (live: LiveSummary) => liveValue(live, tab);
  // The bars are scaled to the best LIVE
  const best = lives.reduce((max, live) => Math.max(max, valueOf(live)), 0);
  const label = (value: number) =>
    currency
      ? amountLabel(value, currency, language)
      : giftsLabel(value, language);

  const onKeyDown = (e: KeyboardEvent<HTMLUListElement>) => {
    const move = MOVES[e.key];
    if (!move) return;
    e.preventDefault();
    const index = move(options.indexOf(selected), options.length - 1);
    onSelect(options[index]);
    const items =
      e.currentTarget.querySelectorAll<HTMLElement>("[role=option]");
    items[index]?.focus();
  };

  const option = (value: number | null) => ({
    role: "option",
    "aria-selected": value === selected,
    tabIndex: value === selected ? 0 : -1,
    className: cx(styles.option, value === selected && styles.selected),
    onClick: () => onSelect(value),
  });

  const total = statText(amount, currency, language);
  const all = tab === "all";
  return (
    <div className={styles.side}>
      <DateFilterBar filter={filter} onChange={onFilter} />
      <ul
        className={styles.list}
        role="listbox"
        aria-label={t("coinStats.list.title")}
        onKeyDown={onKeyDown}
      >
        <li
          {...option(null)}
          aria-label={t("coinStats.list.option", {
            date: title,
            coins: label(amount),
          })}
        >
          <span className={cx(styles.all_time, all && styles.all_time_gifts)}>
            {title}
          </span>
          {all ? (
            // All counts gifts, named so they aren't read as money
            <span className={styles.total_gifts} title={total.full}>
              {rich(t("coinStats.list.gifts", { count: amount }), {
                amount: <span className={styles.coins}>{total.short}</span>,
              })}
            </span>
          ) : (
            <span className={styles.coins} title={total.full}>
              {total.short}
            </span>
          )}
        </li>
        {lives.map((live) => {
          const value = valueOf(live);
          const { short, full } = statText(value, currency, language);
          return (
            <li
              key={live.startedAt}
              {...option(live.startedAt)}
              aria-label={t("coinStats.list.option", {
                date: formatDate(live.startedAt, language, "dateTime"),
                coins: label(value),
              })}
            >
              <span className={styles.date}>
                {formatDate(live.startedAt, language, "short")}
              </span>
              <span className={styles.time}>
                {formatDate(live.startedAt, language, "time")}
              </span>
              <span className={styles.time}>
                {formatDuration(live.endedAt - live.startedAt)}
              </span>
              <span className={styles.coins} title={full}>
                {short}
              </span>
              <span
                className={styles.bar}
                style={{
                  width: best ? `${(value / best) * 100}%` : 0,
                }}
              />
            </li>
          );
        })}
      </ul>
      {lives.length === 0 && (
        <EmptyState>
          {t(filtered ? "coinStats.filter.empty" : "coinStats.list.empty")}
        </EmptyState>
      )}
    </div>
  );
}
