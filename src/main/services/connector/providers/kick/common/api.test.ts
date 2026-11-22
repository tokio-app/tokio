import { describe, expect, it, vi } from "vitest";
import defaults, { type FetchInit } from "../config";
import { guestToken, lookup, parseInput, realtime } from "./api";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status });

// A made-up channel in the shape kick.com's API answers
const CHANNEL = {
  id: 10,
  user_id: 11,
  slug: "streamer",
  chatroom: { id: 20, chatable_id: 10 },
  livestream: { id: 30, viewer_count: 1234 },
  user: { username: "Streamer", profile_pic: "https://files.kick.com/p.webp" },
};

const kick = (answer: (url: string) => Response | Promise<Response>) => {
  const fetch = vi.fn(async (url: string, _init: FetchInit) => answer(url));
  return {
    fetch,
    config: { ...defaults, USER_AGENT: "Tokio/9.9.9", fetch },
  };
};

describe("Kick's API", () => {
  it("reads a slug or a kick.com link, nothing else", () => {
    expect(parseInput("Streamer")).toBe("streamer");
    expect(parseInput(" some_one-2 ")).toBe("some_one-2");
    expect(parseInput("kick.com/streamer")).toBe("streamer");
    expect(parseInput("https://www.kick.com/Streamer/")).toBe("streamer");
    expect(parseInput("http://kick.com/streamer?clip=1")).toBe("streamer");
    expect(parseInput("")).toBeNull();
    expect(parseInput("kick.com")).toBeNull();
    expect(parseInput("two words")).toBeNull();
    expect(parseInput("https://twitch.tv/streamer")).toBeNull();
  });

  it("looks the channel up with Tokio's own user agent", async () => {
    const { fetch, config } = kick(() => json(200, CHANNEL));

    expect(await lookup(config, "streamer")).toEqual({
      slug: "streamer",
      name: "Streamer",
      channelId: 10,
      chatroomId: 20,
      viewers: 1234,
    });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://kick.com/api/v2/channels/streamer");
    expect(init.headers?.["user-agent"]).toBe("Tokio/9.9.9");
    expect(init.headers?.["user-agent"]).not.toMatch(/Mozilla|Chrome/);
  });

  it("ships an honest user agent", () => {
    expect(defaults.USER_AGENT).toMatch(/^Tokio\/\S+$/);
  });

  it("reads an offline channel", async () => {
    const { config } = kick(() => json(200, { ...CHANNEL, livestream: null }));

    expect((await lookup(config, "streamer")).viewers).toBeNull();
  });

  it("tells a missing channel, Kick's refusal and a network failure", async () => {
    const kindFor = async (answer: () => Response | Promise<Response>) =>
      lookup(kick(answer).config, "streamer").catch(
        (err: { kind: string }) => err.kind,
      );

    expect(await kindFor(() => json(404, {}))).toBe("notFound");
    expect(
      await kindFor(() =>
        json(403, { error: "Request blocked by security policy." }),
      ),
    ).toBe("rateLimited");
    expect(await kindFor(() => json(429, {}))).toBe("rateLimited");
    expect(await kindFor(() => json(503, {}))).toBe("network");
    expect(
      await kindFor(() => Promise.reject(new TypeError("fetch failed"))),
    ).toBe("network");
  });

  it("gets the chat server and a guest token for one client", async () => {
    const { fetch, config } = kick((url) =>
      url.endsWith("/connection") && !url.includes("/auth/")
        ? json(200, {
            data: {
              connections: [
                {
                  provider: "centrifugo",
                  credentials: { url: "wss://realtime.example/ws" },
                },
              ],
            },
          })
        : json(200, { data: { token: "jwt" } }),
    );

    expect(await realtime(config, "client-1")).toBe(
      "wss://realtime.example/ws",
    );
    expect(await guestToken(config, "client-1")).toBe("jwt");
    expect(
      fetch.mock.calls.map(([url, init]) => [
        url,
        init.method,
        JSON.parse(init.body ?? ""),
      ]),
    ).toEqual([
      [
        "https://web.kick.com/api/v1/realtime/connection",
        "POST",
        {
          client: { id: "client-1", type: "web" },
          capabilities: { accepted_providers: [{ provider: "centrifugo" }] },
        },
      ],
      [
        "https://web.kick.com/api/v1/realtime/auth/connection",
        "POST",
        { client_id: "client-1" },
      ],
    ]);
    for (const [, init] of fetch.mock.calls) {
      expect(init.headers?.["user-agent"]).toBe("Tokio/9.9.9");
    }
  });
});
