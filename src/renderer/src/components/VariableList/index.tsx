import { useT } from "@/ui/i18n";
import { RefObject } from "react";
import styles from "./variablelist.module.css";

type Props = {
  variables: string[];
  // The input the variables go into, at its cursor
  inputRef: RefObject<HTMLInputElement | null>;
  value: string;
  onChange: (value: string) => void;
  // Shown when there are no variables
  empty?: string;
};

const VARIABLE = /\{\w+\}/g;

// Widens a range that starts or ends inside a variable to the whole
// variable, so a new one replaces it instead of landing in the middle.
function widenToVariables(
  value: string,
  start: number,
  end: number,
): [number, number] {
  let from = start;
  let to = end;
  for (const match of value.matchAll(VARIABLE)) {
    const first = match.index;
    const last = first + match[0].length;
    if (first < from && from < last) from = first;
    if (first < to && to < last) to = last;
  }
  return [from, to];
}

/**
 * The variables a message can use. Clicking one puts it in the input, in
 * place of the selection, or at the end when the input isn't focused. A
 * variable the cursor is in is replaced.
 */
export function VariableList({
  variables,
  inputRef,
  value,
  onChange,
  empty,
}: Props) {
  const t = useT();
  if (variables.length === 0) {
    return empty ? <p className={styles.list}>{empty}</p> : null;
  }

  const insert = (name: string) => {
    const input = inputRef.current;
    const variable = `{${name}}`;
    const focused = input !== null && document.activeElement === input;
    const cursor = focused
      ? (input.selectionStart ?? value.length)
      : value.length;
    const [start, end] = widenToVariables(
      value,
      cursor,
      focused ? (input.selectionEnd ?? cursor) : cursor,
    );
    onChange(value.slice(0, start) + variable + value.slice(end));

    // After React puts the new value in the input
    const caret = start + variable.length;
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(caret, caret);
    });
  };

  return (
    <p className={styles.list}>
      <span className={styles.label}>{t("components.variables.label")}</span>
      {variables.map((name) => (
        <button
          key={name}
          type="button"
          className={styles.variable}
          title={t("components.variables.insert", { variable: `{${name}}` })}
          // Keeps the input focused, with its cursor where it was
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => insert(name)}
        >
          {`{${name}}`}
        </button>
      ))}
    </p>
  );
}
