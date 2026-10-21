import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  CurrentSongInfo,
  SongInfo,
  TOKIO_EVENTS,
  TokioEventMap,
} from "@/common/types";
import { stayOnPage } from "@/helper/network";
import { BrowserWindow, WebContentsView } from "electron";
import { join } from "node:path";

export { MusicQueue } from "./queue";
export type ConnectionResponse = { success: boolean; error?: Error };

export abstract class MusicProvider {
  public abstract setKey(key: string): void;
  public abstract connect(): Promise<ConnectionResponse>;
  public abstract disconnect(): void;
  public abstract play(track: SongInfo): Promise<void>;
  public abstract searchSong(query: string): Promise<SongInfo | null>;
  public abstract playerStatus(): Promise<CurrentSongInfo | null>;
  public abstract isActive(): boolean;
  public abstract on<K extends TOKIO_EVENTS>(
    event: K,
    listener: (data: TokioEventMap[K]) => void,
  ): void;
  public abstract off<K extends TOKIO_EVENTS>(
    event: K,
    listener: (data: TokioEventMap[K]) => void,
  ): void;
}

export function createWindow() {
  const APP_ICON = join(__dirname, "../../resources/icon.png");
  const APP_PRELOAD = join(__dirname, "../preload/index.mjs");

  const _shellWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minHeight: 840,
    minWidth: 1280,
    show: false,
    title: "Tokio",
    center: true,
    resizable: true,
    titleBarStyle: "hidden",
    autoHideMenuBar: true,
    icon: APP_ICON,
    webPreferences: {
      sandbox: false,
      contextIsolation: true,
      backgroundThrottling: false,
    },
  });

  const _navView = new WebContentsView({
    webPreferences: {
      sandbox: false,
      contextIsolation: false,
      preload: APP_PRELOAD,
    },
  });

  _navView.webContents.loadFile(join(__dirname, "../../music-out/index.html"));

  _shellWindow.contentView.addChildView(_navView);

  const updateNavBounds = () => {
    const bounds = _shellWindow!.getContentBounds();
    _navView.setBounds({ x: 0, y: 0, width: bounds.width, height: 40 });
  };

  // The title bar lives in the nav view, so it gets the window state.
  const nav = _navView.webContents;
  stayOnPage(nav);
  const sendWindowState = () => {
    if (nav.isDestroyed()) return;
    nav.send(APP_EVENTS_RESPONSE.RESIZE_MUSIC_WINDOW, {
      state: _shellWindow.isMaximized() ? "maximized" : "normal",
    });
  };

  updateNavBounds();
  _shellWindow.on("resize", () => {
    updateNavBounds();
    sendWindowState();
  });
  _shellWindow.on("maximize", sendWindowState);
  _shellWindow.on("unmaximize", sendWindowState);

  // Registered on the nav view, not ipcMain, so the controls only answer this
  // window's title bar and go away with it. Global handlers piled up on every
  // reopen and threw on the destroyed window.
  nav.ipc.on(APP_EVENTS.MAXIMIZE_MUSIC_WINDOW, () => {
    if (_shellWindow.isDestroyed()) return;
    if (_shellWindow.isMaximized()) {
      _shellWindow.unmaximize();
    } else {
      _shellWindow.maximize();
    }
  });

  nav.ipc.on(APP_EVENTS.MINIMIZE_MUSIC_WINDOW, () => {
    if (!_shellWindow.isDestroyed()) _shellWindow.minimize();
  });

  nav.ipc.on(APP_EVENTS.CLOSE_MUSIC_WINDOW, () => {
    if (!_shellWindow.isDestroyed()) _shellWindow.close();
  });

  _shellWindow.on("close", () => {
    try {
      _shellWindow.contentView.removeChildView(_navView);
    } catch {
      // Next
    }
    // Removing a view doesn't close its webContents, which kept a renderer
    // process alive for every music window opened.
    if (!nav.isDestroyed()) nav.close();
  });

  return _shellWindow;
}
