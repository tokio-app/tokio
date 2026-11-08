import type { Menu } from "electron";

// Electron's roles, compared in lowercase as the default menu keeps them
// (a template's are camelCase): the window's zoom, and what a packaged app
// never does
const ZOOM = ["zoomin", "zoomout", "resetzoom"];
const DEVELOPMENT = ["reload", "forcereload", "toggledevtools"];

/**
 * Turns off the menu's zoom, and in a packaged app its reload and DevTools,
 * at any depth. Their keys still reach the pages, for Overlay Studio's zoom
 * and rulers.
 */
export function lockMenu(menu: Menu | null, packaged: boolean): void {
  for (const item of menu?.items ?? []) {
    const role = item.role?.toLowerCase() ?? "";
    if (ZOOM.includes(role) || (packaged && DEVELOPMENT.includes(role))) {
      item.enabled = false;
    }
    lockMenu(item.submenu ?? null, packaged);
  }
}
