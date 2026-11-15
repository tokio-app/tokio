import { CurrentSongInfo, SongInfo, TOKIO_EVENTS } from "@/common/types";
import type { ElectronBlocker } from "@tokioapp/adblock";
import {
  cancelableEvent,
  FakeWebContentsView,
  views,
  windows,
} from "@test/electron";
import { songRenderer } from "@test/fixtures";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ConnectOptions } from "../../common";
import { PlayerStateJSCode, PlayJSCode } from "./common";
import config from "./config";
import { YouTubeMusic } from "./index";

const PARTITION = "persist:music-youtube";
// What the window closing before YouTube Music loads fails with
const CLOSED = new Error("The window was closed before YouTube Music loaded");

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

const loads = (view: FakeWebContentsView, url: string) =>
  view.webContents.loadURL.mock.calls.filter(([u]) => u === url).length;

/**
 * Starts connect(). The page reports a load, of the address it loaded last,
 * only when the test emits "did-finish-load".
 */
const open = (provider = new YouTubeMusic(), options?: ConnectOptions) => {
  const pending = provider.connect(options);
  const shell = windows().at(-1)!;
  const view = ytView();
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
      expect(init?.signal).toBeInstanceOf(AbortSignal);
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

    // So the request is reported, not taken for a song that wasn't found
    it("throws when the request fails", async () => {
      stubFetch(() =>
        json(searchResults([shelf(songRow("first", "Song", "Artist"))]), 500),
      );
      await expect(new YouTubeMusic().searchSong("song")).rejects.toThrow(
        "InnerTube API request failed with status: 500",
      );

      stubFetch(() => Promise.reject(new Error("offline")));
      await expect(new YouTubeMusic().searchSong("song")).rejects.toThrow(
        "offline",
      );
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
      // YouTube's page never gets the bridge
      expect(view.options.webPreferences?.preload).toBeUndefined();
      expect(view.options.webPreferences?.nodeIntegration).not.toBe(true);
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

    it("connects once YouTube Music loads, signed in or not", async () => {
      const { provider, pending, view, finishLoad } = open();

      finishLoad();

      await expect(pending).resolves.toEqual({ success: true });
      expect(provider.isActive()).toBe(true);
      // No account check, no sign-in page and no cleared session
      expect(view.webContents.executeJavaScript).not.toHaveBeenCalled();
      expect(view.webContents.loadURL).toHaveBeenCalledExactlyOnceWith(
        config.YTM_URL,
      );
      expect(view.webContents.session.clearStorageData).not.toHaveBeenCalled();
    });

    it("resolves right away while active", async () => {
      const { provider } = await connected();

      await expect(provider.connect()).resolves.toEqual({ success: true });
      expect(windows()).toHaveLength(1);
    });

    it("waits for YouTube Music when another page loads first", async () => {
      const done = vi.fn();
      const { pending, view, finishLoad } = open();
      pending.then(done);

      // Google's sign-in, or a consent page
      for (const url of [
        "https://accounts.google.com/ServiceLogin",
        "https://consent.youtube.com/m?continue=https://music.youtube.com/",
      ]) {
        await view.webContents.loadURL(url);
        finishLoad();
      }
      await vi.advanceTimersByTimeAsync(0);
      expect(done).not.toHaveBeenCalled();

      await view.webContents.loadURL(`${config.YTM_URL}/`);
      finishLoad();

      await expect(pending).resolves.toEqual({ success: true });
    });

    it("stays connected while the streamer signs in from the page", async () => {
      const { provider, view, finishLoad } = await connected();
      const ended = vi.fn();
      provider.on(TOKIO_EVENTS.MUSIC_PROCCESS_ENDED, ended);

      await view.webContents.loadURL("https://accounts.google.com/signin");
      finishLoad();
      await view.webContents.loadURL(config.YTM_URL);
      finishLoad();

      expect(provider.isActive()).toBe(true);
      expect(ended).not.toHaveBeenCalled();
      expect(windows().filter((w) => !w.isDestroyed())).toHaveLength(1);
    });

    it("closes a connect still waiting when it connects again", async () => {
      const first = open();

      const second = open(first.provider);

      await expect(first.pending).resolves.toEqual({
        success: false,
        error: CLOSED,
      });
      expect(first.shell.isDestroyed()).toBe(true);
      expect(first.view.webContents.close).toHaveBeenCalledOnce();

      second.finishLoad();
      await expect(second.pending).resolves.toEqual({ success: true });
      expect(windows().filter((w) => !w.isDestroyed())).toEqual([second.shell]);
    });

    it("fails when the window is closed before YouTube Music loads", async () => {
      const { provider, pending, shell, view } = open();

      shell.close();

      await expect(pending).resolves.toEqual({ success: false, error: CLOSED });
      expect(provider.isActive()).toBe(false);
      expect(view.webContents.close).toHaveBeenCalledOnce();
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

    it("ends the session when the window is closed after it connected", async () => {
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

  describe("blocking ads", () => {
    // What connect calls on the blocker, which needs Electron's session
    const blocker = () => {
      const fake = { enable: vi.fn() };
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion
      return { fake, blocker: fake as unknown as ElectronBlocker };
    };

    // The blocker the provider's next ready() gives, once `finish` is called
    const stubReady = (provider: YouTubeMusic) => {
      let finish: (result: ElectronBlocker | Error) => void = () => {};
      vi.spyOn(provider.adBlocker, "ready").mockReturnValue(
        new Promise((resolve, reject) => {
          finish = (result) =>
            result instanceof Error ? reject(result) : resolve(result);
        }),
      );
      return (result: ElectronBlocker | Error) => finish(result);
    };

    it("blocks ads in the page's session before the page loads", async () => {
      const { fake, blocker: ready } = blocker();
      const provider = new YouTubeMusic();
      const finish = stubReady(provider);
      const { pending, view, finishLoad } = open(provider, {
        blockAds: true,
      });
      expect(loads(view, config.YTM_URL)).toBe(0);

      finish(ready);
      await vi.advanceTimersByTimeAsync(0);

      expect(fake.enable).toHaveBeenCalledExactlyOnceWith(
        view.webContents.session,
      );
      expect(loads(view, config.YTM_URL)).toBe(1);
      expect(fake.enable.mock.invocationCallOrder[0]).toBeLessThan(
        view.webContents.loadURL.mock.invocationCallOrder[0],
      );
      finishLoad();
      await expect(pending).resolves.toEqual({ success: true });
    });

    it("stops blocking and frees the blocker when it connects without it", () => {
      const provider = new YouTubeMusic();
      const dispose = vi.spyOn(provider.adBlocker, "dispose");

      const { view } = open(provider);

      expect(dispose).toHaveBeenCalledOnce();
      expect(dispose.mock.invocationCallOrder[0]).toBeLessThan(
        view.webContents.loadURL.mock.invocationCallOrder[0],
      );
    });

    it("loads the page with its ads when the session refuses the blocker", async () => {
      const { fake, blocker: ready } = blocker();
      const error = new Error("The scheme is taken");
      fake.enable.mockImplementation(() => {
        throw error;
      });
      const provider = new YouTubeMusic();
      stubReady(provider)(ready);
      const { pending, view, finishLoad } = open(provider, {
        blockAds: true,
      });
      await vi.advanceTimersByTimeAsync(0);

      expect(loads(view, config.YTM_URL)).toBe(1);
      finishLoad();
      await expect(pending).resolves.toEqual({
        success: true,
        adblockError: error,
      });
    });

    it("loads the page with its ads when the blocker fails, and says why", async () => {
      const provider = new YouTubeMusic();
      const error = new Error("offline");
      stubReady(provider)(error);
      const { pending, view, finishLoad } = open(provider, {
        blockAds: true,
      });
      await vi.advanceTimersByTimeAsync(0);

      expect(loads(view, config.YTM_URL)).toBe(1);
      finishLoad();
      await expect(pending).resolves.toEqual({
        success: true,
        adblockError: error,
      });
    });

    it("leaves a page closed while the blocker loads alone", async () => {
      const { fake, blocker: ready } = blocker();
      const provider = new YouTubeMusic();
      const finish = stubReady(provider);
      const { pending, shell, view } = open(provider, {
        blockAds: true,
      });

      shell.close();
      finish(ready);
      await vi.advanceTimersByTimeAsync(0);

      await expect(pending).resolves.toMatchObject({ success: false });
      expect(fake.enable).not.toHaveBeenCalled();
      expect(loads(view, config.YTM_URL)).toBe(0);
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

    it("closes a connect still waiting, which fails it", async () => {
      const { provider, pending, shell, view } = open();

      provider.disconnect();

      expect(shell.isDestroyed()).toBe(true);
      expect(view.webContents.close).toHaveBeenCalledOnce();
      await expect(pending).resolves.toEqual({ success: false, error: CLOSED });
    });

    it("leaves the next session alone when an older window closes late", async () => {
      const first = open();
      // Its "close" comes only when the test emits it
      first.shell.close.mockImplementation(() => {});
      const second = open(first.provider);
      second.finishLoad();
      await expect(second.pending).resolves.toEqual({ success: true });
      const ended = vi.fn();
      first.provider.on(TOKIO_EVENTS.MUSIC_PROCCESS_ENDED, ended);

      first.shell.emit("close", cancelableEvent({}));

      expect(first.view.webContents.close).toHaveBeenCalledOnce();
      expect(second.view.webContents.close).not.toHaveBeenCalled();
      expect(second.view.webContents.setAudioMuted).not.toHaveBeenCalled();
      expect(first.provider.isActive()).toBe(true);
      expect(ended).not.toHaveBeenCalled();
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
    it("starts the song by its video id", async () => {
      const { provider, view } = await connected();
      const { executeJavaScript } = view.webContents;
      executeJavaScript.mockResolvedValue(true);

      await provider.play(song("abc123"));

      expect(executeJavaScript).toHaveBeenLastCalledWith(PlayJSCode("abc123"));
    });

    it("fails when the player never got the song", async () => {
      const { provider, view } = await connected();
      view.webContents.executeJavaScript.mockResolvedValue(false);

      await expect(provider.play(song("abc123"))).rejects.toThrow(
        "Nothing to play for abc123 on YouTube Music.",
      );
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
