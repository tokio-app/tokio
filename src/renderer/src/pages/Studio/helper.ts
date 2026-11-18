import {
  STUDIO_NAME_MAX_LENGTH,
  STUDIO_SIZES,
  StudioOverlay,
} from "@/common/schemas";

/**
 * A new name: "Overlay N" (or "Group N"), N the first number that no item's
 * name uses. `name(n)` writes it in the window's language.
 */
export function newOverlayName(
  items: { name: string }[],
  name: (number: number) => string,
): string {
  const taken = new Set(items.map((item) => item.name.trim()));
  let number = 1;
  while (taken.has(name(number))) number++;
  return name(number);
}

/**
 * A copy's name: "<name> copy", then "<name> copy 2" and on when taken, cut
 * to STUDIO_NAME_MAX_LENGTH by shortening the source's name, never the rest.
 * `copy(name, n)` writes it in the window's language, n 1 for the first.
 */
export function copyName(
  items: { name: string }[],
  source: string,
  copy: (name: string, number: number) => string,
): string {
  return newOverlayName(items, (number) => {
    let name = source.trim();
    let text = copy(name, number);
    while (text.length > STUDIO_NAME_MAX_LENGTH && name) {
      // By code points, so an emoji isn't cut in half
      name = Array.from(name).slice(0, -1).join("").trimEnd();
      text = copy(name, number);
    }
    return text;
  });
}

// The canvas's size as the readout shows it, "1080 × 1920"
export const sizeText = (size: StudioOverlay["size"]) =>
  `${STUDIO_SIZES[size].width} × ${STUDIO_SIZES[size].height}`;
