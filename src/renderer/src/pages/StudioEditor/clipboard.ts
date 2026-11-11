import { StudioItem } from "@/common/schemas";
import { copyItem, withoutMedia } from "./helper";

// What Ctrl+C or Ctrl+X took, kept until Tokio quits so it pastes into
// another overlay too, and how many steps down and right the next paste goes:
// each one lands a step further, the first after a cut where it was
let clipboard: { item: StudioItem; steps: number } | null = null;
// A paste's step, in px of the canvas
const PASTE_STEP = 20;

/** Keeps the group or element for the next pastes. */
export function copy(item: StudioItem, cut: boolean) {
  clipboard = { item, steps: cut ? 0 : 1 };
}

/**
 * A copy of what was taken, with new ids, a step further than the last
 * one. Null with nothing taken, or when it doesn't fit.
 */
export function paste(fits: (item: StudioItem) => boolean): StudioItem | null {
  if (!clipboard || !fits(clipboard.item)) return null;
  const pasted = copyItem(clipboard.item, PASTE_STEP * clipboard.steps);
  clipboard.steps += 1;
  return pasted;
}

/**
 * Takes a deleted media file off what was taken, so a paste can't bring it
 * back. Layout calls it, so it does with the editor closed too.
 */
export function forgetMedia(file: string) {
  if (clipboard) clipboard.item = withoutMedia([clipboard.item], file)[0];
}
