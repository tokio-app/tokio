import isEqual from "fast-deep-equal";
import { useCallback, useEffect, useRef, useState } from "react";

// Groups typing into one save, as useEditableSettings does
const SAVE_DELAY = 300;

/**
 * A value edited on the page and saved shortly after its last change, for
 * fields without a Save button. `saved` is what main holds: the value starts
 * over from it when it changes, but not for main's echo of the value's own
 * save, which would undo what was typed since. A change still waiting is sent
 * when the component unmounts, so one made right before leaving isn't lost.
 */
export function useAutosave<T>(saved: T, save: (value: T) => void) {
  const [value, setValue] = useState(saved);
  const [prevSaved, setPrevSaved] = useState(saved);
  // The last value sent to main
  const [sent, setSent] = useState<{ value: T } | null>(null);
  // Changed, but not sent yet
  const pending = useRef<{ value: T } | null>(null);
  const saveRef = useRef(save);

  if (!isEqual(saved, prevSaved)) {
    setPrevSaved(saved);
    if (!sent || !isEqual(saved, sent.value)) setValue(saved);
  }

  useEffect(() => {
    saveRef.current = save;
  });

  const flush = useCallback(() => {
    const waiting = pending.current;
    if (!waiting) return;
    pending.current = null;
    saveRef.current(waiting.value);
    setSent(waiting);
  }, []);

  useEffect(() => {
    // Also when a change is undone before it's sent
    if (isEqual(value, saved)) {
      pending.current = null;
      return undefined;
    }

    pending.current = { value };
    const timer = setTimeout(flush, SAVE_DELAY);

    return () => clearTimeout(timer);
  }, [value, saved, flush]);

  useEffect(() => flush, [flush]);

  return [value, setValue] as const;
}
