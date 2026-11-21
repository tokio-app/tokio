import { fakeYouTube, type FakeYouTube } from "@test/youtube";
import { beforeEach, describe, expect, it } from "vitest";
import defaults from "../config";
import {
  embedded,
  findLive,
  parseInput,
  pollChat,
  pollViewers,
  readChat,
} from "./page";

describe("parseInput", () => {
  it("reads bare text as a handle, an 11-character one too", () => {
    expect(parseInput("madeup")).toEqual({ path: "/@madeup" });
    expect(parseInput("@madeup")).toEqual({ path: "/@madeup" });
    expect(parseInput("abcdefghijk")).toEqual({ path: "/@abcdefghijk" });
    expect(parseInput("  ")).toBeNull();
  });

  it("reads a channel's links", () => {
    for (const link of [
      "https://www.youtube.com/@madeup",
      "https://www.youtube.com/@madeup/live",
      "youtube.com/@madeup/streams",
      "https://m.youtube.com/@madeup",
    ]) {
      expect(parseInput(link)).toEqual({ path: "/@madeup" });
    }
    expect(parseInput("https://www.youtube.com/channel/UCmadeup")).toEqual({
      path: "/channel/UCmadeup",
    });
  });

  it("reads a LIVE's links", () => {
    for (const link of [
      "https://www.youtube.com/watch?v=abcdefghijk",
      "https://www.youtube.com/watch?v=abcdefghijk&t=10s",
      "https://youtu.be/abcdefghijk",
      "https://www.youtube.com/live/abcdefghijk?si=x",
    ]) {
      expect(parseInput(link)).toEqual({ videoId: "abcdefghijk" });
    }
  });

  it("refuses a link that names neither", () => {
    expect(parseInput("https://www.youtube.com/watch?v=short")).toBeNull();
    expect(parseInput("https://www.youtube.com/feed/trending")).toBeNull();
  });
});

describe("embedded", () => {
  it("reads to where the braces balance, strings aside", () => {
    const html = 'var a = {"b":{"c":"} {\\" }"},"d":1};var e = {};';
    expect(embedded(html, "var a = ")).toEqual({
      b: { c: '} {" }' },
      d: 1,
    });
    expect(embedded(html, "var x = ")).toBeNull();
  });
});

describe("the pages", () => {
  let youtube: FakeYouTube;
  let config: typeof defaults;

  beforeEach(() => {
    youtube = fakeYouTube();
    config = { ...defaults, fetch: youtube.fetch };
  });

  it("finds a channel's LIVE, in English with the consent answered", async () => {
    youtube.state.channels["/@madeup"] = {
      videoId: "live1234567",
      author: "Made Up",
    };

    expect(await findLive(config, { path: "/@madeup" })).toEqual({
      videoId: "live1234567",
      author: "Made Up",
    });
    expect(youtube.state.urls[0]).toBe(
      "https://www.youtube.com/@madeup/live?hl=en&gl=US",
    );
    expect(youtube.state.headers[0]).toMatchObject({
      cookie: "SOCS=CAI",
      "accept-language": "en-US,en;q=0.9",
      "user-agent": expect.stringContaining("Chrome/"),
    });
  });

  it("finds a LIVE by its video", async () => {
    youtube.state.videos.live1234567 = "Made Up";

    expect(await findLive(config, { videoId: "live1234567" })).toEqual({
      videoId: "live1234567",
      author: "Made Up",
    });
    expect(youtube.state.urls[0]).toBe(
      "https://www.youtube.com/watch?v=live1234567&hl=en&gl=US",
    );
  });

  it("tells offline, upcoming, a channel or video not found and a rate limit", async () => {
    const kind = (promise: Promise<unknown>) =>
      promise.then(
        () => "found",
        (err) => err.kind,
      );
    youtube.state.channels["/@away"] = "offline";
    youtube.state.channels["/@soon"] = "upcoming";

    expect(await kind(findLive(config, { path: "/@away" }))).toBe("offline");
    expect(await kind(findLive(config, { path: "/@soon" }))).toBe("offline");
    expect(await kind(findLive(config, { path: "/@nobody" }))).toBe("notFound");
    expect(await kind(findLive(config, { videoId: "gone1234567" }))).toBe(
      "notFound",
    );

    youtube.state.override = () => new Response("", { status: 429 });
    expect(await kind(findLive(config, { path: "/@away" }))).toBe(
      "rateLimited",
    );
    const sorry = new Response("");
    Object.defineProperty(sorry, "url", {
      value: "https://www.google.com/sorry/index?continue=x",
    });
    youtube.state.override = () => sorry;
    expect(await kind(findLive(config, { path: "/@away" }))).toBe(
      "rateLimited",
    );

    youtube.state.override = () => {
      throw new TypeError("fetch failed");
    };
    expect(await kind(findLive(config, { path: "/@away" }))).toBe("network");
  });

  it("takes Live chat's continuation over Top chat's", async () => {
    expect(await readChat(config, "live1234567")).toEqual({
      key: "key-1",
      context: {
        client: {
          clientName: "WEB",
          clientVersion: "2.0",
          hl: "en",
          gl: "US",
          visitorData: "visitor-1",
        },
      },
      continuation: "live-0",
    });
    expect(youtube.state.urls[0]).toBe(
      "https://www.youtube.com/live_chat?is_popout=1&v=live1234567&hl=en&gl=US",
    );

    // Another title: the one that isn't selected
    youtube.state.menu[1].title = "Todo el chat";
    expect((await readChat(config, "live1234567")).continuation).toBe("live-0");
  });

  it("tells a LIVE with its chat off", async () => {
    youtube.state.chatOff = true;

    await expect(readChat(config, "live1234567")).rejects.toMatchObject({
      kind: "noChat",
    });
  });

  it("polls the chat until it ends", async () => {
    const chat = await readChat(config, "live1234567");
    youtube.state.polls = [{ actions: [{ a: 1 }] }, "ended"];

    expect(await pollChat(config, chat, "live-0")).toEqual({
      actions: [{ a: 1 }],
      continuation: "next-1",
      timeoutMs: 5,
    });
    expect(youtube.state.urls.at(-1)).toBe(
      "https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?prettyPrint=false&key=key-1",
    );
    expect(await pollChat(config, chat, "next-1")).toBeNull();

    youtube.state.polls = [403];
    await expect(pollChat(config, chat, "next-1")).rejects.toMatchObject({
      kind: "unknown",
      status: 403,
    });
  });

  it("reads the viewers, and the end once the count is the video's views", async () => {
    const chat = await readChat(config, "live1234567");
    youtube.state.viewers = [264, "ended"];

    expect(await pollViewers(config, chat, "live1234567")).toBe(264);
    expect(await pollViewers(config, chat, "live1234567")).toBe("ended");
  });
});
