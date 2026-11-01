import { LiveSummary } from "@/common/types";
import { EmptyState } from "@/components";
import { cx, formatDate, formatDuration, formatStat } from "@/helper";
import { coinsLabel } from "@/helper/gifts";
import { useLanguage, useT } from "@/ui/i18n";
import { KeyboardEvent } from "react";
import styles from "../lives.module.css";

interface Props {
  // Newest first
  lives: LiveSummary[];
  // All time's
  coins: number;
  // A LIVE's startedAt, or null for All time
  selected: number | null;
  onSelect: (selected: number | null) => void;
}

// One tab stop for the whole list, however many LIVEs it has
const MOVES: Record<string, (index: number, last: number) => number> = {
  ArrowDown: (index, last) => Math.min(index + 1, last),
  ArrowUp: (index) => Math.max(index - 1, 0),
  Home: () => 0,
  End: (_, last) => last,
};

export function ListSection({ lives, coins, selected, onSelect }: Props) {
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
      <ul
        className={styles.list}
        role="listbox"
        aria-label={t("lives.list.title")}
        onKeyDown={onKeyDown}
      >
        <li
          {...option(null)}
          aria-label={t("lives.list.option", {
            date: t("lives.allTime.title"),
            coins: coinsLabel(coins, language),
          })}
        >
          <span className={styles.all_time}>{t("lives.allTime.title")}</span>
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
      {lives.length === 0 && <EmptyState>{t("lives.list.empty")}</EmptyState>}
    </div>
  );
}
