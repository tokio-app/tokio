import { songRenderer } from "@test/fixtures";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  confirmLoggedOut,
  getHighResThumbnailUrl,
  parseDurationToSeconds,
  parseSongRenderer,
  SearchJSCode,
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

describe("SearchJSCode", () => {
  it("types any title as it is, quotes and backslashes too", () => {
    const title = String.raw`"Heroes" (2017 Remaster) \ "); alert(1); ("`;
    const input = { value: "", focus() {}, dispatchEvent() {} };
    const document = {
      querySelector: (selector: string) =>
        selector.endsWith("input") ? input : null,
    };

    runInNewContext(SearchJSCode(title), { document, Event });

    expect(input.value).toBe(title);
  });
});
