import {
  CurrentSongInfo,
  SongInfo,
  TOKIO_EVENTS,
  TokioEventMap,
} from "@/common/types";
import { delay } from "@/common/util";
import { BrowserWindow, WebContentsView } from "electron";
import { EventEmitter } from "node:events";
import { ConnectionResponse, createWindow, MusicProvider } from "../../common";
import {
  AfterSearchJSCode,
  confirmLoggedOut,
  LoginJSCode,
  parseSongRenderer,
  PlayerStateJSCode,
  SearchJSCode,
} from "./common";
import config from "./config";

// Where the player's window may go: YouTube and Google's sign-in
const isYouTubeOrLogin = (hostname: string) =>
  hostname === "accounts.google.com" ||
  hostname === "youtube.com" ||
  hostname.endsWith(".youtube.com");

export class YouTubeMusic extends MusicProvider {
  private _ytView: WebContentsView | null = null;
  private _shellWindow: BrowserWindow | null = null;
  private _events: EventEmitter;
  private _isActive: boolean = false;

  constructor() {
    super();
    this._events = new EventEmitter();
  }

  public setKey(_key: string): void {
    return;
  }

  public isActive(): boolean {
    return this._isActive;
  }

  public connect(): Promise<ConnectionResponse> {
    if (this._isActive) return Promise.resolve({ success: true });
    // A login still open from an earlier connect fails, so one window is left
    this.disconnect();

    this._shellWindow = createWindow();

    this._ytView = new WebContentsView({
      webPreferences: {
        partition: "persist:music-youtube",
        backgroundThrottling: false,
      },
    });

    this._shellWindow.contentView.addChildView(this._ytView);

    const bounds = this._shellWindow.getContentBounds();
    this._ytView.setBounds({
      x: 0,
      y: 40,
      width: bounds.width,
      height: bounds.height - 40,
    });

    this._shellWindow.on("resize", () => {
      if (this._shellWindow && this._ytView) {
        const newBounds = this._shellWindow.getContentBounds();
        this._ytView.setBounds({
          x: 0,
          y: 40,
          width: newBounds.width,
          height: newBounds.height - 40,
        });
      }
    });

    this._ytView.webContents.on("will-prevent-unload", (event) => {
      event.preventDefault();
    });

    this._ytView.webContents.on("will-navigate", (event) => {
      if (!isYouTubeOrLogin(new URL(event.url).hostname)) {
        event.preventDefault();
      }
    });

    this._shellWindow.on("close", () => {
      if (this._ytView && !this._ytView.webContents.isDestroyed()) {
        this._ytView.webContents.setAudioMuted(true);
        this._ytView.webContents.loadURL("about:blank");

        try {
          this._shellWindow?.contentView.removeChildView(this._ytView);
        } catch {
          // View already removed
        }
        this._isActive = false;
        this._ytView.webContents.close();
        this.emit(TOKIO_EVENTS.MUSIC_PROCCESS_ENDED);
      }
      this._ytView = null;
    });

    this._shellWindow.show();

    return new Promise((res) => {
      let isInitializing = true;

      const handleAuthAbort = () => {
        isInitializing = false;
        res({
          success: false,
          error: new Error("Authentication window was closed by the user"),
        });
      };

      this._shellWindow!.once("close", handleAuthAbort);
      this._ytView!.webContents.loadURL(config.YTM_URL);

      let hasAttemptedLoginRedirect = false;
      let checkGeneration = 0;

      const markReady = () => {
        if (!isInitializing) return;
        isInitializing = false;
        this._shellWindow!.off("close", handleAuthAbort);
        this._isActive = true;
        res({ success: true });
      };

      const handleNavigation = async () => {
        // A newer page load cancels any login check still retrying.
        const generation = ++checkGeneration;

        if (!this._ytView || this._shellWindow?.isDestroyed()) return;

        const currentUrl = this._ytView.webContents.getURL();
        if (currentUrl.includes("accounts.google.com")) return;

        if (!isInitializing) return;

        try {
          const isStale = () =>
            generation !== checkGeneration ||
            !isInitializing ||
            !this._ytView ||
            this._ytView.webContents.isDestroyed() ||
            !!this._shellWindow?.isDestroyed() ||
            this._ytView.webContents.getURL().includes("accounts.google.com");

          // A logged-in user resolves on the first check; only a run of
          // failed checks counts as logged out.
          const status = await confirmLoggedOut(() => this.checkIsLoggedIn(), {
            attempts: config.LOGIN_CHECK_ATTEMPTS,
            intervalMs: config.LOGIN_CHECK_INTERVAL_MS,
            isStale,
          });

          if (status === "stale") return;

          if (status === "logged-in") {
            markReady();
          } else {
            if (hasAttemptedLoginRedirect) {
              isInitializing = false;
              this._shellWindow!.off("close", handleAuthAbort);
              this._isActive = false;
              res({
                success: false,
                error: new Error("Login failed. Please try again."),
              });
              return;
            }
            hasAttemptedLoginRedirect = true;
            await this._ytView.webContents.session.clearStorageData();
            await this._ytView.webContents.loadURL(config.YTM_LOGIN_URL);
          }
        } catch (err) {
          isInitializing = false;
          this._isActive = false;
          this._shellWindow!.off("close", handleAuthAbort);
          const error = err instanceof Error ? err : new Error(String(err));
          res({ success: false, error });
        }
      };

      this._ytView!.webContents.on("did-finish-load", async () => {
        await handleNavigation();
      });
    });
  }

  // Ends the session, or fails a login still open. The window's close
  // listener, added in connect, closes the page and emits the end.
  public disconnect() {
    if (this._shellWindow && !this._shellWindow.isDestroyed()) {
      this._shellWindow.close();
    }
  }

  public async play(info: SongInfo) {
    if (!this._ytView) return;

    await this._ytView.webContents.executeJavaScript(SearchJSCode(info.track));

    await delay(250);

    this._ytView.webContents.sendInputEvent({
      type: "keyDown",
      keyCode: "Enter",
    });
    this._ytView.webContents.sendInputEvent({ type: "char", keyCode: "Enter" });
    this._ytView.webContents.sendInputEvent({
      type: "keyUp",
      keyCode: "Enter",
    });

    // True once it clicked play on the first result
    const played =
      await this._ytView.webContents.executeJavaScript(AfterSearchJSCode);
    if (!played) {
      throw new Error(`Nothing to play for ${info.track} on YouTube Music.`);
    }
  }

  public on<K extends TOKIO_EVENTS>(
    event: K,
    listener: (data: TokioEventMap[K]) => void,
  ): void {
    this._events.on(event, listener);
  }

  public off<K extends TOKIO_EVENTS>(
    event: K,
    listener: (data: TokioEventMap[K]) => void,
  ): void {
    this._events.off(event, listener);
  }

  public async playerStatus(): Promise<CurrentSongInfo | null> {
    if (!this._ytView) return null;
    try {
      const status =
        await this._ytView.webContents.executeJavaScript(PlayerStateJSCode);
      return status;
    } catch {
      return null;
    }
  }

  public async searchSong(query: string): Promise<SongInfo | null> {
    if (!query || typeof query !== "string") {
      return null;
    }

    const payload = {
      context: {
        client: {
          clientName: config.CLIENT_NAME,
          clientVersion: config.CLIENT_VERSION,
        },
      },
      query,
      params: config.SONG_FILTER_PARAMS,
    };

    const response = await fetch(config.SEARCH_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Origin: config.YTM_URL,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(config.REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(
        `InnerTube API request failed with status: ${response.status}`,
      );
    }

    const data = await response.json();

    const sections =
      data.contents?.tabbedSearchResultsRenderer?.tabs?.[0]?.tabRenderer
        ?.content?.sectionListRenderer?.contents ?? [];

    const musicShelf = sections.find(
      (section: any) => section.musicShelfRenderer,
    )?.musicShelfRenderer;

    if (!musicShelf || !musicShelf.contents?.length) {
      return null;
    }

    const firstItemRenderer =
      musicShelf.contents[0]?.musicResponsiveListItemRenderer;

    const result = parseSongRenderer(firstItemRenderer);

    return result;
  }

  private async checkIsLoggedIn(): Promise<boolean> {
    if (!this._ytView) return false;

    const currentUrl = this._ytView.webContents.getURL();
    if (currentUrl.includes("accounts.google.com")) return false;

    try {
      return await this._ytView.webContents.executeJavaScript(LoginJSCode);
    } catch {
      return false;
    }
  }

  private emit<K extends TOKIO_EVENTS>(
    event: K,
    data?: TokioEventMap[K],
  ): void {
    this._events.emit(event, data);
  }
}
