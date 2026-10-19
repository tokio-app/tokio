import { cx } from "@/helper/cx";
import { CSSProperties, ReactNode } from "react";
import styles from "./elements.module.css";

type Tab<T> = {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  // Icon color while the tab is active, e.g. a brand color
  accent?: string;
};

type Props<T extends string> = {
  tabs: Tab<T>[];
  value: T | null;
  onChange: (value: T) => void;
  // underline: tabs over a panel, pill: a segmented switch
  variant?: "underline" | "pill";
  disabled?: boolean;
};

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  variant = "underline",
  disabled,
}: Props<T>) {
  return (
    <div
      role="tablist"
      className={cx(
        styles.tabs,
        variant === "underline" ? styles.tabs_underline : styles.tabs_pill,
        disabled && styles.tabs_disabled,
      )}
    >
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={tab.value === value}
          disabled={disabled}
          className={cx(styles.tab, tab.value === value && styles.tab_active)}
          style={{ "--tab-accent": tab.accent } as CSSProperties}
          onClick={() => onChange(tab.value)}
        >
          {tab.icon}
          {tab.label}
        </button>
      ))}
    </div>
  );
}
