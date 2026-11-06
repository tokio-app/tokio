import { STUDIO_SIZES, StudioOverlay } from "@/common/schemas";

/**
 * A new overlay's name: "Overlay N", N the first number that no overlay's
 * name uses. `name(n)` writes it in the window's language.
 */
export function newOverlayName(
  overlays: StudioOverlay[],
  name: (number: number) => string,
): string {
  const taken = new Set(overlays.map((overlay) => overlay.name.trim()));
  let number = 1;
  while (taken.has(name(number))) number++;
  return name(number);
}

// The canvas's size as the readout shows it, "1080 × 1920"
export const sizeText = (size: StudioOverlay["size"]) =>
  `${STUDIO_SIZES[size].width} × ${STUDIO_SIZES[size].height}`;
