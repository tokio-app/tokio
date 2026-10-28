import { SongInfo, TOKIO_EVENTS } from "@/common/types";
import Logger from "@/logger";
import { cancelableEvent, views, windows } from "@test/electron";
import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import config from "./config";
import { Spotify } from "./index";

const API = "https://api.spotify.com/v1";
const PARTITION = "persist:music-spotify";
const TOKENS = {
  access_token: "access",
  refresh_token: "refresh",
  expires_in: 3600,
};
const REFRESHED = { access_token: "fresh", expires_in: 3600 };

const json = (body: unknown, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });

const noContent = () => new Response(null, { status: 204 });

const apiError = (status: number, message: string, headers = {}) =>
  json({ error: { status, message } }, status, headers);

const urlOf = (input: string | URL | Request) =>
  typeof input === "string"
    ? input
    : input instanceof URL
      ? input.href
      : input.url;

const bodyOf = (init: RequestInit | undefined) =>
  typeof init?.body === "string" ? init.body : "";

type Answer = (path: string, init: RequestInit) => Response;

/**
 * Answers the token endpoint (the code exchange with TOKENS, refreshes with
 * `refresh`) and the Web API with `api`, which gets the path after /v1.
 */
const stubFetch = ({
  api = () => json({}),
  refresh = () => json(REFRESHED),
}: { api?: Answer; refresh?: () => Response | Promise<Response> } = {}) => {
  const fetch = vi.fn(
    async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = urlOf(input);
      if (url !== config.TOKEN_URL) return api(url.slice(API.length), init);
      const grant = new URLSearchParams(bodyOf(init)).get("grant_type");
      return grant === "refresh_token" ? refresh() : json(TOKENS);
    },
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
};

type FetchMock = ReturnType<typeof stubFetch>;

const tokenRequests = (fetch: FetchMock) =>
  fetch.mock.calls
    .filter(([input]) => urlOf(input) === config.TOKEN_URL)
    .map(([, init]) => ({
      headers: new Headers(init?.headers),
      method: init?.method,
      body: Object.fromEntries(new URLSearchParams(bodyOf(init))),
    }));

const refreshes = (fetch: FetchMock) =>
  tokenRequests(fetch).filter((r) => r.body.grant_type === "refresh_token");

const apiRequests = (fetch: FetchMock) =>
  fetch.mock.calls
    .filter(([input]) => urlOf(input).startsWith(API))
    .map(([input, init]) => ({
      path: urlOf(input).slice(API.length),
      method: init?.method,
      auth: new Headers(init?.headers).get("Authorization"),
      body: bodyOf(init),
    }));

// The last connect's login page
const authView = () =>
  views()
    .filter((view) => view.options.webPreferences?.partition === PARTITION)
    .at(-1)!;

const redirect = (url: string, event = "will-redirect") => {
  const e = cancelableEvent({});
  authView().webContents.emit(event, e, url);
  return e;
};

const callback = (params: Record<string, string>) =>
  `${config.CALLBACK}?${new URLSearchParams(params)}`;

const login = async (spotify = new Spotify("client-id")) => {
  const pending = spotify.connect();
  redirect(callback({ code: "the-code" }));
  await expect(pending).resolves.toEqual({ success: true });
  return spotify;
};

const track = {
  name: "Song",
  artists: [{ name: "Artist A" }, { name: "Artist B" }],
  album: {
    uri: "spotify:album:1",
    images: [{ url: "https://i.scdn.co/image/cover" }],
  },
  uri: "spotify:track:1",
  duration_ms: 200_000,
};

const parsed: SongInfo = {
  title: "Song - Artist A, Artist B",
  album: "spotify:album:1",
  track: "spotify:track:1",
  thumbnail: "https://i.scdn.co/image/cover",
  duration: 200_000,
};

const DEVICES = {
  devices: [
    { id: "phone", is_active: false },
    { id: "desktop", is_active: true },
  ],
};

describe("Spotify", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("connect", () => {
    it("opens the authorize page with the app's client and PKCE", async () => {
      const fetch = stubFetch();
      const spotify = new Spotify();
      spotify.setKey("client-id");

      const pending = spotify.connect();
      const authorize = new URL(authView().webContents.getURL());
      redirect(callback({ code: "the-code" }));
      await pending;

      expect(`${authorize.origin}${authorize.pathname}`).toBe(
        config.AUTHORIZE_URL,
      );
      const params = Object.fromEntries(authorize.searchParams);
      expect(params).toEqual({
        client_id: "client-id",
        response_type: "code",
        redirect_uri: config.CALLBACK,
        scope: config.SCOPES,
        code_challenge_method: "S256",
        code_challenge: expect.any(String),
      });

      const verifier = tokenRequests(fetch)[0].body.code_verifier;
      expect(verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/);
      expect(params.code_challenge).toBe(
        createHash("sha256").update(verifier).digest("base64url"),
      );
    });

    it("trims the Client ID, which a paste can pad with spaces", () => {
      const spotify = new Spotify();
      spotify.setKey(" client-id ");

      spotify.connect();

      const authorize = new URL(authView().webContents.getURL());
      expect(authorize.searchParams.get("client_id")).toBe("client-id");
    });

    it("shows the login in its own session under the title bar", () => {
      new Spotify("client-id").connect();
      const shell = windows()[0];
      const view = authView();

      expect(shell.isVisible()).toBe(true);
      // Spotify's page never gets the bridge
      expect(view.options.webPreferences?.preload).toBeUndefined();
      expect(view.options.webPreferences?.nodeIntegration).not.toBe(true);
      expect(shell.contentView.children).toContain(view);
      expect(view.setBounds).toHaveBeenLastCalledWith({
        x: 0,
        y: 40,
        width: 1280,
        height: 800,
      });

      shell.resize(1600, 900);

      expect(view.setBounds).toHaveBeenLastCalledWith({
        x: 0,
        y: 40,
        width: 1600,
        height: 860,
      });
    });

    it("exchanges the code for a token and becomes active", async () => {
      const fetch = stubFetch();
      const spotify = new Spotify("client-id");

      const pending = spotify.connect();
      const event = redirect(callback({ code: "the-code" }));

      await expect(pending).resolves.toEqual({ success: true });
      expect(event.defaultPrevented).toBe(true);
      expect(spotify.isActive()).toBe(true);

      const [exchange] = tokenRequests(fetch);
      expect(exchange.method).toBe("POST");
      expect(exchange.headers.get("Content-Type")).toBe(
        "application/x-www-form-urlencoded",
      );
      expect(exchange.body).toEqual({
        client_id: "client-id",
        grant_type: "authorization_code",
        code: "the-code",
        redirect_uri: config.CALLBACK,
        code_verifier: expect.any(String),
      });
    });

    it("takes the redirect from will-navigate too", async () => {
      stubFetch();
      const spotify = new Spotify("client-id");

      const pending = spotify.connect();
      const event = redirect(callback({ code: "the-code" }), "will-navigate");

      await expect(pending).resolves.toEqual({ success: true });
      expect(event.defaultPrevented).toBe(true);
    });

    it("lets the login pages navigate", async () => {
      const fetch = stubFetch();
      const done = vi.fn();
      new Spotify("client-id").connect().then(done);

      const event = redirect(
        "https://accounts.spotify.com/login?continue=x",
        "will-navigate",
      );
      await vi.advanceTimersByTimeAsync(0);

      expect(event.defaultPrevented).toBe(false);
      expect(done).not.toHaveBeenCalled();
      expect(fetch).not.toHaveBeenCalled();
    });

    it("fails when the user denies access", async () => {
      const fetch = stubFetch();
      const spotify = new Spotify("client-id");

      const pending = spotify.connect();
      redirect(callback({ error: "access_denied" }));

      await expect(pending).resolves.toEqual({
        success: false,
        error: new Error("Login Error: access_denied"),
      });
      expect(spotify.isActive()).toBe(false);
      expect(fetch).not.toHaveBeenCalled();
    });

    it("fails when the exchange gives no token", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => json({ error: "invalid_grant" }, 400)),
      );
      const spotify = new Spotify("client-id");

      const pending = spotify.connect();
      redirect(callback({ code: "the-code" }));

      await expect(pending).resolves.toEqual({
        success: false,
        error: new Error("Failed to retrieve access token."),
      });
      expect(spotify.isActive()).toBe(false);
    });

    it("fails when the window is closed before the redirect", async () => {
      const spotify = new Spotify("client-id");
      const pending = spotify.connect();
      const shell = windows()[0];
      const view = authView();

      shell.close();

      const result = await pending;
      expect(result.success).toBe(false);
      expect(result.error?.message).toContain("closed by the user");
      expect(spotify.isActive()).toBe(false);
      expect(shell.contentView.removeChildView).toHaveBeenCalledWith(view);
      expect(view.webContents.close).toHaveBeenCalledOnce();
    });

    it("removes and closes the login view and the window afterwards", async () => {
      stubFetch();
      const pending = new Spotify("client-id").connect();
      const shell = windows()[0];
      const view = authView();

      redirect(callback({ code: "the-code" }));
      await pending;

      expect(shell.contentView.removeChildView).toHaveBeenCalledWith(view);
      expect(shell.contentView.children).toEqual([]);
      expect(view.webContents.close).toHaveBeenCalledOnce();
      expect(view.webContents.isDestroyed()).toBe(true);
      expect(shell.isDestroyed()).toBe(true);
    });

    it("resolves right away while active", async () => {
      stubFetch();
      const spotify = await login();

      await expect(spotify.connect()).resolves.toEqual({ success: true });
      expect(windows()).toHaveLength(1);
    });

    it("closes a login still open when it connects again", async () => {
      stubFetch();
      const spotify = new Spotify("client-id");
      const first = spotify.connect();
      const [shell, view] = [windows()[0], authView()];

      const second = spotify.connect();

      expect(shell.isDestroyed()).toBe(true);
      expect(view.webContents.close).toHaveBeenCalledOnce();
      expect((await first).success).toBe(false);

      redirect(callback({ code: "the-code" }));
      await expect(second).resolves.toEqual({ success: true });
      expect(windows()).toHaveLength(2);
    });

    it("fails when the callback has neither a code nor an error", async () => {
      stubFetch();
      const done = vi.fn();
      new Spotify("client-id").connect().then(done);

      redirect(callback({ state: "abc" }));
      await vi.advanceTimersByTimeAsync(0);

      expect(done).toHaveBeenCalledWith(
        expect.objectContaining({ success: false }),
      );
    });
  });

  describe("searchSong", () => {
    it("searches the trimmed query with the token and parses the first track", async () => {
      const fetch = stubFetch({
        api: () =>
          json({ tracks: { items: [track, { ...track, name: "Other" }] } }),
      });
      const spotify = await login();

      expect(await spotify.searchSong("  song  ")).toEqual(parsed);
      expect(apiRequests(fetch)).toEqual([
        {
          path: "/search?q=song&type=track&limit=1",
          method: "GET",
          auth: "Bearer access",
          body: "",
        },
      ]);
    });

    it("fills missing fields with defaults", async () => {
      stubFetch({ api: () => json({ tracks: { items: [{}] } }) });
      const spotify = await login();

      expect(await spotify.searchSong("song")).toEqual({
        album: "Unknown",
        track: "Unknown",
        title: "Unknown track - Unknown artist",
        thumbnail: "",
        duration: 0,
      });
    });

    it("names an unknown artist when the track lists none", async () => {
      stubFetch({
        api: () => json({ tracks: { items: [{ ...track, artists: [] }] } }),
      });
      const spotify = await login();

      expect((await spotify.searchSong("song"))?.title).toMatch(
        / - Unknown artist$/,
      );
    });

    it("returns null when nothing is found", async () => {
      stubFetch({ api: () => json({ tracks: { items: [] } }) });
      const spotify = await login();

      expect(await spotify.searchSong("song")).toBeNull();
    });

    it("returns null while inactive or for a blank query, without a request", async () => {
      const fetch = stubFetch({
        api: () => json({ tracks: { items: [track] } }),
      });

      expect(await new Spotify("client-id").searchSong("song")).toBeNull();

      const spotify = await login();
      expect(await spotify.searchSong("   ")).toBeNull();
      expect(apiRequests(fetch)).toEqual([]);
    });
  });

  describe("playerStatus", () => {
    it("adds whether it's playing, the time and what it plays from", async () => {
      const fetch = stubFetch({
        api: () =>
          json({
            item: track,
            context: { uri: "spotify:playlist:9" },
            is_playing: true,
            progress_ms: 42_000,
          }),
      });
      const spotify = await login();

      expect(await spotify.playerStatus()).toEqual({
        ...parsed,
        album: "spotify:playlist:9",
        playing: true,
        time: 42_000,
      });
      expect(apiRequests(fetch)[0]).toMatchObject({
        path: "/me/player",
        method: "GET",
      });
    });

    it("defaults to paused at the start, played from nowhere", async () => {
      stubFetch({ api: () => json({ item: track }) });
      const spotify = await login();

      expect(await spotify.playerStatus()).toEqual({
        ...parsed,
        album: "",
        playing: false,
        time: 0,
      });
    });

    it("returns null when nothing is playing", async () => {
      stubFetch({ api: noContent });
      const spotify = await login();

      expect(await spotify.playerStatus()).toBeNull();
    });

    it("returns null while disconnected, without a request", async () => {
      const fetch = stubFetch({ api: () => json({ item: track }) });

      expect(await new Spotify("client-id").playerStatus()).toBeNull();
      expect(apiRequests(fetch)).toEqual([]);
    });
  });

  describe("API errors", () => {
    it("refreshes an expired token and retries once", async () => {
      let expired = true;
      const fetch = stubFetch({
        api: (_path, init) => {
          const auth = new Headers(init.headers).get("Authorization");
          if (expired && auth === "Bearer access") {
            expired = false;
            return apiError(401, "The access token expired");
          }
          return json({ tracks: { items: [track] } });
        },
      });
      const spotify = await login();

      expect(await spotify.searchSong("song")).toEqual(parsed);

      expect(refreshes(fetch)).toEqual([
        {
          headers: expect.any(Headers),
          method: "POST",
          body: {
            client_id: "client-id",
            grant_type: "refresh_token",
            refresh_token: "refresh",
          },
        },
      ]);
      expect(apiRequests(fetch).map((r) => r.auth)).toEqual([
        "Bearer access",
        "Bearer fresh",
      ]);
    });

    it("asks to reconnect and ends the session when the refresh is refused", async () => {
      const fetch = stubFetch({
        api: () => apiError(401, "The access token expired"),
        refresh: () => json({ error: "invalid_grant" }, 400),
      });
      const spotify = await login();
      const ended = vi.fn();
      spotify.on(TOKIO_EVENTS.MUSIC_PROCCESS_ENDED, ended);

      await expect(spotify.searchSong("song")).rejects.toThrow(
        "Token expired and auto-refresh failed. Please reconnect.",
      );
      expect(apiRequests(fetch)).toHaveLength(1);
      expect(spotify.isActive()).toBe(false);
      expect(ended).toHaveBeenCalledOnce();
    });

    it("keeps the session when the token server fails", async () => {
      stubFetch({
        api: () => apiError(401, "The access token expired"),
        refresh: () => json({ error: "server_error" }, 500),
      });
      const spotify = await login();

      await expect(spotify.searchSong("song")).rejects.toThrow(
        "Token expired and auto-refresh failed. Please reconnect.",
      );
      expect(spotify.isActive()).toBe(true);
    });

    it("shares one refresh between requests that expire together", async () => {
      const fetch = stubFetch({
        api: (_path, init) =>
          new Headers(init.headers).get("Authorization") === "Bearer access"
            ? apiError(401, "The access token expired")
            : json({ tracks: { items: [track] } }),
      });
      const spotify = await login();

      await expect(
        Promise.all([spotify.searchSong("a"), spotify.searchSong("b")]),
      ).resolves.toEqual([parsed, parsed]);
      expect(refreshes(fetch)).toHaveLength(1);
    });

    it("asks to reconnect when the token expires again after a refresh", async () => {
      const fetch = stubFetch({ api: () => apiError(401, "Expired") });
      const spotify = await login();

      await expect(spotify.searchSong("song")).rejects.toThrow(
        "Token expired. Please reconnect.",
      );
      expect(refreshes(fetch)).toHaveLength(1);
      expect(apiRequests(fetch)).toHaveLength(2);
    });

    it("explains a 403", async () => {
      stubFetch({ api: () => apiError(403, "Forbidden") });
      const spotify = await login();

      await expect(spotify.searchSong("song")).rejects.toThrow(
        "Premium Required or user not whitelisted.",
      );
    });

    it("says how long to wait after a 429", async () => {
      stubFetch({
        api: () => apiError(429, "Too many requests", { "Retry-After": "7" }),
      });
      const spotify = await login();

      await expect(spotify.searchSong("song")).rejects.toThrow(
        "Rate Limit Hit. Wait 7 seconds.",
      );
    });

    it("waits 60 seconds after a 429 without Retry-After", async () => {
      stubFetch({ api: () => apiError(429, "Too many requests") });
      const spotify = await login();

      await expect(spotify.searchSong("song")).rejects.toThrow(
        "Rate Limit Hit. Wait 60 seconds.",
      );
    });

    it("sends nothing until the wait after a 429 is over", async () => {
      const fetch = stubFetch({
        api: () => apiError(429, "Too many requests", { "Retry-After": "7" }),
      });
      const spotify = await login();
      await expect(spotify.searchSong("song")).rejects.toThrow("Wait 7");

      await vi.advanceTimersByTimeAsync(1000);
      await expect(spotify.searchSong("song")).rejects.toThrow(
        "Rate Limit Hit. Wait 6 seconds.",
      );
      expect(apiRequests(fetch)).toHaveLength(1);

      await vi.advanceTimersByTimeAsync(6000);
      await expect(spotify.searchSong("song")).rejects.toThrow("Wait 7");
      expect(apiRequests(fetch)).toHaveLength(2);
    });

    it("uses the API's message for other errors", async () => {
      stubFetch({ api: () => apiError(500, "Server broke") });
      const spotify = await login();

      await expect(spotify.searchSong("song")).rejects.toThrow("Server broke");
    });

    it("falls back to the status without an API message", async () => {
      stubFetch({ api: () => new Response("Bad gateway", { status: 502 }) });
      const spotify = await login();

      await expect(spotify.searchSong("song")).rejects.toThrow("API Error 502");
    });
  });

  describe("play", () => {
    const devicesAnd =
      (play: () => Response = noContent, devices: unknown = DEVICES): Answer =>
      (path) =>
        path === "/me/player/devices" ? json(devices) : play();

    const devicesListed = (fetch: FetchMock) =>
      apiRequests(fetch).filter((r) => r.path === "/me/player/devices").length;

    it("plays the track in its album on the active device", async () => {
      const fetch = stubFetch({ api: devicesAnd() });
      const spotify = await login();

      await spotify.play(parsed);

      const play = apiRequests(fetch).at(-1);
      expect(play).toEqual({
        path: "/me/player/play?device_id=desktop",
        method: "PUT",
        auth: "Bearer access",
        body: expect.any(String),
      });
      expect(JSON.parse(play?.body ?? "")).toEqual({
        context_uri: "spotify:album:1",
        offset: { uri: "spotify:track:1" },
      });
    });

    it("plays the track in the playlist it played from", async () => {
      const fetch = stubFetch({ api: devicesAnd() });
      const spotify = await login();

      await spotify.play({ ...parsed, album: "spotify:playlist:9" });

      expect(JSON.parse(apiRequests(fetch).at(-1)?.body ?? "")).toEqual({
        context_uri: "spotify:playlist:9",
        offset: { uri: "spotify:track:1" },
      });
    });

    it.each([
      ["no context", ""],
      ["a local file's album", "Unknown"],
      ["an artist", "spotify:artist:1"],
    ])("plays the track alone from %s", async (_case, album) => {
      const fetch = stubFetch({ api: devicesAnd() });
      const spotify = await login();

      await spotify.play({ ...parsed, album });

      expect(JSON.parse(apiRequests(fetch).at(-1)?.body ?? "")).toEqual({
        uris: ["spotify:track:1"],
      });
    });

    it("plays on the device playback moved to", async () => {
      let active = "phone";
      const fetch = stubFetch({
        api: (path) =>
          path === "/me/player/devices"
            ? json({
                devices: [
                  { id: "phone", is_active: active === "phone" },
                  { id: "desktop", is_active: active === "desktop" },
                ],
              })
            : noContent(),
      });
      const spotify = await login();
      await spotify.play(parsed);

      active = "desktop";
      await spotify.play(parsed);

      expect(devicesListed(fetch)).toBe(2);
      expect(apiRequests(fetch).at(-1)?.path).toBe(
        "/me/player/play?device_id=desktop",
      );
    });

    it("uses the first device when none is active", async () => {
      const fetch = stubFetch({
        api: devicesAnd(noContent, {
          devices: [
            { id: "phone", is_active: false },
            { id: "desktop", is_active: false },
          ],
        }),
      });
      const spotify = await login();

      await spotify.play(parsed);

      expect(apiRequests(fetch).at(-1)?.path).toBe(
        "/me/player/play?device_id=phone",
      );
    });

    it("fails without devices", async () => {
      stubFetch({ api: devicesAnd(noContent, { devices: [] }) });
      const spotify = await login();

      await expect(spotify.play(parsed)).rejects.toThrow(
        "No active devices. Play a song on Spotify first.",
      );
    });

    it("does nothing while inactive", async () => {
      const fetch = stubFetch({ api: devicesAnd() });

      await new Spotify("client-id").play(parsed);

      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe("token refresh", () => {
    it("refreshes 60 seconds before the token expires", async () => {
      const fetch = stubFetch({
        api: () => json({ tracks: { items: [track] } }),
      });
      const spotify = await login();

      await vi.advanceTimersByTimeAsync((3600 - 60) * 1000 - 1);
      expect(refreshes(fetch)).toEqual([]);

      await vi.advanceTimersByTimeAsync(1);
      expect(refreshes(fetch)).toHaveLength(1);
      expect(refreshes(fetch)[0].body.refresh_token).toBe("refresh");

      await spotify.searchSong("song");
      expect(apiRequests(fetch).at(-1)?.auth).toBe("Bearer fresh");

      // The next one follows the new expiry, with the refresh token kept
      await vi.advanceTimersByTimeAsync((3600 - 60) * 1000);
      expect(refreshes(fetch)).toHaveLength(2);
      expect(refreshes(fetch)[1].body.refresh_token).toBe("refresh");
    });

    it("sends the refresh token a refresh gave instead of the old one", async () => {
      const fetch = stubFetch({
        refresh: () => json({ ...REFRESHED, refresh_token: "r2" }),
      });
      await login();

      await vi.advanceTimersByTimeAsync((3600 - 60) * 1000);
      await vi.advanceTimersByTimeAsync((3600 - 60) * 1000);

      expect(refreshes(fetch).map((r) => r.body.refresh_token)).toEqual([
        "refresh",
        "r2",
      ]);
    });

    it("refreshes right away when the token expires within a minute", async () => {
      const fetch = stubFetch();
      fetch.mockImplementationOnce(async () =>
        json({ ...TOKENS, expires_in: 30 }),
      );
      await login();

      await vi.advanceTimersByTimeAsync(0);

      expect(refreshes(fetch)).toHaveLength(1);
    });

    it("logs a refresh that fails, and ends the session when it's refused", async () => {
      stubFetch({ refresh: () => json({ error: "invalid_grant" }, 400) });
      const logError = vi.spyOn(Logger, "error").mockImplementation(() => {});
      const spotify = await login();
      spotify.setLogFile("music.log");

      await vi.advanceTimersByTimeAsync((3600 - 60) * 1000);

      expect(logError).toHaveBeenCalledExactlyOnceWith(
        expect.stringContaining("<Music> Unable to refresh the Spotify token"),
        "music.log",
        expect.any(Error),
      );
      expect(spotify.isActive()).toBe(false);
    });
  });

  it("gives every request a timeout of its own", async () => {
    let expired = true;
    const fetch = stubFetch({
      api: () => {
        if (!expired) return json({ tracks: { items: [track] } });
        expired = false;
        return apiError(401, "The access token expired");
      },
    });
    const spotify = await login();

    await spotify.searchSong("song");

    // The code exchange, the request, the refresh and the retry
    const signals = fetch.mock.calls.map(([, init]) => init?.signal);
    expect(signals).toEqual(Array(4).fill(expect.any(AbortSignal)));
    expect(new Set(signals).size).toBe(4);
  });

  describe("disconnect", () => {
    it("ends the session once", async () => {
      const fetch = stubFetch({
        api: () => json({ tracks: { items: [track] } }),
      });
      const spotify = await login();
      const ended = vi.fn();
      spotify.on(TOKIO_EVENTS.MUSIC_PROCCESS_ENDED, ended);

      spotify.disconnect();
      spotify.disconnect();

      expect(ended).toHaveBeenCalledOnce();
      expect(spotify.isActive()).toBe(false);
      expect(await spotify.searchSong("song")).toBeNull();
      expect(apiRequests(fetch)).toEqual([]);
    });

    it("does nothing while inactive", () => {
      const spotify = new Spotify("client-id");
      const ended = vi.fn();
      spotify.on(TOKIO_EVENTS.MUSIC_PROCCESS_ENDED, ended);

      spotify.disconnect();

      expect(ended).not.toHaveBeenCalled();
    });

    it("closes a login still open, which fails it", async () => {
      const spotify = new Spotify("client-id");
      const pending = spotify.connect();
      const shell = windows()[0];

      spotify.disconnect();

      expect(shell.isDestroyed()).toBe(true);
      expect((await pending).error?.message).toContain("closed by the user");
    });

    it("stops calling a listener removed with off", async () => {
      stubFetch();
      const spotify = await login();
      const ended = vi.fn();
      spotify.on(TOKIO_EVENTS.MUSIC_PROCCESS_ENDED, ended);
      spotify.off(TOKIO_EVENTS.MUSIC_PROCCESS_ENDED, ended);

      spotify.disconnect();

      expect(ended).not.toHaveBeenCalled();
    });

    it("cancels the scheduled token refresh", async () => {
      const fetch = stubFetch();
      const spotify = await login();

      spotify.disconnect();

      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(3600 * 1000);
      expect(refreshes(fetch)).toEqual([]);
    });

    it("doesn't bring the session back when a refresh finishes after it", async () => {
      let finishRefresh = (_response: Response) => {};
      const fetch = stubFetch({
        refresh: () =>
          new Promise<Response>((resolve) => {
            finishRefresh = resolve;
          }),
      });
      const spotify = await login();
      await vi.advanceTimersByTimeAsync((3600 - 60) * 1000);
      expect(refreshes(fetch)).toHaveLength(1);

      spotify.disconnect();
      finishRefresh(json({ ...REFRESHED, refresh_token: "next" }));
      await vi.advanceTimersByTimeAsync(3600 * 1000);

      expect(refreshes(fetch)).toHaveLength(1);
      expect(spotify.isActive()).toBe(false);
    });
  });
});
