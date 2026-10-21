import { dialog } from "@test/electron";
import { BrowserWindow } from "electron";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { showOpenDialog, showSaveDialog } from "./dialog";

const win = new BrowserWindow();
const lastOptions = (fn: { mock: { calls: unknown[][] } }) =>
  fn.mock.calls.at(-1)?.[1];

describe("file dialogs", () => {
  // One walk through, since the last folder is kept between calls
  it("open in the last folder used", async () => {
    const music = join("C:", "Users", "me", "Music");
    const backups = join("D:", "backups");
    const open = vi.mocked(dialog.showOpenDialog);
    const save = vi.mocked(dialog.showSaveDialog);

    open.mockResolvedValueOnce({
      canceled: false,
      filePaths: [join(music, "a.mp3")],
    });
    await showOpenDialog(win, { properties: ["openFile"] });
    expect(lastOptions(open)).toEqual({ properties: ["openFile"] });

    // A canceled dialog keeps the folder
    await showOpenDialog(win, { properties: ["openFile"] });
    expect(lastOptions(open)).toMatchObject({ defaultPath: music });

    save.mockResolvedValueOnce({
      canceled: false,
      filePath: join(backups, "Stream.json"),
    });
    await showSaveDialog(win, { defaultPath: "Stream.json" });
    expect(lastOptions(save)).toMatchObject({
      defaultPath: join(music, "Stream.json"),
    });

    open.mockResolvedValueOnce({
      canceled: false,
      filePaths: [join(backups, "overlay")],
    });
    await showOpenDialog(win, { properties: ["openDirectory"] });
    expect(lastOptions(open)).toMatchObject({ defaultPath: backups });

    // The picked folder's parent
    await showOpenDialog(win, { properties: ["openDirectory"] });
    expect(lastOptions(open)).toMatchObject({
      defaultPath: dirname(join(backups, "overlay")),
    });
  });
});
