import { LiveSummary } from "@/common/types";
import { DateTimePicker, EmptyState, Select } from "@/components";
import { cx, formatDate, formatDuration, formatStat } from "@/helper";
import { coinsLabel } from "@/helper/gifts";
import { useLanguage, useOptions, useT } from "@/ui/i18n";
import { KeyboardEvent } from "react";
import styles from "../lives.module.css";
import { DATE_OPERATORS, DATE_PRESETS, DateFilter } from "../helper";

interface Props {
  // The ones the filter keeps, newest first
  lives: LiveSummary[];
  // The first row's: All time, or the days the filter keeps
  title: string;
  coins: number;
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
        aria-label={t("lives.filter.label")}
        options={presets}
        value={filter.preset}
        onChange={(preset) => onChange({ ...filter, preset })}
      />
      {filter.preset === "custom" && (
        <>
          <Select
            aria-label={t("lives.filter.operator")}
            options={operators}
            value={operator}
            onChange={(value) => onChange({ ...filter, operator: value })}
          />
          <DateTimePicker
            aria-label={t("lives.filter.date")}
            withTime={operator !== "on"}
            value={filter.from}
            onChange={(from) => onChange({ ...filter, from })}
          />
          {operator === "between" && (
            <>
              <span className={styles.and}>{t("lives.filter.and")}</span>
              <DateTimePicker
                aria-label={t("lives.filter.toDate")}
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
  coins,
  filter,
  filtered,
  selected,
  onSelect,
  onFilter,
}: Props) {
  const t = useT();
  const language = useLanguage();
  const options = [null, ...lives.map((live) => live.startedAt)];
  // The bars are scaled to the best LIVE
  const best = lives.reduce((max, live) => Math.max(max, live.coins), 0);

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

  const total = formatStat(coins, language);
  return (
    <div className={styles.side}>
      <DateFilterBar filter={filter} onChange={onFilter} />
      <ul
        className={styles.list}
        role="listbox"
        aria-label={t("lives.list.title")}
        onKeyDown={onKeyDown}
      >
        <li
          {...option(null)}
          aria-label={t("lives.list.option", {
            date: title,
            coins: coinsLabel(coins, language),
          })}
        >
          <span className={styles.all_time}>{title}</span>
          <span className={styles.coins} title={total.full}>
            {total.short}
          </span>
        </li>
        {lives.map((live) => {
          const { short, full } = formatStat(live.coins, language);
          return (
            <li
              key={live.startedAt}
              {...option(live.startedAt)}
              aria-label={t("lives.list.option", {
                date: formatDate(live.startedAt, language, "dateTime"),
                coins: coinsLabel(live.coins, language),
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
                style={{ width: best ? `${(live.coins / best) * 100}%` : 0 }}
              />
            </li>
          );
        })}
      </ul>
      {lives.length === 0 && (
        <EmptyState>
          {t(filtered ? "lives.filter.empty" : "lives.list.empty")}
        </EmptyState>
      )}
    </div>
  );
}
