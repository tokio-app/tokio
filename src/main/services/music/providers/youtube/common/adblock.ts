import { formatError } from "@/common/util";
import Logger from "@/logger";
import {
  DEFAULT_LISTS,
  ElectronBlocker,
  FileStorage,
  updateLists,
} from "@tokioapp/adblock";
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
  // The saved lists being brought up to date, before any blocker needs them
  private _updating: Promise<unknown> | undefined;
  private readonly _logged = new Set<string>();

  constructor(private readonly logFile: () => string) {}

  private readonly onError = (error: Error) => {
    const message = formatError(error);
    // Once each, since one can repeat on every request
    if (this._logged.has(message)) return;
    this._logged.add(message);
    Logger.warn(`<Music> Ad blocker: ${message}`, this.logFile());
  };

  private storage() {
    return new FileStorage(path.join(this.folder, "adblock"));
  }

  // Downloads the saved lists that expired without building the blocker,
  // whose rules take tens of MB: YouTube's connect builds it (the user's
  // call). A blocker in use keeps its own lists up to date.
  public update(): void {
    if (this._blocker || this._updating) return;
    this._updating = updateLists({
      lists: ADBLOCK_LISTS,
      storage: this.storage(),
      onError: this.onError,
    }).finally(() => {
      this._updating = undefined;
    });
  }

  // Making it builds its rules from the saved lists, downloading the ones
  // that expired
  public get(): ElectronBlocker {
    this._blocker ??= new ElectronBlocker({
      ipcMain,
      lists: ADBLOCK_LISTS,
      storage: this.storage(),
      onError: this.onError,
    });
    return this._blocker;
  }

  // The blocker once its lists are in effect. Rejects when none is saved and
  // none downloads, after trying again: the one at startup may have failed.
  // Also rejects once wanted() is false, so an ended connect builds nothing.
  public async ready(wanted = () => true): Promise<ElectronBlocker> {
    const needed = () => {
      if (!wanted()) throw new Error("The ad blocker is no longer needed");
    };
    // After an update still running, so no list is downloaded twice
    await this._updating;
    needed();
    const blocker = this.get();
    await blocker.ready;
    if (!hasLists(blocker)) {
      needed();
      await blocker.update();
    }
    if (!hasLists(blocker)) throw new Error("No filter list could be loaded");
    return blocker;
  }

  // Stops blocking and frees its rules, until the next get()
  public dispose() {
    this._blocker?.dispose();
    this._blocker = null;
  }
}
