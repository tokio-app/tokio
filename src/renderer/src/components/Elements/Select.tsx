import { cx } from "@/helper/cx";
import { usePopover } from "@/hooks/usePopover";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  KeyboardEvent,
  ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { FiChevronDown } from "react-icons/fi";
import { VscClose } from "react-icons/vsc";
import styles from "./elements.module.css";

type Value = string | number;

export type SelectOption<V extends Value = Value> = {
  label: string | number;
  value: V;
  img?: string;
};

type CommonProps<V extends Value> = {
  options: SelectOption<V>[];
  searchable?: boolean;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  "aria-label"?: string;
};

// The item's --control-height plus .select_row's 2px padding on each side
const OPTION_HEIGHT = 40;

export function Select<V extends Value>({
  value,
  onChange,
  ...common
}: CommonProps<V> & {
  value: V | undefined;
  onChange: (value: V) => void;
}) {
  const selected = common.options.find((opt) => opt.value === value);

  return (
    <SelectBase
      {...common}
      isSelected={(v) => v === value}
      onPick={(v) => {
        onChange(v);
        return true;
      }}
      display={
        selected ? (
          <span className={styles.select_label}>
            {selected.img && (
              <img src={selected.img} className={styles.select_img} />
            )}
            {selected.label}
          </span>
        ) : null
      }
    />
  );
}

export function MultiSelect<V extends Value>({
  value,
  onChange,
  ...common
}: CommonProps<V> & {
  value: V[];
  onChange: (value: V[]) => void;
}) {
  const selected = new Set(value);
  const chips = common.options.filter((opt) => selected.has(opt.value));

  return (
    <SelectBase
      {...common}
      multiple
      isSelected={(v) => selected.has(v)}
      onPick={(v) => {
        onChange(
          selected.has(v) ? value.filter((item) => item !== v) : [...value, v],
        );
        return false;
      }}
      display={
        chips.length > 0 ? (
          <span className={styles.select_chips}>
            {chips.map((chip) => (
              <span key={chip.value} className={styles.select_chip}>
                {chip.img && (
                  <img src={chip.img} className={styles.select_img} />
                )}
                {chip.label}
                {!common.disabled && (
                  <button
                    type="button"
                    aria-label={`Remove ${chip.label}`}
                    className={styles.select_chip_remove}
                    onClick={(e) => {
                      e.stopPropagation();
                      onChange(value.filter((item) => item !== chip.value));
                    }}
                  >
                    <VscClose size={18} />
                  </button>
                )}
              </span>
            ))}
          </span>
        ) : null
      }
    />
  );
}

type BaseProps<V extends Value> = CommonProps<V> & {
  // What the closed select shows, null for the placeholder
  display: ReactNode;
  isSelected: (value: V) => boolean;
  // Returns whether to close the list
  onPick: (value: V) => boolean;
  // More than one option can be picked
  multiple?: boolean;
};

function filterOptions<V extends Value>(
  options: SelectOption<V>[],
  search: string,
): SelectOption<V>[] {
  const needle = search.trim().toLowerCase();
  return options.filter((option) =>
    String(option.label).toLowerCase().includes(needle),
  );
}

type Move = "next" | "previous" | "first" | "last";

const MOVES: Partial<Record<string, Move>> = {
  ArrowDown: "next",
  ArrowUp: "previous",
  Home: "first",
  End: "last",
};

function SelectBase<V extends Value>({
  options,
  searchable,
  placeholder = "Select an option...",
  className,
  disabled,
  display,
  isSelected,
  onPick,
  multiple,
  "aria-label": ariaLabel,
}: BaseProps<V>) {
  const { open, toggle, close, position, anchorRef, popoverRef } = usePopover();
  const displayRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const [search, setSearch] = useState("");
  // Option the keyboard is on, -1 for none
  const [active, setActive] = useState(-1);

  const rows = useMemo(() => filterOptions(options, search), [options, search]);
  const optionId = (index: number) => `${listId}-${index}`;
  const activeId = open && rows[active] ? optionId(active) : undefined;

  // Opens on the selected option, or the first, with an empty search
  const openList = () => {
    const selected = options.findIndex((option) => isSelected(option.value));
    setSearch("");
    setActive(Math.max(selected, 0));
    toggle();
  };

  // The list is portaled, so the focus comes back to the select
  const closeList = () => {
    close();
    displayRef.current?.focus();
  };

  const pick = (value: V) => {
    if (onPick(value)) closeList();
  };

  const move = (to: Move) => {
    if (rows.length === 0) return;
    const at = rows[active] ? active : -1;
    const last = rows.length - 1;
    setActive(
      {
        first: 0,
        last,
        next: at === -1 ? 0 : Math.min(at + 1, last),
        previous: at === -1 ? last : Math.max(at - 1, 0),
      }[to],
    );
  };

  const onKeyDown = (e: KeyboardEvent<HTMLElement>, fromSearch = false) => {
    if (!open) {
      if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(e.key)) {
        e.preventDefault();
        openList();
      }
      return;
    }

    // The search keeps these for its text
    if (fromSearch && [" ", "Home", "End"].includes(e.key)) return;

    const to = MOVES[e.key];
    if (to) {
      e.preventDefault();
      move(to);
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const option = rows[active];
      if (option) pick(option.value);
    } else if (e.key === "Escape") {
      // Closes the list, not a modal it's in
      e.preventDefault();
      e.stopPropagation();
      closeList();
    } else if (e.key === "Tab") {
      // The search is portaled to the end of the page, Tab would land there
      if (fromSearch) {
        e.preventDefault();
        closeList();
      } else {
        close();
      }
    }
  };

  return (
    <div ref={anchorRef} className={className}>
      <div
        ref={displayRef}
        role="combobox"
        aria-label={ariaLabel}
        tabIndex={disabled ? -1 : 0}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={searchable ? undefined : activeId}
        aria-disabled={disabled || undefined}
        className={cx(
          styles.select_display,
          disabled && styles.select_display_disabled,
        )}
        onClick={disabled ? undefined : () => (open ? close() : openList())}
        onKeyDown={(e) => {
          // Keys on the chips' remove buttons are theirs
          if (!disabled && e.target === e.currentTarget) onKeyDown(e);
        }}
      >
        {display ?? (
          <span className={styles.select_placeholder}>{placeholder}</span>
        )}
        <FiChevronDown
          size={16}
          className={cx(
            styles.select_chevron,
            open && styles.select_chevron_open,
          )}
        />
      </div>

      {open &&
        createPortal(
          <div ref={popoverRef} className={styles.popover} style={position}>
            <SelectMenu
              rows={rows}
              listId={listId}
              optionId={optionId}
              active={active}
              activeId={activeId}
              multiple={multiple}
              searchable={searchable}
              search={search}
              isSelected={isSelected}
              onSearch={(text) => {
                setSearch(text);
                setActive(0);
              }}
              onActive={setActive}
              onPick={pick}
              onKeyDown={(e) => onKeyDown(e, true)}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}

// Mounted only while open
function SelectMenu<V extends Value>({
  rows,
  listId,
  optionId,
  active,
  activeId,
  multiple,
  searchable,
  search,
  isSelected,
  onSearch,
  onActive,
  onPick,
  onKeyDown,
}: {
  rows: SelectOption<V>[];
  listId: string;
  optionId: (index: number) => string;
  active: number;
  activeId: string | undefined;
  multiple?: boolean;
  searchable?: boolean;
  search: string;
  isSelected: (value: V) => boolean;
  onSearch: (text: string) => void;
  onActive: (index: number) => void;
  onPick: (value: V) => void;
  onKeyDown: (e: KeyboardEvent<HTMLInputElement>) => void;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => OPTION_HEIGHT,
    overscan: 5,
  });

  // Keeps the keyboard's option in view
  useEffect(() => {
    if (active >= 0 && active < rows.length) {
      virtualizer.scrollToIndex(active, { align: "auto" });
    }
  }, [active, rows.length, virtualizer]);

  return (
    <>
      {searchable && (
        <div className={styles.select_search}>
          <input
            type="text"
            placeholder="Search..."
            className={styles.select_search_input}
            value={search}
            aria-controls={listId}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            onChange={(e) => onSearch(e.target.value)}
            onKeyDown={onKeyDown}
            autoFocus
          />
        </div>
      )}

      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-multiselectable={multiple || undefined}
        className={styles.select_list}
      >
        {rows.length === 0 ? (
          <div className={styles.select_empty}>No options found</div>
        ) : (
          <div
            className={styles.select_rows}
            style={{ height: virtualizer.getTotalSize() }}
          >
            {virtualizer.getVirtualItems().map((item) => {
              const option = rows[item.index];
              const selected = isSelected(option.value);
              return (
                <div
                  key={item.key}
                  role="presentation"
                  className={styles.select_row}
                  style={{
                    height: item.size,
                    transform: `translateY(${item.start}px)`,
                  }}
                >
                  <div
                    id={optionId(item.index)}
                    role="option"
                    aria-selected={selected}
                    className={cx(
                      styles.select_item,
                      selected && styles.select_item_active,
                      item.index === active && styles.select_item_focused,
                    )}
                    // Keeps the focus on the select or its search
                    onMouseDown={(e) => e.preventDefault()}
                    onMouseMove={() => onActive(item.index)}
                    onClick={() => onPick(option.value)}
                  >
                    {option.img && (
                      <img src={option.img} className={styles.select_img} />
                    )}
                    {option.label}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}
