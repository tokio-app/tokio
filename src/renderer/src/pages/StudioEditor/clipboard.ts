import { StudioItem } from "@/common/schemas";
import { copyItem, withoutMedia } from "./helper";

// What Ctrl+C or Ctrl+X took, back to front, kept until Tokio quits so it
// pastes into another overlay too, and how many steps down and right the
// next paste goes: each one lands a step further, the first after a cut
// where it was
let clipboard: { items: StudioItem[]; steps: number } | null = null;
// A paste's step, in px of the canvas
const PASTE_STEP = 20;

/** Keeps the groups and elements, back to front, for the next pastes. */
export function copy(items: StudioItem[], cut: boolean) {
  clipboard = { items, steps: cut ? 0 : 1 };
}

/**
 * Copies of what was taken, back to front, with new ids, a step further
 * than the last ones. Null with nothing taken, or when they don't fit.
 */
export function paste(
  fits: (items: StudioItem[]) => boolean,
): StudioItem[] | null {
  if (!clipboard || !fits(clipboard.items)) return null;
  const { items, steps } = clipboard;
  clipboard.steps += 1;
  return items.map((item) => copyItem(item, PASTE_STEP * steps));
}

/**
 * Takes a deleted media file off what was taken, so a paste can't bring it
 * back. Layout calls it, so it does with the editor closed too.
 */
export function forgetMedia(file: string) {
  if (clipboard) clipboard.items = withoutMedia(clipboard.items, file);
}
