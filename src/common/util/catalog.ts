import { CatalogOverlay } from "@/common/schemas";
import { OverlayApp } from "@/common/types";

// What an official overlay's card offers
export type CatalogState = "install" | "update" | "breaking" | "installed";

/**
 * Whether an official overlay is installed and up to date. The catalog only
 * moves forward, so any other installed version is older. A new first version
 * number is a breaking update, and so is a version that doesn't start with a
 * number, so Tokio asks when it can't tell.
 */
export function catalogState(
  entry: CatalogOverlay,
  overlays: OverlayApp[],
): CatalogState {
  const installed = overlays.find((o) => o.id === entry.id && !o.external);
  if (!installed) return "install";
  if (installed.version === entry.version) return "installed";
  // NaN compares false, so a version without a leading number is breaking
  return parseInt(entry.version, 10) <= parseInt(installed.version, 10)
    ? "update"
    : "breaking";
}

/**
 * How many installed official overlays have a new version in the catalog,
 * breaking ones included.
 */
export function countUpdates(
  catalog: CatalogOverlay[],
  overlays: OverlayApp[],
): number {
  return catalog.filter((entry) => {
    const state = catalogState(entry, overlays);
    return state === "update" || state === "breaking";
  }).length;
}
