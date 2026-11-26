import { cx } from "@/helper/cx";
import { ReactNode } from "react";
import { FiX } from "react-icons/fi";
import styles from "./elements.module.css";

declare module "react" {
  interface CSSProperties {
    "--tab-accent"?: string;
    "--tab-anchor"?: string;
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
  // The id of the role="tabpanel" the tabs show
  panelId?: string;
  className?: string;
};

// Where the arrow keys go from the tab at `at` of `count`, wrapping around
const MOVES: Record<string, (at: number, count: number) => number> = {
  ArrowRight: (at, count) => (at + 1) % count,
  ArrowLeft: (at, count) => (at - 1 + count) % count,
  Home: () => 0,
  End: (_, count) => count - 1,
};

const tabId = (panelId: string, value: string) => `${panelId}-tab-${value}`;

/**
 * The props of the panel the Tabs with this `panelId` show, named by the
 * selected tab.
 */
export function tabPanel(panelId: string, value: string | null) {
  return {
    role: "tabpanel",
    id: panelId,
    "aria-labelledby": value === null ? undefined : tabId(panelId, value),
  } as const;
}

/**
 * Tabs with one stop in the Tab order, the selected tab's, and the arrow
 * keys, Home and End moving the selection.
 */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  variant = "underline",
  disabled,
  label,
  panelId,
  className,
}: Props<T>) {
  // With none selected, the first is the one Tab reaches
  const stop = tabs.some((tab) => tab.value === value) ? value : tabs[0]?.value;

  const row = cx(
    styles.tabs,
    variant === "underline" ? styles.tabs_underline : styles.tabs_pill,
    disabled && styles.tabs_disabled,
    className,
  );
  const closable = tabs.some((tab) => tab.onClose);

  const list = (
    <div
      role="tablist"
      aria-label={label}
      // With a ×, the row holds the list and the ×s
      className={closable ? styles.tablist : row}
      onKeyDown={(e) => {
        const move = MOVES[e.key];
        const buttons = [
          ...e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]'),
        ];
        const at = buttons.findIndex((button) => button === e.target);
        if (!move || at === -1) return;
        e.preventDefault();
        const to = move(at, buttons.length);
        buttons[to].focus();
        onChange(tabs[to].value);
      }}
    >
      {tabs.map((tab, i) => {
        const active = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            id={panelId ? tabId(panelId, tab.value) : undefined}
            aria-selected={active}
            aria-controls={panelId}
            tabIndex={tab.value === stop ? 0 : -1}
            disabled={disabled}
            className={cx(
              styles.tab,
              active && styles.tab_active,
              tab.onClose && styles.tab_closable,
            )}
            style={{
              "--tab-accent": tab.accent,
              "--tab-anchor": tab.onClose ? `--tab-${i}` : undefined,
            }}
            onClick={() => onChange(tab.value)}
          >
            {tab.icon}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
  if (!closable) return list;

  return (
    <div className={row}>
      {list}
      {/* Only tabs belong in the list, so each × is out of it, placed over
          its tab's right padding like a browser tab's. The open tab's is
          the one in the Tab order, so Tab doesn't stop on every tab's. */}
      {tabs.map(
        (tab, i) =>
          tab.onClose && (
            <button
              key={tab.value}
              type="button"
              className={styles.tab_close}
              style={{ "--tab-anchor": `--tab-${i}` }}
              title={tab.closeLabel}
              aria-label={tab.closeLabel}
              aria-hidden={tab.value === value ? undefined : true}
              tabIndex={tab.value === value ? undefined : -1}
              disabled={disabled}
              onClick={tab.onClose}
            >
              <FiX size={14} aria-hidden />
            </button>
          ),
      )}
    </div>
  );
}
