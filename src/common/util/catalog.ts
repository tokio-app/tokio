import { CatalogOverlay } from "@/common/schemas";
import { OverlayApp } from "@/common/types";

// What an official overlay's card offers
export type CatalogState = "install" | "update" | "installed";

/**
 * Whether an official overlay is installed and up to date. The catalog only
 * moves forward, so any other installed version is older.
 */
export function catalogState(
  entry: CatalogOverlay,
  overlays: OverlayApp[],
): CatalogState {
  const installed = overlays.find((o) => o.id === entry.id && !o.external);
  if (!installed) return "install";
  return installed.version === entry.version ? "installed" : "update";
}

/**
 * How many installed official overlays have a new version in the catalog.
 */
export function countUpdates(
  catalog: CatalogOverlay[],
  overlays: OverlayApp[],
): number {
  return catalog.filter((entry) => catalogState(entry, overlays) === "update")
    .length;
}
