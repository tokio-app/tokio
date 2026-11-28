import { cx } from "@/helper/cx";
import { useT } from "@/ui/i18n";
import { ReactNode } from "react";
import { Btn, Check } from "../Elements";
import styles from "./giftselect.module.css";

// What the gift and emote pickers share: the checked list's bar and rows

/** Done without a change saves nothing. */
export const samePicks = <T,>(picked: T[], value: T[]) =>
  picked.length === value.length && picked.every((id, i) => id === value[i]);

/** The picks with `id` checked in or out. */
export const togglePick = <T,>(picked: T[], id: T) =>
  picked.includes(id)
    ? picked.filter((value) => value !== id)
    : [...picked, id];

type BarProps<T> = {
  // The list's count, as the bar's text names it
  items: string;
  selectAll: string;
  // The ids shown, in their order
  shown: T[];
  picked: T[];
  onChange: (picked: T[]) => void;
};

// How many items are shown and checked, and the actions on them
export function SelectionBar<T>({
  items,
  selectAll,
  shown,
  picked,
  onChange,
}: BarProps<T>) {
  const t = useT();
  const checked = new Set(picked);
  const unchecked = shown.filter((id) => !checked.has(id));

  return (
    <div className={styles.toolbar}>
      <span className={styles.count}>
        {t("components.picker.selected", { items, count: picked.length })}
      </span>
      <div className={styles.actions}>
        <Btn
          disabled={unchecked.length === 0}
          onClick={() => onChange([...picked, ...unchecked])}
        >
          {selectAll}
        </Btn>
        <Btn disabled={picked.length === 0} onClick={() => onChange([])}>
          {t("common.clear")}
        </Btn>
      </div>
    </div>
  );
}

type RowProps = {
  title: string;
  checked: boolean;
  onToggle: () => void;
  children: ReactNode;
};

// A row that checks its item in and out
export function CheckRow({ title, checked, onToggle, children }: RowProps) {
  return (
    <label className={cx(styles.row, checked && styles.current)} title={title}>
      <Check checked={checked} onChange={onToggle} />
      {children}
    </label>
  );
}
