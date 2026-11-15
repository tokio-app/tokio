import { formatError } from "@/common/util";
import Logger from "@/logger";
import { DEFAULT_LISTS, ElectronBlocker, FileStorage } from "@tokioapp/adblock";
import { ipcMain } from "electron";
import path from "node:path";

// uBlock Origin's default lists but two (the user's call): the malware list,
// since the player only opens YouTube and Google's sign-in, and Peter Lowe's,
// which states no license
const ADBLOCK_LISTS = DEFAULT_LISTS.filter(
  (list) => list.id !== "urlhaus-1" && list.id !== "plowe-0",
);

const hasLists = (blocker: ElectronBlocker) =>
  Object.keys(blocker.engine.stats).length > 0;

// YouTube's ad blocker. One per app: its IPC channels are the whole app's.
export class AdBlocker {
  // The extra folder: its lists are saved in `adblock/` there
  public folder = "";
  private _blocker: ElectronBlocker | null = null;
  private readonly _logged = new Set<string>();

  constructor(private readonly logFile: () => string) {}

  // Making it starts loading its lists, saved or downloaded
  public get(): ElectronBlocker {
    this._blocker ??= new ElectronBlocker({
      ipcMain,
      lists: ADBLOCK_LISTS,
      storage: new FileStorage(path.join(this.folder, "adblock")),
      onError: (error) => {
        const message = formatError(error);
        // Once each, since one can repeat on every request
        if (this._logged.has(message)) return;
        this._logged.add(message);
        Logger.warn(`<Music> Ad blocker: ${message}`, this.logFile());
      },
    });
    return this._blocker;
  }

  // The blocker once its lists are in effect. Rejects when none is saved and
  // none downloads, after trying again: the one at startup may have failed.
  public async ready(): Promise<ElectronBlocker> {
    const blocker = this.get();
    await blocker.ready;
    if (!hasLists(blocker)) await blocker.update();
    if (!hasLists(blocker)) throw new Error("No filter list could be loaded");
    return blocker;
  }

  // Stops blocking and frees its lists, until the next get()
  public dispose() {
    this._blocker?.dispose();
    this._blocker = null;
  }
}
