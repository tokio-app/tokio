import { app, trays } from "@test/electron";
import { describe, expect, it, vi } from "vitest";
import { TrayService } from ".";

// The tray's menu item with this label
const item = (label: string) => {
  const [menu] = trays()[0].setContextMenu.mock.calls[0];
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
});
