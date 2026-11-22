import { cx } from "@/helper/cx";
import { ReactNode } from "react";
import { FiX } from "react-icons/fi";
import styles from "./elements.module.css";

declare module "react" {
  interface CSSProperties {
    "--tab-accent"?: string;
  }
}

type Tab<T> = {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  // Icon color while the tab is active, e.g. a brand color
  accent?: string;
  // A tab that can be closed gets a × inside it, named by closeLabel
  onClose?: () => void;
  closeLabel?: string;
};

type Props<T extends string> = {
  tabs: Tab<T>[];
  value: T | null;
  onChange: (value: T) => void;
  // underline: tabs over a panel, pill: a segmented switch
  variant?: "underline" | "pill";
  disabled?: boolean;
  // Names the list for screen readers
  label?: string;
  className?: string;
};

export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  variant = "underline",
  disabled,
  label,
  className,
}: Props<T>) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className={cx(
        styles.tabs,
        variant === "underline" ? styles.tabs_underline : styles.tabs_pill,
        disabled && styles.tabs_disabled,
        className,
      )}
    >
      {tabs.map((tab) => {
        const active = tab.value === value;
        const button = (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={active}
            disabled={disabled}
            className={cx(styles.tab, active && styles.tab_active)}
            style={{ "--tab-accent": tab.accent }}
            onClick={() => onChange(tab.value)}
          >
            {tab.icon}
            {tab.label}
          </button>
        );
        if (!tab.onClose) return button;
        return (
          <div key={tab.value} className={styles.tab_closable}>
            {button}
            {/* Like a browser tab's. The open tab's is the one in the Tab
                order, so Tab doesn't stop twice on every tab. */}
            <button
              type="button"
              className={styles.tab_close}
              title={tab.closeLabel}
              aria-label={tab.closeLabel}
              aria-hidden={active ? undefined : true}
              tabIndex={active ? undefined : -1}
              disabled={disabled}
              onClick={tab.onClose}
            >
              <FiX size={14} aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
