import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import config from "@/config";
import { Notifier } from "@/helper/feedback";
import { isOverlayURL } from "@/helper/network";
import { AlertsService } from "@/services/alerts";
import { TikTokConnectorService } from "@/services/connector";
import { JSONManagerService } from "@/services/json";
import { LicensesService } from "@/services/licenses";
import { LiveService } from "@/services/live";
import { MusicService } from "@/services/music";
import { OverlayService } from "@/services/overlay";
import { PathManagerService } from "@/services/path";
import { ServerService } from "@/services/server";
import { StoreManagerService } from "@/services/store";
import { TTSService } from "@/services/tts";
import { UpdaterService } from "@/services/updater";
import { URLManagerService } from "@/services/url";
import { YAMLManagerService } from "@/services/yaml";
import { AppHandlerVariables, CustomBrowserWindow } from "@/types";
import {
  BrowserWindow,
  type App,
  type IpcMain,
  type session as Session,
  type Shell,
} from "electron";
import { setTimeout as sleep } from "node:timers/promises";

// Least time the splash stays on screen, so a fast start doesn't flash it
const SPLASH_MIN_MS = 2000;

export class AppHandler implements AppHandlerVariables {
  public readonly app: App;
  public readonly win: CustomBrowserWindow;
  public readonly splash: BrowserWindow;
  public readonly ipcMain: IpcMain;
  public readonly shell: Shell;
  public readonly session: typeof Session;
  public readonly connectorService: TikTokConnectorService;
  public readonly ttsService: TTSService;
  public readonly musicService: MusicService;
  public readonly serverService: ServerService;
  public readonly overlayService: OverlayService;
  public readonly urlManagerService: URLManagerService;
  public readonly jsonManagerService: JSONManagerService;
  public readonly yamlManagerService: YAMLManagerService;
  public readonly storeManagerService: StoreManagerService;
  public readonly pathManagerService: PathManagerService;
  public readonly alertsService: AlertsService;
  public readonly licensesService: LicensesService;
  public readonly updaterService: UpdaterService;
  public readonly liveService: LiveService;
  public readonly notifier: Notifier;

  constructor(deps: AppHandlerVariables) {
    Object.assign(this, deps);
  }

  public async initApp() {
    this.initSession();
    this.initSplash();
    this.initWindow();
  }

  /**
   * Shows the splash until the renderer has drawn the app and sends
   * SHOW_WINDOW, then swaps it for the main window.
   */
  private initSplash() {
    let shownAt = Date.now();
    // StrictMode sends SHOW_WINDOW twice
    let requested = false;
    let revealed = false;

    this.splash.once("ready-to-show", () => {
      shownAt = Date.now();
      this.splash.show();
    });

    // Closing the splash quits, as the app hasn't shown yet
    this.splash.on("closed", () => {
      if (!revealed) this.win.close();
    });

    this.ipcMain.on(APP_EVENTS.SHOW_WINDOW, async () => {
      if (requested) return;
      requested = true;

      const wait = SPLASH_MIN_MS - (Date.now() - shownAt);
      if (wait > 0) await sleep(wait);

      // The splash was closed meanwhile, so the app is quitting
      if (this.splash.isDestroyed()) return;
      revealed = true;
      this.win.show();
      this.splash.close();
    });
  }

  private initWindow() {
    this.win.webContents.setWindowOpenHandler((details) => {
      this.shell.openExternal(details.url);
      return { action: "deny" };
    });

    this.ipcMain.on(APP_EVENTS.MINIMIZE_WINDOW, () => {
      this.win.minimize();
    });

    this.ipcMain.on(APP_EVENTS.MAXIMIZE_WINDOW, () => {
      if (this.win.isMaximized()) {
        this.win.unmaximize();
      } else {
        this.win.maximize();
      }
    });

    this.win?.on("resize", () => {
      if (this.win?.isNormal()) {
        this.win.webContents.send(APP_EVENTS_RESPONSE.RESIZE_WINDOW, {
          state: "normal",
        });
      } else {
        this.win?.webContents.send(APP_EVENTS_RESPONSE.RESIZE_WINDOW, {
          state: "maximized",
        });
      }
    });

    this.win.on("close", () => {
      BrowserWindow.getAllWindows().forEach((window) => {
        window.close();
      });
    });

    this.ipcMain.on(APP_EVENTS.CLOSE_WINDOW, () => {
      this.win.close();
    });
  }

  private initSession() {
    const csp = this.app.isPackaged ? config.CSP.prod : config.CSP.dev;
    this.session.defaultSession.webRequest.onBeforeRequest(
      config.URL_FILTER,
      (details, callback) => {
        if (details.resourceType === "webSocket") {
          callback({ cancel: true });
          return;
        }
        callback({ cancel: false });
      },
    );

    this.session.defaultSession.webRequest.onHeadersReceived(
      (details, callback) => {
        // Overlays run without a CSP, as in OBS, so they can use inline
        // scripts and load scripts, styles and fonts from the network.
        if (isOverlayURL(details.url)) {
          callback({ responseHeaders: details.responseHeaders });
          return;
        }
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            "Content-Security-Policy": [csp],
          },
        });
      },
    );
  }
}
