import {
  BrowserWindow,
  dialog,
  OpenDialogOptions,
  SaveDialogOptions,
} from "electron";
import { dirname, join } from "node:path";

// Since Electron 43 a dialog without a defaultPath opens in Downloads, and the
// OS no longer remembers where the user was, so the app does.
let lastFolder: string | undefined;

/**
 * `dialog.showOpenDialog`, opened in the last folder used. A picked folder
 * opens from its parent next time, so it shows.
 */
export async function showOpenDialog(
  win: BrowserWindow,
  options: OpenDialogOptions,
) {
  const res = await dialog.showOpenDialog(win, {
    defaultPath: lastFolder,
    ...options,
  });
  if (!res.canceled && res.filePaths[0]) lastFolder = dirname(res.filePaths[0]);
  return res;
}

/**
 * `dialog.showSaveDialog`, with the suggested file name (`defaultPath`) in the
 * last folder used.
 */
export async function showSaveDialog(
  win: BrowserWindow,
  options: SaveDialogOptions,
) {
  const res = await dialog.showSaveDialog(win, {
    ...options,
    defaultPath: lastFolder
      ? join(lastFolder, options.defaultPath ?? "")
      : options.defaultPath,
  });
  if (!res.canceled && res.filePath) lastFolder = dirname(res.filePath);
  return res;
}
