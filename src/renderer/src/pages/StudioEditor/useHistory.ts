import { StudioOverlay } from "@/common/schemas";
import isEqual from "fast-deep-equal";
import { Dispatch, SetStateAction, useRef, useState } from "react";
import { withFolds } from "./helper";

// Changes from one control less than this apart are one step: a number
// typed, a field dragged, a text growing to its words
const MERGE_MS = 500;
// Steps kept to go back to
const MAX_STEPS = 100;

type Steps = {
  // The overlay before each step, oldest first
  past: StudioOverlay[];
  // Before each step undone, the last one undone at the end
  future: StudioOverlay[];
};

/**
 * The editor's undo and redo. A step is a press on the canvas, from its
 * press to its release, or a run of changes from one control with one
 * selection. Folding a group isn't one, and an undo or redo leaves every
 * group folded as it is.
 */
export function useHistory(
  overlay: StudioOverlay,
  setOverlay: Dispatch<SetStateAction<StudioOverlay>>,
  // The selected group or element, whose changes go together
  selected: string | null,
) {
  const [steps, setSteps] = useState<Steps>({ past: [], future: [] });
  // The next change starts a step
  const fresh = useRef(true);
  // A press on the canvas: every change until its release is one step
  const holding = useRef(false);
  // When the last change came, the control it came from and the selection
  const last = useRef<{
    at: number;
    from: Element | null;
    selected: string | null;
  }>({ at: 0, from: null, selected: null });

  // A change from the editor, a step of its own or part of the last one
  const change = (update: SetStateAction<StudioOverlay>) => {
    const at = Date.now();
    const from = document.activeElement;
    const joins =
      holding.current ||
      (at - last.current.at <= MERGE_MS &&
        from === last.current.from &&
        selected === last.current.selected);
    if (fresh.current || !joins) {
      // Here, not in an updater, which StrictMode runs twice
      setSteps(({ past }) => ({
        past: [...past, overlay].slice(-MAX_STEPS),
        future: [],
      }));
      fresh.current = false;
    }
    last.current = { at, from, selected };
    setOverlay(update);
  };

  const hold = (on: boolean) => {
    holding.current = on;
    fresh.current = true;
  };

  // Back a step, past the ones that changed nothing
  const undo = () => {
    if (holding.current) return;
    const { past, future } = steps;
    let i = past.length - 1;
    while (i >= 0 && isEqual(withFolds(past[i], overlay), overlay)) i--;
    if (i < 0) {
      if (past.length > 0) setSteps({ past: [], future });
      return;
    }
    setSteps({ past: past.slice(0, i), future: [...future, overlay] });
    fresh.current = true;
    setOverlay(withFolds(past[i], overlay));
  };

  const redo = () => {
    if (holding.current) return;
    const { past, future } = steps;
    const next = future.at(-1);
    if (!next) return;
    setSteps({ past: [...past, overlay], future: future.slice(0, -1) });
    fresh.current = true;
    setOverlay(withFolds(next, overlay));
  };

  // A change to the overlay and every step, which isn't one itself: a file
  // deleted from the library leaves all of them
  const sweep = (fix: (overlay: StudioOverlay) => StudioOverlay) => {
    setSteps(({ past, future }) => ({
      past: past.map(fix),
      future: future.map(fix),
    }));
    setOverlay(fix);
  };

  return {
    change,
    hold,
    undo,
    redo,
    sweep,
    canUndo: steps.past.length > 0,
    canRedo: steps.future.length > 0,
  };
}
