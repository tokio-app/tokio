import { APP_EVENTS_RESPONSE } from "@/common/types";
import { formatError } from "@/common/util";
import { Notifier } from "@/helper/feedback";
import {
  previewFile,
  withPreviewBackground,
  withPreviewCORS,
} from "@/helper/preview";
import Logger from "@/logger";
import { AlertsService } from "@/services/alerts";
import { TikTokConnectorService } from "@/services/connector";
import { JSONManagerService } from "@/services/json";
import { LicensesService } from "@/services/licenses";
import { MusicService } from "@/services/music";
import { OverlayService } from "@/services/overlay";
import { PathManagerService } from "@/services/path";
import { ServerService } from "@/services/server";
import { StoreManagerService } from "@/services/store";
import { TTSService } from "@/services/tts";
import { UpdaterService } from "@/services/updater";
import { URLManagerService } from "@/services/url";
import { electronApp, is, optimizer } from "@electron-toolkit/utils";
import {
  app,
  BrowserWindow,
  ipcMain,
  net,
  protocol,
  session,
  shell,
} from "electron";
import { join } from "path";
import { pathToFileURL } from "url";
import events from "./events";
import Handler from "./handler";
import { YAMLManagerService } from "./services/yaml";
import { AppServices } from "./types";

app.commandLine.appendSwitch(
  "webrtc-ip-handling-policy",
  "default_public_interface_only",
);
app.commandLine.appendSwitch("log-level", "3");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");
app.commandLine.appendSwitch("disable-backgrounding-occluded-windows", "true");
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");

// Overlay previews load their files from local-resource:, which has no origin.
// Without CORS on it, Chromium blocks module scripts, crossorigin styles, fonts
// and fetch, so overlays built with Vite never run. See withPreviewCORS.
// Schemes can only be registered before the app is ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "local-resource",
    privileges: { corsEnabled: true, supportFetchAPI: true },
  },
]);

const services: AppServices = {
  alertsService: new AlertsService(),
  ttsService: new TTSService(),
  musicService: new MusicService(),
  serverService: new ServerService(),
  overlayService: new OverlayService(),
  urlManagerService: new URLManagerService(),
  jsonManagerService: new JSONManagerService(),
  pathManagerService: new PathManagerService(),
  connectorService: new TikTokConnectorService(),
  storeManagerService: new StoreManagerService(),
  yamlManagerService: new YAMLManagerService(),
  licensesService: new LicensesService(),
  updaterService: new UpdaterService(),
};

// Packaged, the notices are copied to resources/licenses (electron-builder.yml).
services.licensesService.initialize(
  app.getAppPath(),
  app.isPackaged ? join(process.resourcesPath, "licenses") : app.getAppPath(),
);

const logFatal = (kind: string) => (error: unknown) => {
  Logger.error(
    `<System> ${kind} -- ${formatError(error)}`,
    services.pathManagerService.files?.logs.system,
    error,
  );
};

// The monitor only observes, so Electron still handles the exception as usual.
process.on("uncaughtExceptionMonitor", logFatal("Uncaught exception"));
// Electron only warns about these, the listener keeps that behavior.
process.on("unhandledRejection", logFatal("Unhandled rejection"));

const APP_ICON = join(__dirname, "../../resources/icon.png");
const APP_PRELOAD = join(__dirname, "../preload/index.mjs");

let win: BrowserWindow | null = null;

// A page of the renderer build, served by the dev server in development
function loadPage(window: BrowserWindow, page: string) {
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    window.loadURL(`${process.env["ELECTRON_RENDERER_URL"]}/${page}`);
  } else {
    window.loadFile(join(__dirname, `../renderer/${page}`));
  }
}

function createWindows(): void {
  // Shown while the main window loads hidden at its full size, so the
  // window never resizes from the splash to the app.
  const splash = new BrowserWindow({
    width: 600,
    height: 400,
    resizable: false,
    show: false,
    titleBarStyle: "hidden",
    title: "Tokio",
    center: true,
    autoHideMenuBar: true,
    icon: APP_ICON,
  });

  win = new BrowserWindow({
    width: 1200,
    minWidth: 1200,
    height: 800,
    minHeight: 800,
    show: false,
    titleBarStyle: "hidden",
    title: "Tokio",
    center: true,
    autoHideMenuBar: true,
    icon: APP_ICON,
    webPreferences: {
      preload: APP_PRELOAD,
      sandbox: false,
    },
  });

  // Notices go to the main window only.
  const notifier = new Notifier((notification) => {
    if (win && !win.isDestroyed()) {
      win.webContents.send(APP_EVENTS_RESPONSE.NOTIFY, notification);
    }
  });

  new Handler({
    app,
    win,
    splash,
    shell,
    ipcMain,
    session,
    notifier,
    ...services,
  }).init(events);

  loadPage(splash, "splash.html");
  loadPage(win, "index.html");
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId("com.ialfaro.tokio");

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // Overlay previews, see previewFile and withPreviewBackground. The
  // folders are set when the app loads, before any preview.
  protocol.handle("local-resource", async (request) => {
    const file = previewFile(
      request.url,
      services.pathManagerService.folders?.overlaysFolder,
    );
    if (!file) return new Response(null, { status: 404 });

    const res = await net.fetch(pathToFileURL(file).href);
    return withPreviewCORS(await withPreviewBackground(res, file));
  });

  createWindows();
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("will-quit", () => {
  services.ttsService.dispose();
  services.updaterService.dispose();
});
