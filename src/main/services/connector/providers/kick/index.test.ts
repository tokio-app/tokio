import { TOKIO_EVENTS } from "@/common/types";
import Logger from "@/logger";
import { once } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import type { ReconnectState } from "../../common";
import type { FetchInit } from "./config";
import { KickConnector } from "./index";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status });

// Stands in for Kick: its API through an injected fetch, its Centrifugo
// server on a local socket. A made-up channel.
const kick = {
  viewers: null as number | null,
  sockets: [] as { ws: WebSocket; got: any[] }[],
  // The client id of each realtime request
  clients: [] as string[],
  urls: [] as string[],
  // Answers a request instead, until it gives undefined
  override: undefined as ((url: string) => Response | undefined) | undefined,
};

const socket = () => kick.sockets[kick.sockets.length - 1];

const publish = (feed: string, event: string, data: unknown) =>
  socket().ws.send(
    JSON.stringify({
      push: {
        channel: feed,
        pub: { data: { event, data: JSON.stringify(data) } },
      },
    }),
  );

describe("KickConnector", () => {
  let server: WebSocketServer;
  let port: number;
  let connector: KickConnector;
  let states: ReconnectState[];

  const capture = (event: TOKIO_EVENTS) => {
    const listener = vi.fn();
    connector.on(event, listener);
    return listener;
  };

  beforeEach(async () => {
    Object.assign(kick, {
      viewers: null,
      sockets: [],
      clients: [],
      urls: [],
      override: undefined,
    });
    server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await once(server, "listening");
    const address = server.address();
    port = typeof address === "object" && address ? address.port : 0;
    server.on("connection", (ws) => {
      const entry: (typeof kick.sockets)[number] = { ws, got: [] };
      kick.sockets.push(entry);
      ws.on("message", (raw: Buffer) => {
        const command = JSON.parse(raw.toString());
        entry.got.push(command);
        if (command.connect) {
          ws.send(
            JSON.stringify({
              id: command.id,
              connect: { ttl: 2700, ping: 25 },
            }),
          );
        } else if (command.subscribe) {
          ws.send(JSON.stringify({ id: command.id, subscribe: {} }));
        }
      });
    });

    const fetch = vi.fn(async (url: string, init: FetchInit) => {
      kick.urls.push(url);
      const answer = kick.override?.(url);
      if (answer) return answer;
      if (url.endsWith("/channels/streamer")) {
        return json(200, {
          id: 10,
          slug: "streamer",
          chatroom: { id: 20 },
          livestream:
            kick.viewers === null
              ? null
              : { id: 30, viewer_count: kick.viewers },
          user: { username: "Streamer" },
        });
      }
      if (url.endsWith("/realtime/connection")) {
        kick.clients.push(JSON.parse(init.body ?? "{}").client.id);
        return json(200, {
          data: {
            connections: [
              {
                provider: "centrifugo",
                credentials: { url: `ws://127.0.0.1:${port}/connection` },
              },
            ],
          },
        });
      }
      if (url.endsWith("/auth/connection")) {
        return json(200, { data: { token: "guest-token" } });
      }
      return json(404, {});
    });

    connector = new KickConnector({
      fetch,
      USER_AGENT: "Tokio/test",
      CONNECT_RETRY_MS: 10,
      RECONNECT_MIN_MS: 10,
      RECONNECT_MAX_MS: 40,
      TERMINAL_MIN_MS: 60,
      TERMINAL_MAX_MS: 120,
      VIEWERS_MS: 50,
    });
    states = [];
    connector.onReconnect((state) => states.push(state));
  });

  afterEach(async () => {
    await connector.disconnect();
    for (const ws of server.clients) ws.terminate();
    await new Promise((resolve) => server.close(resolve));
  });

  describe("connect", () => {
    it("joins the chat's four feeds, then connects, live with its viewers", async () => {
      kick.viewers = 120;
      const info = vi.spyOn(Logger, "info");
      const onConnected = capture(TOKIO_EVENTS.CONNECTED);
      const onRoom = capture(TOKIO_EVENTS.ROOM_USER);

      const connecting = connector.connect("https://kick.com/Streamer");
      expect(connector.connect("streamer")).toBe(connecting);
      expect(await connecting).toEqual({ success: true });

      expect(onConnected).toHaveBeenCalledOnce();
      expect(connector.isConnected()).toBe(true);
      expect(
        socket().got.map((c) => c.subscribe?.channel ?? "connect"),
      ).toEqual([
        "connect",
        "chatrooms.20.v2",
        "chatroom_20",
        "channel.10",
        "channel_10",
      ]);
      expect(onRoom).toHaveBeenCalledWith({
        ranks: [],
        viewers: 120,
        views: 0,
      });
      expect(info).toHaveBeenCalledWith(
        "<Kick> Connected to @streamer, live.",
        expect.anything(),
      );

      kick.viewers = 130;
      await vi.waitFor(() =>
        expect(onRoom).toHaveBeenCalledWith({
          ranks: [],
          viewers: 130,
          views: 0,
        }),
      );
    });

    it("refuses what names no channel without asking Kick", async () => {
      expect((await connector.connect("two words")).error?.kind).toBe(
        "notFound",
      );
      expect(kick.urls).toEqual([]);
      expect((await connector.connect("nobody")).error?.kind).toBe("notFound");
      expect(connector.isConnected()).toBe(false);
    });

    it("tries a network failure again", async () => {
      let failures = 2;
      kick.override = (url) => {
        if (url.endsWith("/auth/connection") && failures-- > 0) {
          throw new TypeError("fetch failed");
        }
        return undefined;
      };

      expect(await connector.connect("streamer")).toEqual({ success: true });
      expect(
        kick.urls.filter((u) => u.endsWith("/channels/streamer")),
      ).toHaveLength(3);
    });

    it("gives up on the network after its tries", async () => {
      kick.override = () => {
        throw new TypeError("fetch failed");
      };

      expect((await connector.connect("streamer")).error?.kind).toBe("network");
      expect(kick.urls).toHaveLength(3);
      expect(connector.isConnected()).toBe(false);
    });

    it("opens no socket for a connect a Disconnect stopped, and calls it canceled", async () => {
      const onConnected = capture(TOKIO_EVENTS.CONNECTED);
      // The tab's Disconnect while the lookup is out
      kick.override = (url) => {
        if (url.endsWith("/channels/streamer")) void connector.disconnect();
        return undefined;
      };

      expect(await connector.connect("streamer")).toMatchObject({
        success: false,
        error: { kind: "canceled" },
      });
      await new Promise((r) => setTimeout(r, 50));
      expect(kick.sockets).toHaveLength(0);
      expect(onConnected).not.toHaveBeenCalled();
      expect(connector.isConnected()).toBe(false);
    });

    it("calls a connect stopped while it waits to try again canceled", async () => {
      kick.override = (url) => {
        if (!url.endsWith("/auth/connection")) return undefined;
        setTimeout(() => void connector.disconnect(), 0);
        throw new TypeError("fetch failed");
      };

      expect((await connector.connect("streamer")).error?.kind).toBe(
        "canceled",
      );
      expect(
        kick.urls.filter((u) => u.endsWith("/channels/streamer")),
      ).toHaveLength(1);
    });
  });

  describe("events", () => {
    it("sends chat through emitChat, and logs only the event's name", async () => {
      const debug = vi.spyOn(Logger, "debug");
      const stage = vi.fn(() => null);
      connector.setChatStage(stage);
      const onChat = capture(TOKIO_EVENTS.CHAT);
      const onKicks = capture(TOKIO_EVENTS.KICKS);
      await connector.connect("streamer");

      publish("chatrooms.20.v2", "App\\Events\\ChatMessageEvent", {
        content: "secret words",
        sender: { id: 5, username: "Viewer", slug: "viewer" },
      });
      publish("channel_10", "KicksGifted", {
        sender: { id: 5, username: "Viewer" },
        gift: { gift_id: "hype", name: "Hype", amount: 50 },
      });

      await vi.waitFor(() => expect(onKicks).toHaveBeenCalled());
      expect(stage).toHaveBeenCalledOnce();
      expect(onChat.mock.calls[0][0].comment.content).toBe("secret words");
      expect(onKicks.mock.calls[0][0]).toMatchObject({ kicks: 50 });
      expect(debug).toHaveBeenCalledWith(
        "<Kick> Feed App\\Events\\ChatMessageEvent",
        expect.anything(),
      );
      expect(JSON.stringify(debug.mock.calls)).not.toContain("secret words");
    });

    it("sends gifted subs under their gifter's id, from chat, a lookup or its cache", async () => {
      const warn = vi.spyOn(Logger, "warn");
      const onGiftSub = capture(TOKIO_EVENTS.GIFT_SUB);
      kick.override = (url) => {
        if (url.endsWith("/channels/new-gifter")) {
          return json(200, {
            id: 70,
            user_id: 71,
            slug: "new-gifter",
            chatroom: { id: 72 },
          });
        }
        return url.endsWith("/channels/gone") ? json(404, {}) : undefined;
      };
      await connector.connect("streamer");
      const gifted = (gifter_username: string) =>
        publish("chatroom_20", "App\\Events\\GiftedSubscriptionsEvent", {
          gifter_username,
          gifted_usernames: ["a", "b"],
        });
      const ids = () =>
        onGiftSub.mock.calls.map(([e]) => [e.user.username, e.user.userId]);

      // Known from chat, in any case: no lookup
      publish("chatrooms.20.v2", "App\\Events\\ChatMessageEvent", {
        content: "hi",
        sender: { id: 5, username: "Viewer", slug: "viewer" },
      });
      gifted("viewer");
      await vi.waitFor(() => expect(onGiftSub).toHaveBeenCalledTimes(1));
      // Looked up once by its slug, then from the cache
      gifted("New_Gifter");
      gifted("new_gifter");
      await vi.waitFor(() => expect(onGiftSub).toHaveBeenCalledTimes(3));
      // A failed lookup sends it without one, logged once
      gifted("gone");
      gifted("Gone");
      await vi.waitFor(() => expect(onGiftSub).toHaveBeenCalledTimes(5));

      expect(ids()).toEqual([
        ["viewer", "kick:5"],
        ["New_Gifter", "kick:71"],
        ["new_gifter", "kick:71"],
        ["gone", undefined],
        ["Gone", undefined],
      ]);
      expect(onGiftSub.mock.calls[1][0].count).toBe(2);
      const lookups = (slug: string) =>
        kick.urls.filter((url) => url.endsWith(`/channels/${slug}`)).length;
      expect(lookups("viewer")).toBe(0);
      expect(lookups("new-gifter")).toBe(1);
      expect(lookups("gone")).toBe(1);
      expect(
        warn.mock.calls.filter(([m]) => m.includes("id of a viewer")),
      ).toHaveLength(1);
    });

    it("sends a sub under the viewer's id, from chat or a lookup", async () => {
      const onSub = capture(TOKIO_EVENTS.SUBSCRIBE);
      kick.override = (url) => {
        if (url.endsWith("/channels/new-sub")) {
          return json(200, {
            id: 80,
            user_id: 81,
            slug: "new-sub",
            chatroom: { id: 82 },
          });
        }
        return url.endsWith("/channels/gone") ? json(404, {}) : undefined;
      };
      await connector.connect("streamer");
      const subscribed = (username: string) =>
        publish("chatrooms.20.v2", "App\\Events\\SubscriptionEvent", {
          username,
          months: 4,
        });

      publish("chatrooms.20.v2", "App\\Events\\ChatMessageEvent", {
        content: "hi",
        sender: { id: 5, username: "Viewer", slug: "viewer" },
      });
      subscribed("Viewer");
      await vi.waitFor(() => expect(onSub).toHaveBeenCalledTimes(1));
      subscribed("New_Sub");
      await vi.waitFor(() => expect(onSub).toHaveBeenCalledTimes(2));
      subscribed("gone");
      await vi.waitFor(() => expect(onSub).toHaveBeenCalledTimes(3));

      expect(
        onSub.mock.calls.map(([e]) => [e.user.username, e.user.userId]),
      ).toEqual([
        ["Viewer", "kick:5"],
        ["New_Sub", "kick:81"],
        ["gone", undefined],
      ]);
      expect(onSub.mock.calls[1][0].months).toBe(4);
    });

    it("drops an event whose shape changed and keeps reading", async () => {
      const warn = vi.spyOn(Logger, "warn");
      const onSub = capture(TOKIO_EVENTS.SUBSCRIBE);
      const onChat = capture(TOKIO_EVENTS.CHAT);
      await connector.connect("streamer");

      // No username, which a subscription always had
      publish("chatrooms.20.v2", "App\\Events\\SubscriptionEvent", {
        months: 3,
      });
      publish("chatrooms.20.v2", "App\\Events\\ChatMessageEvent", {
        content: "still here",
        sender: { id: 5, username: "Viewer", slug: "viewer" },
      });

      await vi.waitFor(() => expect(onChat).toHaveBeenCalled());
      expect(onSub).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("Couldn't read a SubscriptionEvent"),
        expect.anything(),
      );
    });

    it("stays connected to an offline channel until a stream it saw ends", async () => {
      const onDisconnected = capture(TOKIO_EVENTS.DISCONNECTED);
      await connector.connect("streamer");

      publish("channel.10", "App\\Events\\StopStreamBroadcast", {
        livestream: { id: 30 },
      });
      await new Promise((r) => setTimeout(r, 50));
      expect(onDisconnected).not.toHaveBeenCalled();
      expect(connector.isConnected()).toBe(true);

      publish("channel.10", "App\\Events\\StreamerIsLive", {
        livestream: { id: 31 },
      });
      publish("channel.10", "App\\Events\\StopStreamBroadcast", {
        livestream: { id: 31 },
      });
      await vi.waitFor(() =>
        expect(onDisconnected).toHaveBeenCalledWith({ reason: "ended" }),
      );
      expect(connector.isConnected()).toBe(false);
    });

    it("ends a stream the viewers poll finds offline twice in a row, with no end in the feed", async () => {
      kick.viewers = 120;
      const onDisconnected = capture(TOKIO_EVENTS.DISCONNECTED);
      await connector.connect("streamer");
      const lookups = () =>
        kick.urls.filter((u) => u.endsWith("/channels/streamer")).length;
      const before = lookups();

      kick.viewers = null;
      await vi.waitFor(() =>
        expect(onDisconnected).toHaveBeenCalledWith({ reason: "ended" }),
      );
      // Not on the first offline answer
      expect(lookups() - before).toBe(2);
      expect(connector.isConnected()).toBe(false);
    });

    it("emits DISCONNECTED without a reason on disconnect, after the events sent", async () => {
      const onDisconnected = capture(TOKIO_EVENTS.DISCONNECTED);
      await connector.connect("streamer");
      const closed = once(socket().ws, "close");

      await connector.disconnect();
      expect(onDisconnected).not.toHaveBeenCalled();
      expect(connector.isConnected()).toBe(false);

      await new Promise((r) => setImmediate(r));
      expect(onDisconnected).toHaveBeenCalledWith(undefined);
      await closed;
    });
  });

  describe("reconnects", () => {
    it("after a close worth reconnecting, as the same client", async () => {
      const onDisconnected = capture(TOKIO_EVENTS.DISCONNECTED);
      await connector.connect("streamer");

      socket().ws.close(4005, "network timeout");

      await vi.waitFor(() => expect(states).toContain("reconnected"));
      expect(states).toEqual(["reconnecting", "reconnecting", "reconnected"]);
      expect(kick.sockets).toHaveLength(2);
      expect(socket().got).toHaveLength(5);
      expect(new Set(kick.clients).size).toBe(1);
      expect(connector.isReconnecting()).toBe(false);
      expect(onDisconnected).not.toHaveBeenCalled();
    });

    it("after a terminal close, waiting, as a new client", async () => {
      await connector.connect("streamer");
      const dropped = Date.now();

      socket().ws.close(3501, "bad request");

      await vi.waitFor(() => expect(states).toContain("reconnected"));
      expect(Date.now() - dropped).toBeGreaterThanOrEqual(55);
      expect(new Set(kick.clients).size).toBe(2);
    });

    it("keeps trying while the network is down, and ends a stream that ended meanwhile", async () => {
      kick.viewers = 50;
      const onDisconnected = capture(TOKIO_EVENTS.DISCONNECTED);
      await connector.connect("streamer");
      let failures = 3;
      kick.override = (url) => {
        if (url.endsWith("/channels/streamer") && failures-- > 0) {
          throw new TypeError("fetch failed");
        }
        return undefined;
      };
      kick.viewers = null;

      socket().ws.terminate();

      await vi.waitFor(() => expect(states).toContain("reconnected"));
      expect(states.filter((s) => s === "reconnecting")).toHaveLength(5);
      await vi.waitFor(() =>
        expect(onDisconnected).toHaveBeenCalledWith({ reason: "ended" }),
      );
    });
  });

  it("has no gifts and ignores keys", async () => {
    connector.setKey();
    expect(await connector.fetchGifts()).toEqual({ success: true, data: [] });
    expect(connector.isWaiting()).toBe(false);
  });
});
