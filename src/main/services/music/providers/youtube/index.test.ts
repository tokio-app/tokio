import { CurrentSongInfo, SongInfo, TOKIO_EVENTS } from "@/common/types";
import {
  cancelableEvent,
  FakeWebContentsView,
  views,
  windows,
} from "@test/electron";
import { songRenderer } from "@test/fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AfterSearchJSCode,
  LoginJSCode,
  PlayerStateJSCode,
  SearchJSCode,
} from "./common";
import config from "./config";
import { YouTubeMusic } from "./index";

const PARTITION = "persist:music-youtube";
// The time a full run of login checks takes, from the first to the last
const CHECKS_MS =
  config.LOGIN_CHECK_INTERVAL_MS * (config.LOGIN_CHECK_ATTEMPTS - 1);

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const bodyOf = (init: RequestInit | undefined): unknown =>
  typeof init?.body === "string" ? JSON.parse(init.body) : undefined;

// A song row of a search result, as YouTube Music's API sends it
const songRow = (videoId: string, title: string, artist: string) =>
  songRenderer({
    videoId,
    columns: [[title], [artist, " • ", "Album", " • ", "3:25"]],
    thumbnail: `https://lh3.googleusercontent.com/${videoId}=w60-h60`,
  });

const searchResults = (sections: unknown[]) => ({
  contents: {
    tabbedSearchResultsRenderer: {
      tabs: [
        {
          tabRenderer: {
            content: { sectionListRenderer: { contents: sections } },
          },
        },
      ],
    },
  },
});

const shelf = (...rows: unknown[]) => ({
  musicShelfRenderer: {
    contents: rows.map((row) => ({ musicResponsiveListItemRenderer: row })),
  },
});

const stubFetch = (answer: () => Response | Promise<Response>) => {
  const fetch = vi.fn(async (_input: string, _init?: RequestInit) => answer());
  vi.stubGlobal("fetch", fetch);
  return fetch;
};

const song = (track = "dQw4w9WgXcQ"): SongInfo => ({
  album: "Unknown",
  track,
  title: "Song - Artist",
  thumbnail: "",
  duration: 205_000,
});

// The last connect's page
const ytView = () =>
  views()
    .filter((view) => view.options.webPreferences?.partition === PARTITION)
    .at(-1)!;

const scripts = (view: FakeWebContentsView, code: string) =>
  view.webContents.executeJavaScript.mock.calls.filter(([c]) => c === code)
    .length;

const loads = (view: FakeWebContentsView, url: string) =>
  view.webContents.loadURL.mock.calls.filter(([u]) => u === url).length;

/**
 * Starts connect(), with the page answering the login check with `loggedIn`.
 * The page reports a load only when the test emits "did-finish-load".
 */
const open = (
  loggedIn: () => boolean = () => true,
  provider = new YouTubeMusic(),
) => {
  const pending = provider.connect();
  const shell = windows().at(-1)!;
  const view = ytView();
  view.webContents.executeJavaScript.mockImplementation(async (code) =>
    code === LoginJSCode ? loggedIn() : undefined,
  );
  const finishLoad = () => view.webContents.emit("did-finish-load");
  return { provider, pending, shell, view, finishLoad };
};

const connected = async () => {
  const opened = open();
  opened.finishLoad();
  await expect(opened.pending).resolves.toEqual({ success: true });
  return opened;
};

describe("YouTubeMusic", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("searchSong", () => {
    it("asks the WEB_REMIX client for songs only", async () => {
      const fetch = stubFetch(() => json(searchResults([])));

      await new YouTubeMusic().searchSong("never gonna");

      expect(fetch).toHaveBeenCalledOnce();
      const [url, init] = fetch.mock.calls[0];
      expect(url).toBe(config.SEARCH_ENDPOINT);
      expect(init?.method).toBe("POST");
      expect(new Headers(init?.headers).get("Content-Type")).toBe(
        "application/json",
      );
      expect(bodyOf(init)).toEqual({
        context: {
          client: {
            clientName: "WEB_REMIX",
            clientVersion: config.CLIENT_VERSION,
          },
        },
        query: "never gonna",
        params: config.SONG_FILTER_PARAMS,
      });
    });

    it("returns the first song of the songs shelf", async () => {
      stubFetch(() =>
        json(
          searchResults([
            { itemSectionRenderer: {} },
            shelf(
              songRow("first", "Song", "Artist"),
              songRow("second", "Other", "Band"),
            ),
          ]),
        ),
      );

      expect(await new YouTubeMusic().searchSong("song")).toEqual({
        album: "Unknown",
        track: "first",
        title: "Song - Artist",
        thumbnail: "https://lh3.googleusercontent.com/first=w480-h480-l90-rj",
        duration: 205_000,
      });
    });

    it("returns null when nothing is found", async () => {
      stubFetch(() => json(searchResults([shelf()])));
      expect(await new YouTubeMusic().searchSong("song")).toBeNull();

      stubFetch(() => json(searchResults([{ itemSectionRenderer: {} }])));
      expect(await new YouTubeMusic().searchSong("song")).toBeNull();

      stubFetch(() => json({}));
      expect(await new YouTubeMusic().searchSong("song")).toBeNull();
    });

    it("returns null when the request fails", async () => {
      stubFetch(() =>
        json(searchResults([shelf(songRow("first", "Song", "Artist"))]), 500),
      );
      expect(await new YouTubeMusic().searchSong("song")).toBeNull();

      stubFetch(() => Promise.reject(new Error("offline")));
      expect(await new YouTubeMusic().searchSong("song")).toBeNull();
    });

    it("returns null for an empty query without a request", async () => {
      const fetch = stubFetch(() => json(searchResults([])));

      expect(await new YouTubeMusic().searchSong("")).toBeNull();
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  describe("connect", () => {
    it("opens YouTube Music in its own session under the title bar", () => {
      const { shell, view } = open();

      expect(shell.isVisible()).toBe(true);
      expect(view.options.webPreferences).toMatchObject({
        partition: PARTITION,
      });
      expect(shell.contentView.children).toContain(view);
      expect(view.webContents.loadURL).toHaveBeenCalledWith(config.YTM_URL);
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

    it("resolves once logged in, after a single check", async () => {
      const { provider, pending, view, finishLoad } = open();

      finishLoad();

      await expect(pending).resolves.toEqual({ success: true });
      expect(provider.isActive()).toBe(true);
      expect(scripts(view, LoginJSCode)).toBe(1);

      finishLoad();
      await vi.advanceTimersByTimeAsync(CHECKS_MS);

      expect(scripts(view, LoginJSCode)).toBe(1);
    });

    it("resolves right away while active", async () => {
      const { provider } = await connected();

      await expect(provider.connect()).resolves.toEqual({ success: true });
      expect(windows()).toHaveLength(1);
    });

    it("skips the login check without auth", async () => {
      const provider = new YouTubeMusic();
      const pending = provider.connect(false);
      const view = ytView();

      view.webContents.emit("did-finish-load");

      await expect(pending).resolves.toEqual({ success: true });
      expect(scripts(view, LoginJSCode)).toBe(0);
    });

    it("sends a logged-out user to the login page once, then fails", async () => {
      const done = vi.fn();
      const { provider, pending, view, finishLoad } = open(() => false);
      pending.then(done);

      finishLoad();
      await vi.advanceTimersByTimeAsync(CHECKS_MS - 1);
      expect(scripts(view, LoginJSCode)).toBe(config.LOGIN_CHECK_ATTEMPTS - 1);
      expect(loads(view, config.YTM_LOGIN_URL)).toBe(0);

      await vi.advanceTimersByTimeAsync(1);
      expect(scripts(view, LoginJSCode)).toBe(config.LOGIN_CHECK_ATTEMPTS);
      expect(view.webContents.session.clearStorageData).toHaveBeenCalledOnce();
      expect(loads(view, config.YTM_LOGIN_URL)).toBe(1);
      expect(done).not.toHaveBeenCalled();

      // Back on YouTube Music from the login page, still logged out
      await view.webContents.loadURL(config.YTM_URL);
      finishLoad();
      await vi.advanceTimersByTimeAsync(CHECKS_MS);

      expect(done).toHaveBeenCalledExactlyOnceWith({
        success: false,
        error: new Error("Login failed. Please try again."),
      });
      expect(view.webContents.session.clearStorageData).toHaveBeenCalledOnce();
      expect(loads(view, config.YTM_LOGIN_URL)).toBe(1);
      expect(provider.isActive()).toBe(false);

      // The window stays open, and its next pages aren't checked
      const checks = scripts(view, LoginJSCode);
      finishLoad();
      await vi.advanceTimersByTimeAsync(CHECKS_MS);
      expect(scripts(view, LoginJSCode)).toBe(checks);
    });

    it("closes a login still open when it connects again", async () => {
      const first = open(() => false);
      first.finishLoad();

      const second = open(() => false, first.provider);
      await vi.advanceTimersByTimeAsync(CHECKS_MS);

      await expect(first.pending).resolves.toEqual({
        success: false,
        error: new Error("Authentication window was closed by the user"),
      });
      expect(first.shell.isDestroyed()).toBe(true);
      expect(first.view.webContents.close).toHaveBeenCalledOnce();
      // The first page's login check stopped, and didn't reach the new page
      expect(scripts(first.view, LoginJSCode)).toBe(1);
      for (const { view } of [first, second]) {
        expect(
          view.webContents.session.clearStorageData,
        ).not.toHaveBeenCalled();
        expect(loads(view, config.YTM_LOGIN_URL)).toBe(0);
      }

      second.view.webContents.executeJavaScript.mockResolvedValue(true);
      second.finishLoad();
      await expect(second.pending).resolves.toEqual({ success: true });
      expect(windows().filter((w) => !w.isDestroyed())).toEqual([second.shell]);
    });

    it("resolves once the user logs in on the login page", async () => {
      let loggedIn = false;
      const { pending, view, finishLoad } = open(() => loggedIn);

      finishLoad();
      await vi.advanceTimersByTimeAsync(CHECKS_MS);
      expect(loads(view, config.YTM_LOGIN_URL)).toBe(1);

      loggedIn = true;
      await view.webContents.loadURL(config.YTM_URL);
      finishLoad();

      await expect(pending).resolves.toEqual({ success: true });
    });

    it("skips pages on accounts.google.com", async () => {
      const { view, finishLoad } = open(() => false);

      await view.webContents.loadURL(config.YTM_LOGIN_URL);
      finishLoad();
      await vi.advanceTimersByTimeAsync(CHECKS_MS);

      expect(scripts(view, LoginJSCode)).toBe(0);
    });

    it("drops a check that's still retrying when a newer page loads", async () => {
      const { view, finishLoad } = open(() => false);

      finishLoad();
      await vi.advanceTimersByTimeAsync(500);
      finishLoad();
      expect(scripts(view, LoginJSCode)).toBe(2);

      await vi.advanceTimersByTimeAsync(CHECKS_MS * 2);

      // The first load's check stopped after one attempt
      expect(scripts(view, LoginJSCode)).toBe(1 + config.LOGIN_CHECK_ATTEMPTS);
      expect(view.webContents.session.clearStorageData).toHaveBeenCalledOnce();
      expect(loads(view, config.YTM_LOGIN_URL)).toBe(1);
    });

    it("fails when the window is closed before login", async () => {
      const { provider, pending, shell, view, finishLoad } = open(() => false);
      finishLoad();

      shell.close();

      await expect(pending).resolves.toEqual({
        success: false,
        error: new Error("Authentication window was closed by the user"),
      });
      expect(provider.isActive()).toBe(false);
      expect(view.webContents.close).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(CHECKS_MS);
      expect(scripts(view, LoginJSCode)).toBe(1);
    });

    it("fails when the login check throws", async () => {
      const { pending, view, finishLoad } = open(() => false);
      const error = new Error("storage locked");
      view.webContents.session.clearStorageData.mockRejectedValue(error);

      finishLoad();
      await vi.advanceTimersByTimeAsync(CHECKS_MS);

      await expect(pending).resolves.toEqual({ success: false, error });
    });

    it("only lets the page navigate to YouTube and Google accounts", () => {
      const { view } = open();
      const navigate = (url: string) => {
        const event = cancelableEvent({ url });
        view.webContents.emit("will-navigate", event);
        return event.defaultPrevented;
      };

      expect(navigate("https://music.youtube.com/watch?v=abc")).toBe(false);
      expect(navigate("https://www.youtube.com/")).toBe(false);
      expect(navigate("https://accounts.google.com/signin")).toBe(false);
      expect(navigate("https://example.com/")).toBe(true);
      expect(navigate("https://www.google.com/")).toBe(true);
    });

    it("blocks hosts that only look like YouTube", () => {
      const { view } = open();
      const navigate = (url: string) => {
        const event = cancelableEvent({ url });
        view.webContents.emit("will-navigate", event);
        return event.defaultPrevented;
      };

      expect(navigate("https://youtube.com.example.net/")).toBe(true);
      expect(navigate("https://notyoutube.com/")).toBe(true);
    });

    it("never lets the page block its unload", () => {
      const { view } = open();
      const event = cancelableEvent({});

      view.webContents.emit("will-prevent-unload", event);

      expect(event.defaultPrevented).toBe(true);
    });

    it("ends the session when the window is closed after login", async () => {
      const { provider, shell, view } = await connected();
      const ended = vi.fn();
      provider.on(TOKIO_EVENTS.MUSIC_PROCCESS_ENDED, ended);

      shell.close();

      expect(provider.isActive()).toBe(false);
      expect(view.webContents.setAudioMuted).toHaveBeenCalledWith(true);
      expect(view.webContents.close).toHaveBeenCalledOnce();
      expect(ended).toHaveBeenCalledOnce();
    });
  });

  describe("disconnect", () => {
    it("mutes and closes the page and the window", async () => {
      const { provider, shell, view } = await connected();
      const ended = vi.fn();
      provider.on(TOKIO_EVENTS.MUSIC_PROCCESS_ENDED, ended);

      provider.disconnect();

      expect(view.webContents.setAudioMuted).toHaveBeenCalledWith(true);
      expect(view.webContents.loadURL).toHaveBeenLastCalledWith("about:blank");
      expect(shell.contentView.removeChildView).toHaveBeenCalledWith(view);
      expect(shell.contentView.children).not.toContain(view);
      expect(view.webContents.close).toHaveBeenCalledOnce();
      expect(shell.isDestroyed()).toBe(true);
      expect(provider.isActive()).toBe(false);
      expect(ended).toHaveBeenCalledOnce();

      provider.disconnect();
      expect(ended).toHaveBeenCalledOnce();
    });

    it("closes a login still open, which fails it", async () => {
      const { provider, pending, shell, view } = open(() => false);

      provider.disconnect();

      expect(shell.isDestroyed()).toBe(true);
      expect(view.webContents.close).toHaveBeenCalledOnce();
      await expect(pending).resolves.toEqual({
        success: false,
        error: new Error("Authentication window was closed by the user"),
      });
    });

    it("does nothing while inactive", () => {
      const provider = new YouTubeMusic();
      const ended = vi.fn();
      provider.on(TOKIO_EVENTS.MUSIC_PROCCESS_ENDED, ended);

      provider.disconnect();

      expect(ended).not.toHaveBeenCalled();
      expect(windows()).toEqual([]);
    });

    it("stops calling a listener removed with off", async () => {
      const { provider } = await connected();
      const ended = vi.fn();
      provider.on(TOKIO_EVENTS.MUSIC_PROCCESS_ENDED, ended);
      provider.off(TOKIO_EVENTS.MUSIC_PROCCESS_ENDED, ended);

      provider.disconnect();

      expect(ended).not.toHaveBeenCalled();
    });
  });

  describe("play", () => {
    it("searches the track, presses Enter and plays the first result", async () => {
      const { provider, view } = await connected();
      const { executeJavaScript, sendInputEvent } = view.webContents;

      const done = provider.play(song("abc123"));
      await vi.advanceTimersByTimeAsync(0);

      expect(executeJavaScript).toHaveBeenLastCalledWith(
        SearchJSCode("abc123"),
      );
      expect(sendInputEvent).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(250);
      await done;

      expect(sendInputEvent.mock.calls).toEqual([
        [{ type: "keyDown", keyCode: "Enter" }],
        [{ type: "char", keyCode: "Enter" }],
        [{ type: "keyUp", keyCode: "Enter" }],
      ]);
      expect(executeJavaScript).toHaveBeenLastCalledWith(AfterSearchJSCode);
    });

    it("does nothing without a page", async () => {
      await expect(new YouTubeMusic().play(song())).resolves.toBeUndefined();
      expect(views()).toEqual([]);
    });
  });

  describe("playerStatus", () => {
    const status: CurrentSongInfo = {
      ...song(),
      playing: true,
      time: 12_000,
    };

    it("returns what the page reports", async () => {
      const { provider, view } = await connected();
      view.webContents.executeJavaScript.mockImplementation(async (code) =>
        code === PlayerStateJSCode ? status : undefined,
      );

      expect(await provider.playerStatus()).toEqual(status);
    });

    it("returns null when the page throws", async () => {
      const { provider, view } = await connected();
      view.webContents.executeJavaScript.mockRejectedValue(
        new Error("navigating"),
      );

      expect(await provider.playerStatus()).toBeNull();
    });

    it("returns null without a page", async () => {
      expect(await new YouTubeMusic().playerStatus()).toBeNull();
    });
  });
});
