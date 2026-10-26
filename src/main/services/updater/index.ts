import { UpdateStatus } from "@/common/types";
import { formatError, REPOSITORY_URL } from "@/common/util";
import { settle } from "@/helper/quit";
import Logger from "@/logger";
import type {
  Logger as UpdaterLogger,
  ProgressInfo,
  UpdateInfo,
} from "electron-updater";
import { Service } from "../shared";

// After startup, so the first check doesn't compete with loading the app.
export const STARTUP_DELAY_MS = 15_000;
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
// Download progress is sent in steps of this many percent.
const PROGRESS_STEP = 5;

// Set to 1 to try updates from `yarn dev`, with dev-app-update.yml.
const DEV_ENV = "TOKIO_DEV_UPDATES";

export interface UpdaterResult<T = undefined> {
  success: boolean;
  error?: string;
  data?: T;
}

export type UpdateNotice = Extract<
  UpdateStatus,
  { state: "available" } | { state: "ready" }
>;

export interface UpdaterCallbacks {
  onStatus?: (status: UpdateStatus) => void;
  // An update was downloaded, or one has to be downloaded by hand (macOS)
  onUpdate?: (status: UpdateNotice) => void;
  // Check failures are only returned by check(), they're often just offline.
  onDownloadFailed?: (error: unknown) => void;
}

// The part of electron-updater's AppUpdater the service uses.
export interface Updater {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  allowDowngrade: boolean;
  forceDevUpdateConfig: boolean;
  logger: UpdaterLogger | null;
  on(event: string, listener: (...args: any[]) => void): unknown;
  checkForUpdates(): Promise<{
    updateInfo: { version: string };
    downloadPromise?: Promise<unknown> | null;
  } | null>;
  isUpdaterActive(): boolean;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

/**
 * Finds new releases on GitHub and installs them with electron-updater.
 * Windows and Linux (AppImage) download in the background and install on
 * restart. macOS builds aren't signed, so there the release page is opened.
 */
export class UpdaterService extends Service {
  private _updater?: Updater;
  private readonly _platform: NodeJS.Platform;
  private _callbacks: UpdaterCallbacks = {};
  private _status: UpdateStatus = { state: "idle" };
  private _checking?: Promise<UpdaterResult>;
  private _installing?: Promise<void>;
  private _startup?: NodeJS.Timeout;
  private _interval?: NodeJS.Timeout;

  constructor(updater?: Updater, platform: NodeJS.Platform = process.platform) {
    super();
    this._updater = updater;
    this._platform = platform;
  }

  public setLogFile(logFile: string): void {
    this._logFile = logFile;
  }

  private get manual() {
    return this._platform === "darwin";
  }

  public async initialize(callbacks: UpdaterCallbacks = {}) {
    this._callbacks = callbacks;
    // Loaded here, the package needs Electron's app to be ready.
    if (!this._updater) {
      const { default: electronUpdater } = await import("electron-updater");
      this._updater = electronUpdater.autoUpdater;
    }

    const updater = this._updater;
    updater.forceDevUpdateConfig = process.env[DEV_ENV] === "1";
    updater.autoDownload = !this.manual;
    updater.autoInstallOnAppQuit = !this.manual;
    // Only the release GitHub marks as latest. The updater would otherwise
    // allow prereleases for -alpha versions.
    updater.allowPrerelease = false;
    updater.allowDowngrade = false;
    updater.logger = this.logger();

    updater.on("checking-for-update", () => {
      this.setStatus({ state: "checking" });
    });
    updater.on("update-not-available", () => {
      this.setStatus({ state: "none", checkedAt: Date.now() });
    });
    updater.on("update-available", ({ version }: UpdateInfo) => {
      const status: UpdateNotice = {
        state: "available",
        version,
        manual: this.manual,
        url: `${REPOSITORY_URL}/releases/tag/v${version}`,
      };
      this.setStatus(status);
      if (this.manual) this._callbacks.onUpdate?.(status);
    });
    updater.on("download-progress", ({ percent }: ProgressInfo) => {
      const version = "version" in this._status ? this._status.version : "";
      const step = Math.floor(percent / PROGRESS_STEP) * PROGRESS_STEP;
      if (this._status.state === "downloading" && this._status.percent === step)
        return;
      this.setStatus({ state: "downloading", version, percent: step });
    });
    updater.on("update-downloaded", ({ version }: UpdateInfo) => {
      const status: UpdateNotice = { state: "ready", version };
      this.setStatus(status);
      this._callbacks.onUpdate?.(status);
    });
    // The updater logs its errors, they're handled where its promises reject.
    updater.on("error", () => {});

    if (!updater.isUpdaterActive()) this.setStatus({ state: "unsupported" });
  }

  public getStatus(): UpdateStatus {
    return this._status;
  }

  /** Checks on startup and every few hours while `auto` is on. */
  public setAuto(auto: boolean) {
    this.dispose();
    if (!auto || this._status.state === "unsupported") return;

    this._startup = setTimeout(() => void this.check(), STARTUP_DELAY_MS);
    this._interval = setInterval(() => void this.check(), CHECK_INTERVAL_MS);
    this._startup.unref?.();
    this._interval.unref?.();
  }

  /** Looks for a new release, and downloads it where that's supported. */
  public check(): Promise<UpdaterResult> {
    const updater = this._updater;
    if (!updater || this._status.state === "unsupported") {
      return Promise.resolve({
        success: false,
        error: "Updates aren't available in this build.",
      });
    }
    // Already found, nothing newer is installed until the restart.
    if (this._status.state === "downloading" || this._status.state === "ready")
      return Promise.resolve({ success: true });

    this._checking ??= this.runCheck(updater).finally(() => {
      this._checking = undefined;
    });
    return this._checking;
  }

  /**
   * Restarts into the downloaded update once the saves still running are
   * done. On macOS, returns the release page to open instead.
   */
  public install(): UpdaterResult<{ url: string }> {
    const status = this._status;
    if (status.state === "available" && status.manual) {
      return { success: true, data: { url: status.url } };
    }
    if (status.state !== "ready" || !this._updater) {
      return { success: false, error: "No update is ready to install." };
    }
    Logger.info(
      `<Updater> Restarting to install version ${status.version}.`,
      this._logFile,
    );
    const updater = this._updater;
    // The installer starts before the app quits, so a quit held for saves
    // would race it. Not awaited: the request that asked is one of them.
    this._installing ??= settle(3000).then(() => {
      this._installing = undefined;
      updater.quitAndInstall(true, true);
    });
    return { success: true };
  }

  public dispose() {
    clearTimeout(this._startup);
    clearInterval(this._interval);
    this._startup = undefined;
    this._interval = undefined;
  }

  private async runCheck(updater: Updater): Promise<UpdaterResult> {
    const previous = this._status;
    try {
      const result = await updater.checkForUpdates();
      result?.downloadPromise?.catch((error) => {
        // The next check downloads it again.
        this.setStatus({
          state: "available",
          version: result.updateInfo.version,
          manual: false,
          url: `${REPOSITORY_URL}/releases/tag/v${result.updateInfo.version}`,
        });
        this._callbacks.onDownloadFailed?.(error);
      });
      return { success: true };
    } catch (error) {
      // Logged by the updater
      this.setStatus(previous);
      return { success: false, error: formatError(error) };
    }
  }

  private setStatus(status: UpdateStatus) {
    this._status = status;
    this._callbacks.onStatus?.(status);
  }

  private logger(): UpdaterLogger {
    const text = (message: unknown) => `<Updater> ${String(message)}`;
    return {
      info: (message) => Logger.info(text(message), this._logFile),
      warn: (message) => Logger.warn(text(message), this._logFile),
      error: (message) => Logger.error(text(message), this._logFile),
    };
  }
}
