import { app, trays } from "@test/electron";
import { setLanguage } from "@/helper/i18n";
import { describe, expect, it, vi } from "vitest";
import { TrayService } from ".";

// The labels of the tray's last menu
const labels = () => {
  const [menu] = trays()[0].setContextMenu.mock.calls.at(-1)!;
  return menu.items.map((i) => i.label);
};

// The tray's menu item with this label
const item = (label: string) => {
  const [menu] = trays()[0].setContextMenu.mock.calls.at(-1)!;
  return menu.items.find((i) => i.label === label)!;
};

describe("TrayService", () => {
  it("shows the app icon, which opens Tokio or quits", () => {
    const tray = new TrayService();
    const open = vi.fn();
    tray.onOpen(open);

    tray.setEnabled(true);

    expect(trays()).toHaveLength(1);
    expect(trays()[0].image).toEqual({
      path: expect.stringMatching(/resources[\\/]icon\.png$/),
      // macOS shows it at its size in points
      width: process.platform === "darwin" ? 16 : 32,
    });
    expect(trays()[0].setToolTip).toHaveBeenCalledWith("Tokio");

    trays()[0].emit("click");
    item("Open Tokio").click!();
    expect(open).toHaveBeenCalledTimes(2);

    item("Quit Tokio").click!();
    expect(app.quit).toHaveBeenCalledOnce();
  });

  it("shows one icon however often it's turned on, until it's turned off", () => {
    const tray = new TrayService();
    expect(tray.isEnabled()).toBe(false);

    tray.setEnabled(true);
    tray.setEnabled(true);
    expect(tray.isEnabled()).toBe(true);
    expect(trays()).toHaveLength(1);

    tray.setEnabled(false);
    expect(tray.isEnabled()).toBe(false);
    expect(trays()[0].destroy).toHaveBeenCalledOnce();

    tray.setEnabled(true);
    expect(trays()).toHaveLength(2);
  });

  it("builds its menu again in the language Tokio switches to", () => {
    const tray = new TrayService();
    // Nothing to build while it's off
    setLanguage("es-419");
    setLanguage("en");

    tray.setEnabled(true);
    expect(labels()).toEqual(["Open Tokio", "Quit Tokio"]);

    setLanguage("es-419");
    expect(labels()).toEqual(["Abrir Tokio", "Salir de Tokio"]);
    item("Salir de Tokio").click!();
    expect(app.quit).toHaveBeenCalledOnce();
  });
});
