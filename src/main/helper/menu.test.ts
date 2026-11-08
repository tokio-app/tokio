import { Menu, type MenuItemConstructorOptions } from "electron";
import { describe, expect, it } from "vitest";
import { lockMenu } from "./menu";

// Electron's default Edit and View menus
const defaultMenu = () => {
  const view: MenuItemConstructorOptions[] = [
    { role: "reload", enabled: true },
    { role: "forceReload", enabled: true },
    { role: "toggleDevTools", enabled: true },
    { role: "resetZoom", enabled: true },
    { role: "zoomIn", enabled: true },
    { role: "zoomOut", enabled: true },
    { role: "togglefullscreen", enabled: true },
  ];
  const copy: MenuItemConstructorOptions = { role: "copy", enabled: true };
  const menu = Menu.buildFromTemplate([
    { label: "Edit", submenu: Menu.buildFromTemplate([copy]) },
    { label: "View", submenu: Menu.buildFromTemplate(view) },
  ]);
  const off = () =>
    [copy, ...view].filter((item) => !item.enabled).map((item) => item.role);
  return { menu, off };
};

describe("lockMenu", () => {
  it("turns off the window's zoom", () => {
    const { menu, off } = defaultMenu();
    lockMenu(menu, false);
    expect(off()).toEqual(["resetZoom", "zoomIn", "zoomOut"]);
  });

  it("also turns off reload and DevTools in a packaged app", () => {
    const { menu, off } = defaultMenu();
    lockMenu(menu, true);
    expect(off()).toEqual([
      "reload",
      "forceReload",
      "toggleDevTools",
      "resetZoom",
      "zoomIn",
      "zoomOut",
    ]);
  });
});
