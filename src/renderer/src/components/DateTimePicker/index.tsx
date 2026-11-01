import { cx } from "@/helper/cx";
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
 * looks the same on every system.
 */
export function DateTimePicker({
  value,
  onChange,
  withTime,
  "aria-label": label,
  className,
}: Props) {
  // shortcut: the browser's fields until Tokio's calendar replaces them
  return (
    <span className={cx(styles.picker, className)}>
      <input
        type="date"
        aria-label={label}
        value={value.date}
        onChange={(e) => onChange({ ...value, date: e.target.value })}
      />
      {withTime && (
        <input
          type="time"
          aria-label={label}
          value={value.time}
          onChange={(e) => onChange({ ...value, time: e.target.value })}
        />
      )}
    </span>
  );
}
