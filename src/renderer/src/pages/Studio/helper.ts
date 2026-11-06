import { STUDIO_SIZES, StudioOverlay } from "@/common/schemas";

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

// The canvas's size as the readout shows it, "1080 × 1920"
export const sizeText = (size: StudioOverlay["size"]) =>
  `${STUDIO_SIZES[size].width} × ${STUDIO_SIZES[size].height}`;
