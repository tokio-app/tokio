import { songRenderer } from "@test/fixtures";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  confirmLoggedOut,
  getHighResThumbnailUrl,
  parseDurationToSeconds,
  parseSongRenderer,
  PlayerStateJSCode,
  PlayJSCode,
} from "./index";

const INTERVAL = 1500;

const options = (
  overrides: Partial<Parameters<typeof confirmLoggedOut>[1]> = {},
) => ({
  attempts: 3,
  intervalMs: INTERVAL,
  isStale: () => false,
  ...overrides,
});

describe("confirmLoggedOut", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns logged-in on the first attempt without waiting", async () => {
    const check = vi.fn().mockResolvedValue(true);

    const result = await confirmLoggedOut(check, options());

    expect(result).toBe("logged-in");
    expect(check).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("returns logged-in after two intervals when the third check passes", async () => {
    const check = vi
      .fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const done = vi.fn();

    confirmLoggedOut(check, options()).then(done);

    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(INTERVAL - 1);
    expect(check).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(check).toHaveBeenCalledTimes(2);
    expect(done).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(INTERVAL);
    expect(check).toHaveBeenCalledTimes(3);
    expect(done).toHaveBeenCalledWith("logged-in");
  });

  it("returns logged-out once every attempt failed, without a trailing wait", async () => {
    const check = vi.fn().mockResolvedValue(false);
    const done = vi.fn();

    confirmLoggedOut(check, options()).then(done);

    await vi.advanceTimersByTimeAsync(INTERVAL * 2);

    expect(check).toHaveBeenCalledTimes(3);
    expect(done).toHaveBeenCalledWith("logged-out");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("counts a rejected check as a failed attempt", async () => {
    const check = vi
      .fn()
      .mockRejectedValueOnce(new Error("navigating"))
      .mockResolvedValueOnce(true);
    const done = vi.fn();

    confirmLoggedOut(check, options({ attempts: 2 })).then(done);

    await vi.advanceTimersByTimeAsync(INTERVAL);

    expect(check).toHaveBeenCalledTimes(2);
    expect(done).toHaveBeenCalledWith("logged-in");
  });

  it("does not throw when every check rejects", async () => {
    const check = vi.fn().mockRejectedValue(new Error("boom"));
    const done = vi.fn();

    confirmLoggedOut(check, options({ attempts: 2 })).then(done);

    await vi.advanceTimersByTimeAsync(INTERVAL);

    expect(done).toHaveBeenCalledWith("logged-out");
  });

  it("returns stale and stops checking once isStale turns true", async () => {
    let stale = false;
    const check = vi.fn().mockResolvedValue(false);
    const done = vi.fn();

    confirmLoggedOut(check, options({ isStale: () => stale })).then(done);

    await vi.advanceTimersByTimeAsync(0);
    expect(check).toHaveBeenCalledTimes(1);

    stale = true;
    await vi.advanceTimersByTimeAsync(INTERVAL * 5);

    expect(check).toHaveBeenCalledTimes(1);
    expect(done).toHaveBeenCalledWith("stale");
  });
});

// A song row of a search result, as YouTube Music's API sends it
const renderer = songRenderer;

describe("parseSongRenderer", () => {
  it("reads the video, title, duration and thumbnail", () => {
    expect(parseSongRenderer(renderer())).toEqual({
      album: "Unknown",
      track: "dQw4w9WgXcQ",
      title: "Song - Artist",
      thumbnail: "https://lh3.googleusercontent.com/abc=w480-h480-l90-rj",
      duration: 205_000,
    });
  });

  it("takes the duration from the run that looks like a time", () => {
    const song = parseSongRenderer(
      renderer({
        columns: [["Song"], ["Artist", " • ", "1:02:03", " • ", "Album"]],
      }),
    );

    expect(song?.duration).toBe(3_723_000);
  });

  it("gives a duration of 0 without a time", () => {
    const song = parseSongRenderer(
      renderer({ columns: [["Song"], ["Artist", " • ", "Album"]] }),
    );

    expect(song?.duration).toBe(0);
  });

  it("fills missing titles with Unknown", () => {
    expect(parseSongRenderer(renderer({ columns: [] }))?.title).toBe(
      "Unknown - Unknown",
    );
    expect(parseSongRenderer(renderer({ columns: [["Song"]] }))?.title).toBe(
      "Song - Unknown",
    );
  });

  it("returns null without a video id or a renderer", () => {
    expect(parseSongRenderer(renderer({ videoId: "" }))).toBeNull();
    expect(parseSongRenderer({ flexColumns: [] })).toBeNull();
    expect(parseSongRenderer(undefined)).toBeNull();
    expect(parseSongRenderer(null)).toBeNull();
  });
});

describe("parseDurationToSeconds", () => {
  it("reads seconds, minutes and hours", () => {
    expect(parseDurationToSeconds("45")).toBe(45);
    expect(parseDurationToSeconds("3:25")).toBe(205);
    expect(parseDurationToSeconds("1:02:03")).toBe(3723);
    expect(parseDurationToSeconds(" 3:25 ")).toBe(205);
  });

  it("returns 0 for empty or invalid input", () => {
    expect(parseDurationToSeconds(undefined)).toBe(0);
    expect(parseDurationToSeconds("")).toBe(0);
    expect(parseDurationToSeconds("Album")).toBe(0);
    expect(parseDurationToSeconds("3:")).toBe(0);
    expect(parseDurationToSeconds("1.5")).toBe(0);
  });
});

describe("getHighResThumbnailUrl", () => {
  it("replaces the size suffix", () => {
    expect(
      getHighResThumbnailUrl(
        "https://lh3.googleusercontent.com/abc=w120-h120-l90-rj",
      ),
    ).toBe("https://lh3.googleusercontent.com/abc=w480-h480-l90-rj");
    expect(
      getHighResThumbnailUrl("https://lh3.googleusercontent.com/abc=w60-h60"),
    ).toBe("https://lh3.googleusercontent.com/abc=w480-h480-l90-rj");
  });

  it("keeps URLs without a size suffix", () => {
    const url = "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg";

    expect(getHighResThumbnailUrl(url)).toBe(url);
  });

  it("gives an empty string without a URL", () => {
    expect(getHighResThumbnailUrl(undefined)).toBe("");
  });
});

// YouTube Music's page as the scripts see it: its app, which opens a song's
// page on "yt-navigate", and its player
const page = (playing = "", state = 1) => {
  const player = {
    id: playing,
    state,
    getVideoData: () => ({ video_id: player.id }),
    getPlayerState: () => player.state,
    playVideo: vi.fn(() => {
      player.state = 1;
    }),
    seekTo: vi.fn(),
  };
  const location = { search: "" };
  const app = { dispatchEvent: vi.fn<(event: CustomEvent) => void>() };
  const document = {
    querySelector: (selector: string) =>
      ({ "#movie_player": player, "ytmusic-app": app })[selector] ?? null,
  };
  const run = (code: string): Promise<boolean> =>
    runInNewContext(code, {
      document,
      location,
      CustomEvent,
      URLSearchParams,
      setTimeout,
    });
  // What a song's page does once opened
  const opens = (id: string, state: number, search = `?v=${id}`) =>
    app.dispatchEvent.mockImplementation(() => {
      Object.assign(player, { id, state });
      location.search = search;
    });
  return { player, app, run, opens };
};

describe("PlayJSCode", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("opens the song's page and answers once it plays", async () => {
    const id = String.raw`a"b\c`;
    const { app, run, opens } = page("other");
    opens(id, 3);

    const played = run(PlayJSCode(id));
    await vi.advanceTimersByTimeAsync(100);

    expect(await played).toBe(true);
    const [event] = app.dispatchEvent.mock.lastCall!;
    expect(event.type).toBe("yt-navigate");
    expect(event.bubbles && event.composed).toBe(true);
    expect(event.detail).toEqual({
      endpoint: { watchEndpoint: { videoId: id } },
    });
  });

  it("starts a song its page opened paused", async () => {
    const { player, run, opens } = page();
    opens("abc", -1);

    const played = run(PlayJSCode("abc"));
    await vi.advanceTimersByTimeAsync(200);

    expect(await played).toBe(true);
    expect(player.playVideo).toHaveBeenCalledOnce();
  });

  it("plays the same song again from its start", async () => {
    const { player, app, run } = page("abc", 2);

    expect(await run(PlayJSCode("abc"))).toBe(true);
    expect(player.seekTo).toHaveBeenCalledWith(0, true);
    expect(player.playVideo).toHaveBeenCalledOnce();
    expect(app.dispatchEvent).not.toHaveBeenCalled();
  });

  it.each([
    ["its page is open, like during an ad", "?v=abc", true],
    ["its page never opens", "", false],
  ])(
    "answers after 5 s without the player when %s",
    async (_case, search, answer) => {
      const { run, opens } = page("other");
      opens("ad", 1, search);

      const played = run(PlayJSCode("abc"));
      await vi.advanceTimersByTimeAsync(4_900);
      let done = false;
      played.then(() => (done = true));
      await vi.advanceTimersByTimeAsync(0);
      expect(done).toBe(false);
      await vi.advanceTimersByTimeAsync(100);

      expect(await played).toBe(answer);
    },
  );
});

describe("PlayerStateJSCode", () => {
  it("reads the song's own time and length, not the next song's", () => {
    const player = {
      getVideoData: () => ({ video_id: "abc" }),
      getPlayerState: () => 3,
      getCurrentTime: () => 44.5,
      // The next song's once YouTube loads it ahead
      getDuration: () => 199,
      getPlayerResponse: () => ({
        streamingData: {
          adaptiveFormats: [
            { mimeType: 'video/mp4; codecs="avc1"', approxDurationMs: "45181" },
            {
              mimeType: 'audio/webm; codecs="opus"',
              approxDurationMs: "45160",
            },
          ],
        },
      }),
    };
    const document = {
      querySelector: (selector: string) =>
        selector === "#movie_player" ? player : null,
    };

    const status = runInNewContext(PlayerStateJSCode, { document });

    expect({ ...status }).toMatchObject({
      track: "abc",
      time: 44_500,
      duration: 45_160,
      playing: true,
    });
  });

  it("answers null before the player exists", () => {
    const document = { querySelector: () => null };

    expect(runInNewContext(PlayerStateJSCode, { document })).toBeNull();
  });
});
