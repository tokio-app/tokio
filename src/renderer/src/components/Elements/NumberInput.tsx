import { cx } from "@/helper/cx";
import { ComponentProps, useRef, useState } from "react";
import styles from "./elements.module.css";
import { Input } from "./Input";

type Props = {
  value: number;
  onChange: (value: number) => void;
  // Only whole numbers are reported
  integer?: boolean;
  min?: number;
  max?: number;
  // Pressed and dragged across, the value goes up to the right and down to
  // the left, a step per px (ten with Shift). A click types in it.
  scrub?: boolean;
} & Omit<
  ComponentProps<"input">,
  "value" | "onChange" | "type" | "min" | "max"
>;

// Screen px a press moves before it changes the value, so a click doesn't
const SCRUB_START = 3;

/**
 * A number field that can be emptied while typing. The text is kept as typed
 * and reported once it's a number within the limits. Leaving the field shows
 * the last reported value again.
 */
export function NumberInput({
  value,
  onChange,
  integer,
  min,
  max,
  scrub,
  className,
  onBlur,
  ...rest
}: Props) {
  const [text, setText] = useState(String(value));
  const [prevValue, setPrevValue] = useState(value);
  // A press that drags the value: where it went down and the value then, the
  // pointer's last x, the steps moved since and the last value reported
  const press = useRef<{
    start: number;
    from: number;
    x: number;
    steps: number;
    sent: number;
    moved: boolean;
  } | null>(null);
  const [pressed, setPressed] = useState(false);

  // A value from outside replaces the text, the field's own doesn't
  // Object.is, as NaN !== NaN would set the state on every render
  if (!Object.is(value, prevValue)) {
    setPrevValue(value);
    if (text.trim() === "" || Number(text) !== value) setText(String(value));
  }

  const valid = (number: number) =>
    Number.isFinite(number) &&
    (!integer || Number.isInteger(number)) &&
    (min === undefined || number >= min) &&
    (max === undefined || number <= max);

  const step = integer ? 1 : Number(rest.step) || 1;
  const release = () => {
    press.current = null;
    setPressed(false);
  };

  const scrubbing: ComponentProps<"input"> = scrub
    ? {
        onPointerDown: (e) => {
          // A field being typed in keeps its caret and selection
          if (e.button !== 0 || e.currentTarget === document.activeElement)
            return;
          press.current = {
            start: e.clientX,
            from: value,
            x: e.clientX,
            steps: 0,
            sent: value,
            moved: false,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
          setPressed(true);
        },
        // Not focused yet, nor its text selected: a click does that
        onMouseDown: (e) => {
          if (press.current) e.preventDefault();
        },
        onPointerMove: (e) => {
          const p = press.current;
          if (!p) return;
          p.steps += (e.clientX - p.x) * (e.shiftKey ? 10 : 1);
          p.x = e.clientX;
          if (!p.moved && Math.abs(e.clientX - p.start) < SCRUB_START) return;
          p.moved = true;
          const raw = p.from + Math.round(p.steps) * step;
          const next = Math.min(
            max ?? Infinity,
            Math.max(min ?? -Infinity, raw),
          );
          // At a limit, turning back changes it at once
          if (next !== raw) p.steps = (next - p.from) / step;
          if (next === p.sent || !valid(next)) return;
          p.sent = next;
          onChange(next);
        },
        onPointerUp: (e) => {
          const p = press.current;
          release();
          // A click: in the field, its number selected to type over
          if (p && !p.moved) {
            e.currentTarget.focus();
            e.currentTarget.select();
          }
        },
        onLostPointerCapture: release,
      }
    : {};

  return (
    <Input
      {...rest}
      {...scrubbing}
      className={cx(className, pressed && styles.scrubbing)}
      type="number"
      min={min}
      max={max}
      step={integer ? 1 : rest.step}
      value={text}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        if (next.trim() !== "" && valid(Number(next))) onChange(Number(next));
      }}
      onBlur={(e) => {
        setText(String(value));
        onBlur?.(e);
      }}
    />
  );
}
