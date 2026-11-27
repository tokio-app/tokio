import { cx } from "@/helper/cx";
import { DragEvent, ReactNode, useState } from "react";
import { flushSync } from "react-dom";
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
  // Dragged onto another movable tab, or moved by Alt and an arrow, it takes
  // that one's place
  movable?: boolean;
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
  // Every tab's value in the new order, after a movable one moved
  onReorder?: (values: T[]) => void;
};

// Where the arrow keys go from the tab at `at` of `count`, wrapping around
const MOVES: Record<string, (at: number, count: number) => number> = {
  ArrowRight: (at, count) => (at + 1) % count,
  ArrowLeft: (at, count) => (at - 1 + count) % count,
  Home: () => 0,
  End: (_, count) => count - 1,
};

// Where Alt and an arrow move a movable tab
const STEPS: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };

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
 * keys, Home and End moving the selection. With onReorder, movable tabs
 * move by dragging or with Alt and the arrows.
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
  onReorder,
}: Props<T>) {
  // With none selected, the first is the one Tab reaches
  const stop = tabs.some((tab) => tab.value === value) ? value : tabs[0]?.value;
  // The tab being dragged and the one it's over, whose place it takes
  const [drag, setDrag] = useState<{ value: T; over?: T } | null>(null);
  const from = tabs.findIndex((tab) => tab.value === drag?.value);
  const over = tabs.findIndex((tab) => tab.value === drag?.over);

  // The values with the tab at `at` moved to `to`
  const moved = (at: number, to: number) => {
    const values = tabs.map((tab) => tab.value);
    values.splice(to, 0, ...values.splice(at, 1));
    return values;
  };

  const enter = (tab: Tab<T>) => {
    if (drag && tab.movable && drag.over !== tab.value) {
      setDrag({ ...drag, over: tab.value });
    }
  };

  // The row takes the drop, its ×s and gaps too. Only a tab's own drag
  // drops here, not files or text.
  const dropZone = onReorder && {
    onDragOver: (e: DragEvent) => {
      if (drag) e.preventDefault();
    },
    onDrop: (e: DragEvent) => {
      if (!drag) return;
      e.preventDefault();
      if (from !== -1 && over !== -1 && over !== from) {
        onReorder(moved(from, over));
      }
      setDrag(null);
    },
    // Also when it's cancelled or dropped elsewhere: nothing moves
    onDragEnd: () => setDrag(null),
  };

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
      {...(!closable && dropZone)}
      onKeyDown={(e) => {
        const list = e.currentTarget;
        const buttons = [...list.querySelectorAll<HTMLElement>('[role="tab"]')];
        const at = buttons.findIndex((button) => button === e.target);
        if (at === -1) return;
        const step = onReorder && e.altKey ? STEPS[e.key] : undefined;
        if (onReorder && step) {
          e.preventDefault();
          const to = at + step;
          if (!tabs[at].movable || !tabs[to]?.movable) return;
          flushSync(() => onReorder(moved(at, to)));
          // Out and back in, so a screen reader says where it is now. The
          // move may have dropped the focus on <body>.
          const tab = list.querySelectorAll<HTMLElement>('[role="tab"]')[to];
          tab.blur();
          tab.focus();
          return;
        }
        const move = MOVES[e.key];
        if (!move) return;
        e.preventDefault();
        const to = move(at, buttons.length);
        buttons[to].focus();
        onChange(tabs[to].value);
      }}
    >
      {tabs.map((tab, i) => {
        const active = tab.value === value;
        const movable = onReorder && tab.movable;
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
            aria-keyshortcuts={
              movable ? "Alt+ArrowLeft Alt+ArrowRight" : undefined
            }
            className={cx(
              styles.tab,
              active && styles.tab_active,
              tab.onClose && styles.tab_closable,
              i === from && styles.tab_dragged,
              // A line on the side it lands on
              i === over &&
                i !== from &&
                (i > from ? styles.tab_after : styles.tab_before),
            )}
            style={{
              "--tab-accent": tab.accent,
              "--tab-anchor": tab.onClose ? `--tab-${i}` : undefined,
            }}
            draggable={movable || undefined}
            onDragStart={
              movable
                ? (e) => {
                    e.dataTransfer.effectAllowed = "move";
                    setDrag({ value: tab.value });
                  }
                : undefined
            }
            onDragEnter={() => enter(tab)}
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
    <div className={row} {...dropZone}>
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
              className={cx(styles.tab_close, i === from && styles.tab_dragged)}
              style={{ "--tab-anchor": `--tab-${i}` }}
              title={tab.closeLabel}
              aria-label={tab.closeLabel}
              aria-hidden={tab.value === value ? undefined : true}
              tabIndex={tab.value === value ? undefined : -1}
              disabled={disabled}
              onDragEnter={() => enter(tab)}
              onClick={tab.onClose}
            >
              <FiX size={14} aria-hidden />
            </button>
          ),
      )}
    </div>
  );
}
