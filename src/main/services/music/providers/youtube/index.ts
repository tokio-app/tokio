import { CurrentSongInfo, SongInfo, TOKIO_EVENTS } from "@/common/types";
import { BrowserWindow, WebContentsView } from "electron";
import {
  ConnectionResponse,
  ConnectOptions,
  createWindow,
  MusicProvider,
} from "../../common";
import {
  KEEP_PLAYING_WORLD,
  KeepPlayingJSCode,
  parseSongRenderer,
  PlayerStateJSCode,
  PlayJSCode,
} from "./common";
import { AdBlocker } from "./common/adblock";
import config from "./config";

// Where the player's window may go: YouTube and Google's sign-in
const isYouTubeOrLogin = (hostname: string) =>
  hostname === "accounts.google.com" ||
  hostname === "youtube.com" ||
  hostname.endsWith(".youtube.com");

const YTM_HOST = new URL(config.YTM_URL).hostname;
const isYouTubeMusic = (url: string) =>
  URL.canParse(url) && new URL(url).hostname === YTM_HOST;

export class YouTubeMusic extends MusicProvider {
  public readonly adBlocker = new AdBlocker(() => this._logFile);
  private _ytView: WebContentsView | null = null;
  private _shellWindow: BrowserWindow | null = null;
  private _isActive: boolean = false;

  public setKey(_key: string): void {
    return;
  }

  public isActive(): boolean {
    return this._isActive;
  }

  public connect({
    blockAds = false,
  }: ConnectOptions = {}): Promise<ConnectionResponse> {
    if (this._isActive) return Promise.resolve({ success: true });
    // An earlier connect still waiting fails, so one window is left
    this.disconnect();

    // This connect's own, for listeners that outlive it
    const view = (this._ytView = new WebContentsView({
      webPreferences: {
        partition: "persist:music-youtube",
        backgroundThrottling: false,
      },
    }));

    const shell = (this._shellWindow = createWindow(view, () => this._logFile));

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
      // Why ads couldn't be blocked, said once connected
      let adblockError: unknown;

      const handleClose = () => {
        isInitializing = false;
        res({
          success: false,
          error: new Error("The window was closed before YouTube Music loaded"),
        });
      };

      shell.once("close", handleClose);
      // Unless the window closed or a newer connect replaced it meanwhile
      const current = () => this._ytView === view;
      const load = () => {
        if (current()) view.webContents.loadURL(config.YTM_URL);
      };
      const { session } = view.webContents;
      if (blockAds) {
        // Before the page loads: only pages loaded after get its preload.
        // It owns the session's webRequest listeners, one per event.
        this.adBlocker
          .ready()
          .then((blocker) => {
            if (current()) blocker.enable(session);
          })
          .catch((error: unknown) => {
            adblockError = error;
          })
          .finally(load);
      } else {
        // Off, its lists leave memory too
        this.adBlocker.dispose();
        load();
      }

      // Connected once YouTube Music loads, signed in or not: signing in is
      // up to the streamer, from the page (the user's call)
      view.webContents.on("did-finish-load", () => {
        if (!isYouTubeMusic(view.webContents.getURL())) return;
        // Each page load starts without it. A page gone meanwhile has
        // nothing left to keep playing.
        view.webContents
          .executeJavaScriptInIsolatedWorld(KEEP_PLAYING_WORLD, [
            { code: KeepPlayingJSCode },
          ])
          .catch(() => {});
        if (!isInitializing) return;
        isInitializing = false;
        shell.off("close", handleClose);
        this._isActive = true;
        res({ success: true, adblockError });
      });
    });
  }

  // Ends the session, or fails a connect still waiting. The window's close
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
}
