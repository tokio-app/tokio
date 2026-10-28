import { APP_EVENTS_RESPONSE } from "@/common/types";
import { formatError, MEDIA_SCHEME, mediaKind } from "@/common/util";
import { Notifier } from "@/helper/feedback";
import { language, savedLanguage, setLanguage } from "@/helper/i18n";
import {
  mediaFile,
  previewFile,
  videoResponse,
  withPreviewCORS,
  withPreviewStyles,
} from "@/helper/preview";
import { hasPending, settle } from "@/helper/quit";
import Logger from "@/logger";
import { AlertsService } from "@/services/alerts";
import { TikTokConnectorService } from "@/services/connector";
import { GamesService } from "@/services/games";
import { JSONManagerService } from "@/services/json";
import { LicensesService } from "@/services/licenses";
import { LiveService } from "@/services/live";
import { MusicService } from "@/services/music";
import { OverlayService } from "@/services/overlay";
import { PathManagerService } from "@/services/path";
import { ServerService } from "@/services/server";
import { StoreManagerService } from "@/services/store";
import { TimerService } from "@/services/timer";
import { TrayService } from "@/services/tray";
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

// End-to-end tests run the app in a temporary folder, see e2e/.
const testHome = process.env.TOKIO_HOME;
if (testHome) {
  app.setPath("home", testHome);
  app.setPath("userData", testHome);
}

// One Tokio per data folder, read here, so TOKIO_HOME runs get their own.
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();

// Overlay previews load their files from local-resource:, which has no origin.
// Without CORS on it, Chromium blocks module scripts, crossorigin styles, fonts
// and fetch, so overlays built with Vite never run. See withPreviewCORS.
// Schemes can only be registered before the app is ready.
protocol.registerSchemesAsPrivileged([
  {
    scheme: "local-resource",
    privileges: { corsEnabled: true, supportFetchAPI: true },
  },
  // The media library's thumbnails, the sounds and the Minecraft pictures,
  // see mediaFile. Videos need streaming.
  { scheme: MEDIA_SCHEME, privileges: { stream: true } },
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
  liveService: new LiveService(),
  timerService: new TimerService(),
  gamesService: new GamesService(),
  trayService: new TrayService(),
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
const APP_PRELOAD = join(__dirname, "../preload/index.cjs");

let win: BrowserWindow | null = null;

// A page of the renderer build, served by the dev server in development. It
// starts in main's language (?lang), even when LOAD_APP fails.
function loadPage(window: BrowserWindow, page: string) {
  const lang = language();
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    window.loadURL(
      `${process.env["ELECTRON_RENDERER_URL"]}/${page}?lang=${encodeURIComponent(lang)}`,
    );
  } else {
    window.loadFile(join(__dirname, `../renderer/${page}`), {
      query: { lang },
    });
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
    // It plays every sound, so Chromium never treats it as a background page,
    // minimized or in the tray
    webPreferences: { preload: APP_PRELOAD, backgroundThrottling: false },
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
  if (!primary) return;
  electronApp.setAppUserModelId("com.ialfaro.tokio");

  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // Overlay previews, see previewFile and withPreviewStyles. The folders
  // are set when the app loads, before any preview.
  protocol.handle("local-resource", async (request) => {
    const file = previewFile(
      request.url,
      services.pathManagerService.folders?.overlaysFolder,
    );
    if (!file) return new Response(null, { status: 404 });

    const res = await net.fetch(pathToFileURL(file).href);
    return withPreviewCORS(await withPreviewStyles(res, file));
  });

  // The media library, for the alerts' thumbnails, the sound library, for
  // the sounds' lengths, and the Minecraft pictures. Videos come in the parts
  // their players ask for, so the alert editor's preview can seek.
  protocol.handle(MEDIA_SCHEME, (request) => {
    const file = mediaFile(request.url, services.pathManagerService.folders);
    if (!file) return new Response(null, { status: 404 });
    if (mediaKind(file) === "video") {
      return videoResponse(file, request.headers.get("range"));
    }
    return net.fetch(pathToFileURL(file).href, { headers: request.headers });
  });

  // The splash shows before the store loads, so the saved language is read
  // from its file here. startApp applies it again once the store has loaded.
  setLanguage(savedLanguage(app.getPath("home")));
  createWindows();
});

app.on("window-all-closed", () => {
  app.quit();
});

// Not before-quit: on Cmd+Q it comes before the windows send their last saves.
let settling = false;
app.on("will-quit", (event) => {
  // Saves still running would be cut off, so quit again once they're done.
  if (!settling && hasPending()) {
    settling = true;
    event.preventDefault();
    void settle(3000).then(() => app.quit());
    return;
  }
  services.ttsService.dispose();
  services.updaterService.dispose();
});
