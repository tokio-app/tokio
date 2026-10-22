import { CurrentSongInfo, SongInfo, TOKIO_EVENTS } from "@/common/types";
import { BrowserWindow, WebContentsView } from "electron";
import { ConnectionResponse, createWindow, MusicProvider } from "../../common";
import {
  confirmLoggedOut,
  LoginJSCode,
  parseSongRenderer,
  PlayerStateJSCode,
  PlayJSCode,
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
  private _isActive: boolean = false;

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

    // This connect's own, for listeners that outlive it
    const view = (this._ytView = new WebContentsView({
      webPreferences: {
        partition: "persist:music-youtube",
        backgroundThrottling: false,
      },
    }));

    const shell = (this._shellWindow = createWindow(view));

    view.webContents.on("will-prevent-unload", (event) => {
      event.preventDefault();
    });

    view.webContents.on("will-navigate", (event) => {
      if (!isYouTubeOrLogin(new URL(event.url).hostname)) {
        event.preventDefault();
      }
    });

    // "close" fires again for each close() before the window is gone
    shell.on("close", () => {
      if (!view.webContents.isDestroyed()) {
        view.webContents.setAudioMuted(true);
        view.webContents.loadURL("about:blank");

        try {
          shell.contentView.removeChildView(view);
        } catch {
          // View already removed
        }
        view.webContents.close();
      }
      // A late close of an older window leaves the session that replaced it
      if (this._ytView !== view) return;
      this._ytView = null;
      this._isActive = false;
      this.emit(TOKIO_EVENTS.MUSIC_PROCCESS_ENDED);
    });

    shell.show();

    return new Promise((res) => {
      let isInitializing = true;

      const handleAuthAbort = () => {
        isInitializing = false;
        res({
          success: false,
          error: new Error("Authentication window was closed by the user"),
        });
      };

      shell.once("close", handleAuthAbort);
      view.webContents.loadURL(config.YTM_URL);

      let hasAttemptedLoginRedirect = false;
      let checkGeneration = 0;

      const markReady = () => {
        if (!isInitializing) return;
        isInitializing = false;
        shell.off("close", handleAuthAbort);
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
              shell.off("close", handleAuthAbort);
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
          shell.off("close", handleAuthAbort);
          const error = err instanceof Error ? err : new Error(String(err));
          res({ success: false, error });
        }
      };

      view.webContents.on("did-finish-load", async () => {
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

    // True once the player has the song, the track being its video id
    const played = await this._ytView.webContents.executeJavaScript(
      PlayJSCode(info.track),
    );
    if (!played) {
      throw new Error(`Nothing to play for ${info.track} on YouTube Music.`);
    }
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
}
