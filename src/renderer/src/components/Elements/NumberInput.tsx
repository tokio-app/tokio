import { ComponentProps, useState } from "react";
import { Input } from "./Input";

type Props = {
  value: number;
  onChange: (value: number) => void;
  // Only whole numbers are reported
  integer?: boolean;
  min?: number;
  max?: number;
} & Omit<
  ComponentProps<"input">,
  "value" | "onChange" | "type" | "min" | "max"
>;

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
  onBlur,
  ...rest
}: Props) {
  const [text, setText] = useState(String(value));
  const [prevValue, setPrevValue] = useState(value);

  // A value from outside replaces the text, the field's own doesn't
  if (value !== prevValue) {
    setPrevValue(value);
    if (text.trim() === "" || Number(text) !== value) setText(String(value));
  }

  const valid = (number: number) =>
    Number.isFinite(number) &&
    (!integer || Number.isInteger(number)) &&
    (min === undefined || number >= min) &&
    (max === undefined || number <= max);

  return (
    <Input
      {...rest}
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
