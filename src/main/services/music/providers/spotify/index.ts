import { CurrentSongInfo, SongInfo, TOKIO_EVENTS } from "@/common/types";
import { formatError } from "@/common/util";
import Logger from "@/logger";
import crypto from "crypto";
import { BrowserWindow, WebContentsView } from "electron";
import { ConnectionResponse, createWindow, MusicProvider } from "../../common";
import { CSSScrollBar } from "./common";
import config from "./config";

export class Spotify extends MusicProvider {
  private _clientId: string;
  private _accessToken: string | null = null;
  private _refreshToken: string | null = null;
  private _cachedDeviceId: string | null = null;
  private _isActive: boolean = false;
  private _refreshTimeout: NodeJS.Timeout | null = null;
  // Counts disconnects, so a refresh that ends after one is dropped
  private _session = 0;
  // The refresh in flight, which requests that expire together share
  private _refreshing: Promise<void> | null = null;
  // When a 429 lets requests through again
  private _retryAt = 0;
  // The login window of the last connect
  private _authWindow: BrowserWindow | null = null;

  constructor(clientId?: string) {
    super();
    this._clientId = clientId ?? "";
  }

  // Trimmed, since a pasted Client ID with a space breaks the authorize URL
  public setKey(key: string): void {
    this._clientId = key.trim();
  }

  public isActive(): boolean {
    return this._isActive;
  }

  public connect(): Promise<ConnectionResponse> {
    if (this._isActive) return Promise.resolve({ success: true });
    // A login still open from an earlier connect fails, so one window is left
    this.disconnect();

    return new Promise((res) => {
      const codeVerifier = this.generateRandomString(64);
      const codeChallenge = this.generateCodeChallenge(codeVerifier);

      const authView = new WebContentsView({
        webPreferences: {
          partition: "persist:music-spotify",
        },
      });

      const shellWindow = (this._authWindow = createWindow(authView));

      const cleanupView = () => {
        try {
          shellWindow.contentView.removeChildView(authView);
        } catch {
          // Next
        }

        if (!authView.webContents.isDestroyed()) {
          authView.webContents.close();
        }
      };

      authView.webContents.on("dom-ready", async () => {
        try {
          await authView.webContents.insertCSS(CSSScrollBar);
        } catch {
          // Ignore if page unloads rapidly
        }
      });

      const authUrl = new URL(config.AUTHORIZE_URL);
      authUrl.searchParams.append("client_id", this._clientId);
      authUrl.searchParams.append("response_type", "code");
      authUrl.searchParams.append("redirect_uri", config.CALLBACK);
      authUrl.searchParams.append("code_challenge_method", "S256");
      authUrl.searchParams.append("code_challenge", codeChallenge);
      authUrl.searchParams.append("scope", config.SCOPES);

      authView.webContents.loadURL(authUrl.toString());
      shellWindow.show();

      let isProcessing = false;

      const handleUserAbort = () => {
        if (!isProcessing) {
          cleanupView();
          this._isActive = false;
          res({
            success: false,
            error: new Error("Authentication window was closed by the user."),
          });
        }
      };

      shellWindow.once("closed", handleUserAbort);

      const handleRedirect = async (url: string) => {
        if (isProcessing || !url.startsWith(config.CALLBACK)) return;
        isProcessing = true;

        shellWindow.off("closed", handleUserAbort);

        const urlObj = new URL(url);
        const code = urlObj.searchParams.get("code");
        // The window is gone, so a callback without a code can only fail
        const error =
          urlObj.searchParams.get("error") ?? (code ? null : "no code");

        cleanupView();

        if (!shellWindow.isDestroyed()) {
          shellWindow.close();
        }

        if (error) {
          this._isActive = false;
          res({
            success: false,
            error: new Error(`Login Error: ${error}`),
          });
        } else if (code) {
          try {
            await this.exchangeCodeForToken(code, codeVerifier);
            this._isActive = true;
            res({
              success: true,
            });
          } catch (err) {
            this._isActive = false;
            res({
              success: false,
              error: err instanceof Error ? err : new Error(String(err)),
            });
          }
        }
      };

      authView.webContents.on("will-redirect", (event, url) => {
        if (url.startsWith(config.CALLBACK)) {
          event.preventDefault();
          handleRedirect(url);
        }
      });

      authView.webContents.on("will-navigate", (event, url) => {
        if (url.startsWith(config.CALLBACK)) {
          event.preventDefault();
          handleRedirect(url);
        }
      });
    });
  }

  public disconnect(): void {
    // A login still open fails once its window closes
    if (this._authWindow && !this._authWindow.isDestroyed()) {
      this._authWindow.close();
    }
    if (!this._isActive) return;
    if (this._refreshTimeout) clearTimeout(this._refreshTimeout);
    this._refreshTimeout = null;
    this._session++;
    this._refreshing = null;
    this._accessToken = null;
    this._refreshToken = null;
    this._cachedDeviceId = null;
    this._isActive = false;
    this.emit(TOKIO_EVENTS.MUSIC_PROCCESS_ENDED);
  }

  public async play(info: SongInfo): Promise<void> {
    if (!this._isActive) return;
    const deviceId = await this.getTargetDevice();
    // An offset only works in an album or playlist. A song played from
    // elsewhere (an artist, Liked Songs, a local file) plays alone.
    const body = /^spotify:(album|playlist):/.test(info.album)
      ? { context_uri: info.album, offset: { uri: info.track } }
      : { uris: [info.track] };
    await this.fetchApi(`/me/player/play?device_id=${deviceId}`, "PUT", body);
  }

  public async playerStatus(): Promise<CurrentSongInfo | null> {
    if (!this._isActive) return null;
    const searchRes = await this.fetchApi(`/me/player`);
    const song = this._parseSong(searchRes?.item);
    if (!song) return null;
    return {
      ...song,
      // What it plays from, so the song plays there again after requests
      album: searchRes.context?.uri ?? "",
      playing: searchRes.is_playing ?? false,
      time: searchRes.progress_ms ?? 0,
    };
  }

  public async searchSong(query: string): Promise<SongInfo | null> {
    if (!this._isActive || !query.trim()) return null;

    const params = new URLSearchParams({
      q: query.trim(),
      type: "track",
      limit: "1",
    });

    const searchRes = await this.fetchApi(`/search?${params.toString()}`);
    const track = searchRes?.tracks?.items?.[0];

    return this._parseSong(track);
  }

  private _parseSong(track: any): SongInfo | null {
    if (!track) return null;

    const artistNames =
      track.artists?.map((a: any) => a.name).join(", ") || "Unknown Artist";

    return {
      album: track.album?.uri ?? "Unknown",
      track: track.uri ?? "Unknown",
      title: `${track.name ?? "Unknown Track"} - ${artistNames}`,
      thumbnail: track.album?.images?.[0]?.url ?? "",
      duration: track.duration_ms ?? 0,
    };
  }

  private async exchangeCodeForToken(
    code: string,
    verifier: string,
  ): Promise<void> {
    const body = new URLSearchParams({
      client_id: this._clientId,
      grant_type: "authorization_code",
      code: code,
      redirect_uri: config.CALLBACK,
      code_verifier: verifier,
    });

    const response = await fetch(config.TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(config.REQUEST_TIMEOUT_MS),
    });

    const data = await response.json();
    if (data.access_token) {
      this._accessToken = data.access_token;
      this._refreshToken = data.refresh_token;

      this.scheduleTokenRefresh(data.expires_in);
    } else {
      throw new Error("Failed to retrieve access token.");
    }
  }

  private refreshAccessToken(): Promise<void> {
    if (!this._refreshing) {
      const refresh = this._refresh().finally(() => {
        if (this._refreshing === refresh) this._refreshing = null;
      });
      this._refreshing = refresh;
    }
    return this._refreshing;
  }

  private async _refresh(): Promise<void> {
    if (!this._refreshToken) throw new Error("No refresh token available.");
    const session = this._session;

    const body = new URLSearchParams({
      client_id: this._clientId,
      grant_type: "refresh_token",
      refresh_token: this._refreshToken,
    });

    const response = await fetch(config.TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(config.REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      // A refused refresh token ends the session, a server error keeps it.
      const refused = response.status === 400 || response.status === 401;
      if (refused && session === this._session) this.disconnect();
      throw new Error("Failed to refresh token. Session may be revoked.");
    }

    const data = await response.json();
    if (session !== this._session) return;
    this._accessToken = data.access_token;

    if (data.refresh_token) {
      this._refreshToken = data.refresh_token;
    }

    this.scheduleTokenRefresh(data.expires_in);
  }

  private scheduleTokenRefresh(expiresInSeconds: number) {
    if (this._refreshTimeout) clearTimeout(this._refreshTimeout);

    const refreshMs = (expiresInSeconds - 60) * 1000;

    this._refreshTimeout = setTimeout(
      () => {
        this.refreshAccessToken().catch((error) =>
          Logger.error(
            `<Music> Unable to refresh the Spotify token -- ${formatError(error)}`,
            this._logFile,
            error,
          ),
        );
      },
      refreshMs > 0 ? refreshMs : 0,
    );
  }

  private async fetchApi(endpoint: string, method: string = "GET", body?: any) {
    if (!this._accessToken)
      throw new Error("Not authenticated. Call authenticate() first.");

    const wait = Math.ceil((this._retryAt - performance.now()) / 1000);
    if (wait > 0) throw new Error(`Rate Limit Hit. Wait ${wait} seconds.`);

    // Each try gets its own timeout
    const makeRequest = () =>
      fetch(`https://api.spotify.com/v1${endpoint}`, {
        method,
        headers: {
          Authorization: `Bearer ${this._accessToken}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(config.REQUEST_TIMEOUT_MS),
      });

    let response = await makeRequest();

    if (response.status === 401 && this._refreshToken) {
      try {
        await this.refreshAccessToken();
        response = await makeRequest();
      } catch {
        throw new Error(
          "Token expired and auto-refresh failed. Please reconnect.",
        );
      }
    }

    if (response.status === 401)
      throw new Error("Token expired. Please reconnect.");
    if (response.status === 403)
      throw new Error("Premium Required or user not whitelisted.");
    if (response.status === 429) {
      const retryAfter = Number(response.headers.get("Retry-After")) || 60;
      this._retryAt = performance.now() + retryAfter * 1000;
      throw new Error(`Rate Limit Hit. Wait ${retryAfter} seconds.`);
    }

    if (!response.ok) {
      if (response.status === 404) this._cachedDeviceId = null;
      const errorText = await response.text();
      let errorMessage = `API Error ${response.status}`;
      try {
        errorMessage = JSON.parse(errorText).error.message;
      } catch {}
      throw new Error(errorMessage);
    }

    return response.headers.get("content-type")?.includes("application/json")
      ? response.json()
      : null;
  }

  private async getTargetDevice(): Promise<string> {
    if (this._cachedDeviceId) return this._cachedDeviceId;

    const res = await this.fetchApi("/me/player/devices");
    const devices = res?.devices || [];

    if (devices.length === 0)
      throw new Error("No active devices. Play a song on Spotify first.");

    const activeDevice = devices.find((d: any) => d.is_active) || devices[0];
    this._cachedDeviceId = activeDevice.id;
    return this._cachedDeviceId!;
  }

  private generateRandomString(length: number) {
    return crypto.randomBytes(60).toString("hex").slice(0, length);
  }

  private generateCodeChallenge(verifier: string) {
    return crypto.createHash("sha256").update(verifier).digest("base64url");
  }
}
