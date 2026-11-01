import { cx } from "@/helper/cx";
import { usePopover } from "@/hooks/usePopover";
import { useLanguage, useT } from "@/ui/i18n";
import {
  ComponentProps,
  KeyboardEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  FiCalendar,
  FiChevronLeft,
  FiChevronRight,
  FiClock,
} from "react-icons/fi";
import { VscClose } from "react-icons/vsc";
import { Btn } from "../Elements/Btn";
import elements from "../Elements/elements.module.css";
import { Input } from "../Elements/Input";
import {
  addDays,
  addMonths,
  dayPeriods,
  firstDayOfWeek,
  formatValue,
  fromIso,
  monthWeeks,
  pad,
  toIso,
  uses12Hours,
} from "./calendar";
import styles from "./datetimepicker.module.css";

// A day and, optionally, a time of it
export type DateTimeValue = {
  // "YYYY-MM-DD", "" until one is picked
  date: string;
  // "HH:MM" in 24 hours, "" for none: the whole day
  time: string;
};

export const NO_DATE: DateTimeValue = { date: "", time: "" };

type Props = {
  value: DateTimeValue;
  onChange: (value: DateTimeValue) => void;
  // Also offers a time, which can stay empty
  withTime?: boolean;
  // Names the field, which shows no label
  "aria-label": string;
  className?: string;
};

/**
 * A date, and a time with `withTime`, picked from Tokio's own calendar, so it
 * looks the same on every system and follows the app's language.
 */
export function DateTimePicker({
  value,
  onChange,
  withTime,
  "aria-label": label,
  className,
}: Props) {
  const t = useT();
  const language = useLanguage();
  const { open, toggle, close, position, anchorRef, popoverRef } = usePopover();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const valueId = useId();
  const shown = formatValue(language, value);

  // The popover is portaled, so the focus comes back to the trigger
  const closePopover = () => {
    close();
    triggerRef.current?.focus();
  };

  return (
    <div ref={anchorRef} className={className}>
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-describedby={shown ? valueId : undefined}
        aria-haspopup="dialog"
        aria-expanded={open}
        className={cx(elements.select_display, styles.trigger)}
        onClick={toggle}
        onKeyDown={(e) => {
          if (!open && e.key === "ArrowDown") {
            e.preventDefault();
            toggle();
          }
        }}
      >
        <span
          id={valueId}
          className={
            shown ? elements.select_label : elements.select_placeholder
          }
        >
          {shown ?? t("components.dateTimePicker.placeholder")}
        </span>
        <FiCalendar size={16} className={styles.icon} />
      </button>

      {open &&
        createPortal(
          <div
            ref={popoverRef}
            role="dialog"
            aria-label={label}
            className={cx(elements.popover, styles.popover)}
            style={{
              top: position.top,
              bottom: position.bottom,
              left: position.left,
            }}
            onKeyDown={(e) => {
              if (e.key === "Tab") {
                // Portaled after the page, Tab out of it would leave a
                // dialog it's in: it goes back to the trigger instead
                const items = [
                  ...e.currentTarget.querySelectorAll<HTMLElement>(
                    "button, input",
                  ),
                ].filter((el) => !el.matches(":disabled") && el.tabIndex >= 0);
                const edge = e.shiftKey ? items[0] : items.at(-1);
                if (document.activeElement !== edge) return;
              } else if (e.key !== "Escape") {
                return;
              }
              // Closes the popover, not a modal it's in
              e.preventDefault();
              e.stopPropagation();
              closePopover();
            }}
          >
            <Panel
              value={value}
              withTime={withTime}
              onChange={onChange}
              onDone={closePopover}
            />
          </div>,
          document.body,
        )}
    </div>
  );
}

type PanelProps = {
  value: DateTimeValue;
  withTime?: boolean;
  onChange: (value: DateTimeValue) => void;
  onDone: () => void;
};

// Mounted only while open, so each opening starts on the value's month
function Panel({ value, withTime, onChange, onDone }: PanelProps) {
  const t = useT();
  const language = useLanguage();
  const today = toIso(new Date());
  // The day with the grid's tab stop, its month is the one shown
  const [focused, setFocused] = useState(value.date || today);
  // Set by the keys, so the focus follows them and not a click elsewhere
  const moveFocus = useRef(true);
  const gridRef = useRef<HTMLTableElement>(null);
  const titleId = useId();

  const weekStart = firstDayOfWeek(language);
  const weeks = useMemo(
    () => monthWeeks(focused, weekStart),
    [focused, weekStart],
  );
  const formats = useMemo(
    () => ({
      title: new Intl.DateTimeFormat(language, {
        month: "long",
        year: "numeric",
      }),
      day: new Intl.DateTimeFormat(language, { dateStyle: "full" }),
      narrow: new Intl.DateTimeFormat(language, { weekday: "narrow" }),
      long: new Intl.DateTimeFormat(language, { weekday: "long" }),
    }),
    [language],
  );

  useEffect(() => {
    if (!moveFocus.current) return;
    moveFocus.current = false;
    gridRef.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus();
  }, [focused]);

  const month = fromIso(focused).getMonth();
  // Sentence case: Spanish writes months in lowercase
  const titleText = formats.title.format(fromIso(focused));
  const title = titleText[0].toLocaleUpperCase(language) + titleText.slice(1);

  const pick = (date: string) => {
    setFocused(date);
    onChange({ date, time: value.time });
    if (!withTime) onDone();
  };

  const onGridKey = (e: KeyboardEvent<HTMLTableElement>) => {
    // Its place in the week, 0 for the first day
    const column = (fromIso(focused).getDay() - weekStart + 7) % 7;
    const moves: Record<string, () => string> = {
      ArrowLeft: () => addDays(focused, -1),
      ArrowRight: () => addDays(focused, 1),
      ArrowUp: () => addDays(focused, -7),
      ArrowDown: () => addDays(focused, 7),
      PageUp: () => addMonths(focused, -1),
      PageDown: () => addMonths(focused, 1),
      Home: () => addDays(focused, -column),
      End: () => addDays(focused, 6 - column),
    };
    const move = moves[e.key];
    if (!move) return;
    e.preventDefault();
    moveFocus.current = true;
    setFocused(move());
  };

  return (
    <>
      <div className={styles.header}>
        <Btn
          variant="icon"
          title={t("components.dateTimePicker.previousMonth")}
          onClick={() => setFocused(addMonths(focused, -1))}
        >
          <FiChevronLeft size={18} />
        </Btn>
        <div id={titleId} className={styles.title} aria-live="polite">
          {title}
        </div>
        <Btn
          variant="icon"
          title={t("components.dateTimePicker.nextMonth")}
          onClick={() => setFocused(addMonths(focused, 1))}
        >
          <FiChevronRight size={18} />
        </Btn>
      </div>

      <table
        ref={gridRef}
        role="grid"
        aria-labelledby={titleId}
        className={styles.grid}
        onKeyDown={onGridKey}
      >
        <thead>
          <tr>
            {weeks[0].map((day) => (
              <th
                key={day}
                scope="col"
                aria-label={formats.long.format(fromIso(day))}
                className={styles.weekday}
              >
                {formats.narrow.format(fromIso(day))}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week[0]}>
              {week.map((day) => {
                const date = fromIso(day);
                const selected = day === value.date;
                return (
                  <td key={day} role="gridcell" aria-selected={selected}>
                    <button
                      type="button"
                      tabIndex={day === focused ? 0 : -1}
                      aria-label={formats.day.format(date)}
                      aria-current={day === today ? "date" : undefined}
                      className={cx(
                        styles.day,
                        date.getMonth() !== month && styles.day_outside,
                        day === today && styles.day_today,
                        selected && styles.day_selected,
                      )}
                      onClick={() => pick(day)}
                    >
                      {date.getDate()}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>

      {withTime && (
        <TimeFields
          time={value.time}
          disabled={!value.date}
          onChange={(time) => onChange({ ...value, time })}
        />
      )}

      <div className={styles.footer}>
        <Btn variant="icon" onClick={() => pick(today)}>
          {t("components.dateTimePicker.today")}
        </Btn>
        <Btn
          variant="icon"
          onClick={() => {
            onChange(NO_DATE);
            onDone();
          }}
        >
          {t("common.clear")}
        </Btn>
      </div>
    </>
  );
}

type TimeProps = {
  // "HH:MM" or "" for none
  time: string;
  // Until a day is picked
  disabled: boolean;
  onChange: (time: string) => void;
};

function TimeFields({ time, disabled, onChange }: TimeProps) {
  const t = useT();
  const language = useLanguage();
  const twelve = uses12Hours(language);
  const hourRef = useRef<HTMLInputElement>(null);
  // An empty time starts from midnight once a part is set
  const [hours, minutes] = time ? time.split(":").map(Number) : [0, 0];
  const afternoon = hours >= 12;
  const set = (h: number, m: number) => onChange(`${pad(h)}:${pad(m)}`);

  return (
    <div
      role="group"
      aria-label={t("components.dateTimePicker.time")}
      className={styles.time}
    >
      <FiClock size={16} className={styles.icon} aria-hidden />
      <TimePart
        ref={hourRef}
        aria-label={t("components.dateTimePicker.hours")}
        value={time ? (twelve ? hours % 12 || 12 : hours) : null}
        min={twelve ? 1 : 0}
        max={twelve ? 12 : 23}
        disabled={disabled}
        onPart={(h) =>
          set(twelve ? (h % 12) + (afternoon ? 12 : 0) : h, minutes)
        }
      />
      <span className={styles.colon} aria-hidden />
      <TimePart
        aria-label={t("components.dateTimePicker.minutes")}
        value={time ? minutes : null}
        twoDigits
        min={0}
        max={59}
        disabled={disabled}
        onPart={(m) => set(hours, m)}
      />
      {twelve && (
        <div className={styles.periods}>
          {dayPeriods(language).map((period, i) => (
            <button
              key={period}
              type="button"
              aria-pressed={Boolean(time) && afternoon === (i === 1)}
              disabled={disabled}
              className={styles.period}
              onClick={() => set((hours % 12) + i * 12, minutes)}
            >
              {period}
            </button>
          ))}
        </div>
      )}
      <Btn
        variant="icon"
        title={t("components.dateTimePicker.clearTime")}
        disabled={disabled || !time}
        className={styles.clear_time}
        onClick={() => {
          onChange("");
          // The button is disabled now, the focus would fall to the page
          hourRef.current?.focus();
        }}
      >
        <VscClose size={16} />
      </Btn>
    </div>
  );
}

type PartProps = {
  // null while the time is empty
  value: number | null;
  min: number;
  max: number;
  // Minutes show 2 digits, hours as they're said
  twoDigits?: boolean;
  onPart: (value: number) => void;
} & Omit<ComponentProps<"input">, "value" | "min" | "max">;

// Keeps the text as typed while it has the focus, reports only valid numbers.
// Text, not a number field, which would drop the minutes' leading zero.
function TimePart({ value, min, max, twoDigits, onPart, ...rest }: PartProps) {
  const t = useT();
  const [typed, setTyped] = useState<string | null>(null);
  const shown = value === null ? "" : twoDigits ? pad(value) : String(value);

  return (
    <Input
      {...rest}
      inputMode="numeric"
      placeholder={t("components.dateTimePicker.timePlaceholder")}
      className={styles.time_part}
      value={typed ?? shown}
      onChange={(e) => {
        // The last 2 digits, so typing over "00" gives "05"
        const text = e.target.value.replace(/\D/g, "").slice(-2);
        const number = Number(text);
        setTyped(text);
        if (text !== "" && number >= min && number <= max) {
          onPart(number);
        }
      }}
      onKeyDown={(e) => {
        // Steps like a number field, around the clock
        const step = { ArrowUp: 1, ArrowDown: -1 }[e.key];
        if (!step) return;
        e.preventDefault();
        const span = max - min + 1;
        setTyped(null);
        onPart(
          value === null ? min : ((value - min + step + span) % span) + min,
        );
      }}
      onBlur={() => setTyped(null)}
    />
  );
}
