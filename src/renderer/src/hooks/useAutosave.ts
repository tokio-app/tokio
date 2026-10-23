import isEqual from "fast-deep-equal";
import { useCallback, useEffect, useRef, useState } from "react";
import { useFlush } from "./useEditableSettings";

// Groups typing into one save, as useEditableSettings does
const SAVE_DELAY = 300;

/**
 * A value edited on the page and saved shortly after its last change, for
 * fields without a Save button. `saved` is what main holds: the value starts
 * over from it when it changes, but not for main's echo of one of its own
 * saves, which would undo what was typed since. A change still waiting is sent
 * when the component unmounts, the window closes or flushSettings is called,
 * so one made right before leaving isn't lost.
 */
export function useAutosave<T>(saved: T, save: (value: T) => void) {
  const [value, setValue] = useState(saved);
  const [prevSaved, setPrevSaved] = useState(saved);
  // The values sent to main and not echoed yet, oldest first
  const [sent, setSent] = useState<T[]>([]);
  // Changed, but not sent yet
  const pending = useRef<{ value: T } | null>(null);
  const saveRef = useRef(save);

  if (!isEqual(saved, prevSaved)) {
    setPrevSaved(saved);
    // Main answers saves in order, so an echo also settles the ones before it.
    const echoed = sent.findIndex((v) => isEqual(v, saved));
    if (echoed === -1) {
      setValue(saved);
      setSent([]);
    } else {
      setSent(sent.slice(echoed + 1));
    }
  }

  useEffect(() => {
    saveRef.current = save;
  });

  const flush = useCallback(() => {
    const waiting = pending.current;
    if (!waiting) return;
    pending.current = null;
    saveRef.current(waiting.value);
    setSent((s) => [...s, waiting.value]);
  }, []);

  // prevSaved, not saved: a new but equal saved, like each of main's pushes,
  // mustn't restart the delay
  useEffect(() => {
    // Also when a change is undone before it's sent
    if (isEqual(value, prevSaved)) {
      pending.current = null;
      return undefined;
    }

    pending.current = { value };
    const timer = setTimeout(flush, SAVE_DELAY);

    return () => clearTimeout(timer);
  }, [value, prevSaved, flush]);

  useFlush(flush);

  return [value, setValue] as const;
}
