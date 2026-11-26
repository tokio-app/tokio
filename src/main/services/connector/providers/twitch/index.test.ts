import { TOKIO_EVENTS } from "@/common/types";
import Logger from "@/logger";
import { once } from "node:events";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import { WebSocket, WebSocketServer } from "ws";
import type { PlatformAccount, ReconnectState } from "../../common";
import { NO_ACCOUNT } from "./common/auth";
import config, { type TwitchConfig } from "./config";
import { TwitchConnector } from "./index";

const BROADCASTER = "1971641";
const ACCOUNT = { id: BROADCASTER, login: "streamer", key: "refresh-1" };

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status });

type FetchInit = {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
};
type Subscription = {
  type: string;
  version: string;
  condition: Record<string, string>;
  transport: { method: string; session_id: string };
};

// Stands in for Twitch: the EventSub socket on a local server, its APIs
// through a stubbed fetch
const twitch = {
  sockets: [] as { socket: WebSocket; url: string }[],
  subscriptions: [] as {
    body: Subscription;
    headers: Record<string, string>;
  }[],
  // Each subscription type's answer, 202 unless set
  subStatus: {} as Record<string, number>,
  // The keepalive each new socket's welcome says, in seconds
  keepalive: [] as number[],
  live: null as number | null,
  // false: a new socket is taken but never welcomed
  welcome: true,
  // Answers a request instead, until it gives undefined
  override: undefined as
    ((url: string) => Response | Promise<Response> | undefined) | undefined,
  calls: [] as string[],
};

let counter = 0;
const send = (
  socket: WebSocket,
  type: string,
  payload: unknown,
  extra: Record<string, string> = {},
) =>
  socket.send(
    JSON.stringify({
      metadata: {
        message_id: extra.id ?? `message-${++counter}`,
        message_type: type,
        message_timestamp: new Date().toISOString(),
        ...extra,
      },
      payload,
    }),
  );

const notify = (type: string, event: unknown, id?: string) =>
  send(
    socket(),
    "notification",
    { subscription: { type, version: "1" }, event },
    { subscription_type: type, ...(id ? { id } : {}) },
  );

const socket = () => twitch.sockets[twitch.sockets.length - 1].socket;

const viewer = {
  user_id: "4145994",
  user_login: "viewer32",
  user_name: "Viewer32",
};

describe("TwitchConnector", () => {
  let server: WebSocketServer;
  let port: number;
  let connector: TwitchConnector;
  let saved: Mock<(account: PlatformAccount) => Promise<boolean>>;
  let states: ReconnectState[];

  // The suite's connector, with the delays short and these options
  const make = (options: Partial<TwitchConfig> = {}) => {
    connector = new TwitchConnector({
      CLIENT_ID: "client",
      EVENTSUB_URL: `ws://127.0.0.1:${port}/ws`,
      KEEPALIVE_GRACE_MS: 0,
      CONNECT_RETRY_MS: 10,
      RECONNECT_MIN_MS: 10,
      RECONNECT_MAX_MS: 40,
      STREAMS_POLL_MS: 50,
      ...options,
    });
    connector.setAccount(ACCOUNT);
    saved = vi.fn(async () => true);
    connector.onAccount(saved);
    states = [];
    connector.onReconnect((state) => states.push(state));
  };

  const capture = (event: TOKIO_EVENTS) => {
    const listener = vi.fn();
    connector.on(event, listener);
    return listener;
  };

  beforeEach(async () => {
    Object.assign(twitch, {
      sockets: [],
      subscriptions: [],
      subStatus: {},
      keepalive: [],
      live: null,
      welcome: true,
      override: undefined,
      calls: [],
    });
    server = new WebSocketServer({ port: 0, host: "127.0.0.1" });
    await once(server, "listening");
    const address = server.address();
    port = typeof address === "object" && address ? address.port : 0;
    server.on("connection", (ws, req) => {
      const url = req.url ?? "";
      twitch.sockets.push({ socket: ws, url });
      if (!twitch.welcome) return;
      // A reconnect's socket keeps the session
      const id = url.includes("reconnect")
        ? "session-1"
        : `session-${twitch.sockets.length}`;
      send(ws, "session_welcome", {
        session: {
          id,
          status: "connected",
          keepalive_timeout_seconds: twitch.keepalive.shift() ?? 10,
          reconnect_url: null,
        },
      });
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: FetchInit = {}) => {
        twitch.calls.push(url);
        const answer = twitch.override?.(url);
        if (answer) return answer;
        if (url === config.TOKEN_URL) {
          return json(200, {
            access_token: "access-1",
            refresh_token: "refresh-2",
          });
        }
        if (url === config.VALIDATE_URL) {
          return json(200, { login: "streamer", user_id: BROADCASTER });
        }
        if (url.endsWith("/eventsub/subscriptions")) {
          const body: Subscription = JSON.parse(init.body ?? "{}");
          twitch.subscriptions.push({ body, headers: init.headers ?? {} });
          return json(twitch.subStatus[body.type] ?? 202, {
            status: twitch.subStatus[body.type],
            message: "nope",
          });
        }
        if (url.includes("/streams?")) {
          const live = twitch.live;
          return json(200, {
            data: live === null ? [] : [{ viewer_count: live }],
          });
        }
        if (url.includes("/users?id=")) {
          const id = new URL(url).searchParams.get("id");
          return json(200, {
            data: [{ profile_image_url: `https://pic/${id}.png` }],
          });
        }
        return json(404, {});
      }),
    );

    make();
  });

  afterEach(async () => {
    await connector.disconnect();
    for (const ws of server.clients) ws.terminate();
    await new Promise((resolve) => server.close(resolve));
    vi.unstubAllGlobals();
  });

  const subscribed = (session: string) =>
    twitch.subscriptions
      .filter((s) => s.body.transport.session_id === session)
      .map((s) => s.body.type);

  describe("connect", () => {
    it("needs Tokio's client ID and a signed-in account", async () => {
      expect((await new TwitchConnector().connect("")).error?.kind).toBe(
        "noKey",
      );
      connector.setAccount(NO_ACCOUNT);
      expect((await connector.connect("")).error?.kind).toBe("noKey");
      expect(twitch.calls).toEqual([]);
    });

    it("subscribes to the channel's events on the welcome, then connects", async () => {
      const onConnected = capture(TOKIO_EVENTS.CONNECTED);

      const connecting = connector.connect("ignored");
      expect(connector.connect("ignored")).toBe(connecting);
      expect(await connecting).toEqual({ success: true });

      expect(onConnected).toHaveBeenCalledOnce();
      expect(connector.isConnected()).toBe(true);
      expect(subscribed("session-1").sort()).toEqual([
        "channel.bits.use",
        "channel.channel_points_custom_reward_redemption.add",
        "channel.chat.message",
        "channel.chat.notification",
        "channel.follow",
        "stream.offline",
        "stream.online",
      ]);
      const chat = twitch.subscriptions.find(
        (s) => s.body.type === "channel.chat.message",
      );
      expect(chat?.body).toEqual({
        type: "channel.chat.message",
        version: "1",
        condition: { broadcaster_user_id: BROADCASTER, user_id: BROADCASTER },
        transport: { method: "websocket", session_id: "session-1" },
      });
      expect(chat?.headers).toMatchObject({
        Authorization: "Bearer access-1",
        "Client-Id": "client",
      });
      const follow = twitch.subscriptions.find(
        (s) => s.body.type === "channel.follow",
      );
      expect(follow?.body).toMatchObject({
        version: "2",
        condition: {
          broadcaster_user_id: BROADCASTER,
          moderator_user_id: BROADCASTER,
        },
      });
      // The refresh rotated the key, saved before it was used
      expect(saved).toHaveBeenCalledWith({ ...ACCOUNT, key: "refresh-2" });
    });

    it("fails without chat, and skips the events a channel doesn't have", async () => {
      const warn = vi.spyOn(Logger, "warn");
      twitch.subStatus["channel.bits.use"] = 403;
      twitch.subStatus["channel.channel_points_custom_reward_redemption.add"] =
        403;

      expect(await connector.connect("")).toEqual({ success: true });
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("channel.bits.use answered 403"),
        expect.anything(),
      );
      await connector.disconnect();

      twitch.subStatus["channel.chat.message"] = 403;
      const onConnected = capture(TOKIO_EVENTS.CONNECTED);
      const res = await connector.connect("");

      expect(res.error?.kind).toBe("badKey");
      expect(onConnected).not.toHaveBeenCalled();
      expect(connector.isConnected()).toBe(false);
    });

    it("skips an event Twitch rate limits, but not chat", async () => {
      twitch.subStatus["channel.follow"] = 429;
      expect(await connector.connect("")).toEqual({ success: true });
      await connector.disconnect();

      twitch.subStatus["channel.chat.message"] = 429;
      const res = await connector.connect("");

      expect(res.error?.kind).toBe("rateLimited");
      expect(connector.isConnected()).toBe(false);
    });

    it("fails a try on a socket Twitch never welcomes", async () => {
      twitch.welcome = false;
      make({ REQUEST_TIMEOUT_MS: 50 });

      const res = await connector.connect("");

      expect(res.error?.kind).toBe("network");
      expect(res.error?.message).toContain("welcome");
      expect(twitch.sockets).toHaveLength(config.CONNECT_TRIES);
      expect(connector.isConnected()).toBe(false);
    });

    it("tells a rate limit", async () => {
      twitch.override = (url) =>
        url === config.TOKEN_URL ? json(429, {}) : undefined;

      expect((await connector.connect("")).error?.kind).toBe("rateLimited");
    });

    it("tries a network failure again", async () => {
      let failures = 2;
      twitch.override = (url) => {
        if (url === config.VALIDATE_URL && failures-- > 0) {
          throw new TypeError("fetch failed");
        }
        return undefined;
      };

      expect(await connector.connect("")).toEqual({ success: true });
      expect(
        twitch.calls.filter((u) => u === config.VALIDATE_URL),
      ).toHaveLength(3);
    });

    it("gives up on the network after its tries", async () => {
      twitch.override = () => {
        throw new TypeError("fetch failed");
      };

      expect((await connector.connect("")).error?.kind).toBe("network");
      expect(connector.isConnected()).toBe(false);
    });
  });

  describe("events", () => {
    it("emits follows with their picture and chat through emitChat, each once", async () => {
      const onFollow = capture(TOKIO_EVENTS.FOLLOW);
      const onChat = capture(TOKIO_EVENTS.CHAT);
      await connector.connect("");

      notify("channel.follow", viewer, "same");
      notify("channel.follow", viewer, "same");
      notify("channel.chat.message", {
        chatter_user_id: "4145994",
        chatter_user_login: "viewer32",
        chatter_user_name: "Viewer32",
        message: { text: "hi", fragments: [{ type: "text", text: "hi" }] },
        badges: [],
      });

      await vi.waitFor(() => expect(onFollow).toHaveBeenCalled());
      await vi.waitFor(() => expect(onChat).toHaveBeenCalled());
      expect(onFollow).toHaveBeenCalledOnce();
      expect(onFollow.mock.calls[0][0].user).toMatchObject({
        handle: "viewer32",
        userId: "twitch:4145994",
        profilePictures: ["https://pic/4145994.png"],
      });
      expect(onChat.mock.calls[0][0].comment.content).toBe("hi");
    });

    it("looks up at most PICTURE_LOOKUPS pictures a minute, sending every event", async () => {
      make({ PICTURE_LOOKUPS: 10 });
      const onFollow = capture(TOKIO_EVENTS.FOLLOW);
      await connector.connect("");

      for (let i = 0; i < 50; i++) {
        notify("channel.follow", { ...viewer, user_id: `${1000 + i}` });
      }

      await vi.waitFor(() => expect(onFollow).toHaveBeenCalledTimes(50));
      expect(twitch.calls.filter((u) => u.includes("/users?id="))).toHaveLength(
        10,
      );
      const pictured = onFollow.mock.calls.filter(
        ([follow]) => follow.user.profilePictures.length,
      );
      expect(pictured).toHaveLength(10);
    });

    it("sends an event still waiting for its picture when the stream ends", async () => {
      const order: string[] = [];
      connector.on(TOKIO_EVENTS.CHEER, () => order.push("cheer"));
      connector.on(TOKIO_EVENTS.DISCONNECTED, () => order.push("disconnected"));
      await connector.connect("");
      let release: (() => void) | undefined;
      twitch.override = (url) =>
        url.includes("/users?id=")
          ? new Promise((resolve) => {
              release = () =>
                resolve(json(200, { data: [{ profile_image_url: "x" }] }));
            })
          : undefined;

      notify("stream.online", { broadcaster_user_id: BROADCASTER });
      notify("channel.bits.use", { ...viewer, bits: 500, type: "cheer" });
      await vi.waitFor(() => expect(release).toBeDefined());
      notify("stream.offline", { broadcaster_user_id: BROADCASTER });
      await vi.waitFor(() => expect(order).toContain("disconnected"));
      release!();
      await new Promise((r) => setTimeout(r, 50));

      expect(order).toEqual(["cheer", "disconnected"]);
    });

    it("sends the viewers while live, and ends with the stream", async () => {
      twitch.live = 120;
      const onRoom = capture(TOKIO_EVENTS.ROOM_USER);
      const onDisconnected = capture(TOKIO_EVENTS.DISCONNECTED);
      await connector.connect("");

      expect(onRoom).toHaveBeenCalledWith({
        ranks: [],
        viewers: 120,
        views: 0,
      });
      twitch.live = 130;
      await vi.waitFor(() =>
        expect(onRoom).toHaveBeenCalledWith({
          ranks: [],
          viewers: 130,
          views: 0,
        }),
      );

      notify("stream.offline", { broadcaster_user_id: BROADCASTER });
      await vi.waitFor(() =>
        expect(onDisconnected).toHaveBeenCalledWith({ reason: "ended" }),
      );
      expect(connector.isConnected()).toBe(false);
    });

    it("stays connected to an offline channel until a stream it saw ends", async () => {
      const onDisconnected = capture(TOKIO_EVENTS.DISCONNECTED);
      await connector.connect("");

      notify("stream.offline", { broadcaster_user_id: BROADCASTER });
      await new Promise((r) => setTimeout(r, 50));
      expect(onDisconnected).not.toHaveBeenCalled();
      expect(connector.isConnected()).toBe(true);

      notify("stream.online", {
        broadcaster_user_id: BROADCASTER,
        type: "live",
      });
      notify("stream.offline", { broadcaster_user_id: BROADCASTER });
      await vi.waitFor(() =>
        expect(onDisconnected).toHaveBeenCalledWith({ reason: "ended" }),
      );
    });

    it("signs out when Twitch revokes the app, and the next connect says so", async () => {
      const onDisconnected = capture(TOKIO_EVENTS.DISCONNECTED);
      await connector.connect("");

      send(socket(), "revocation", {
        subscription: {
          type: "channel.chat.message",
          status: "authorization_revoked",
        },
      });

      await vi.waitFor(() =>
        expect(onDisconnected).toHaveBeenCalledWith({ reason: "lost" }),
      );
      expect(saved).toHaveBeenLastCalledWith(NO_ACCOUNT);
      expect(states).toEqual([]);
      expect((await connector.connect("")).error?.kind).toBe("badKey");
    });

    it("emits DISCONNECTED without a reason on disconnect, after the events sent", async () => {
      const onDisconnected = capture(TOKIO_EVENTS.DISCONNECTED);
      await connector.connect("");

      await connector.disconnect();
      expect(onDisconnected).not.toHaveBeenCalled();
      expect(connector.isConnected()).toBe(false);

      await new Promise((r) => setImmediate(r));
      expect(onDisconnected).toHaveBeenCalledWith(undefined);
    });
  });

  describe("reconnects", () => {
    it("after a keepalive that never came, subscribing again", async () => {
      twitch.keepalive = [0.1];
      const onDisconnected = capture(TOKIO_EVENTS.DISCONNECTED);
      await connector.connect("");

      await vi.waitFor(() => expect(states).toContain("reconnected"));

      expect(states[0]).toBe("reconnecting");
      expect(states.at(-1)).toBe("reconnected");
      expect(connector.isReconnecting()).toBe(false);
      expect(subscribed("session-2")).toHaveLength(7);
      expect(onDisconnected).not.toHaveBeenCalled();
    });

    it("after Twitch closes the socket", async () => {
      await connector.connect("");

      socket().close(4005, "network timeout");

      await vi.waitFor(() => expect(states).toContain("reconnected"));
      expect(subscribed("session-2")).toHaveLength(7);
    });

    it("keeps trying while the network is down", async () => {
      await connector.connect("");
      let failures = 3;
      twitch.override = (url) => {
        if (url === config.VALIDATE_URL && failures-- > 0) {
          throw new TypeError("fetch failed");
        }
        return undefined;
      };

      socket().terminate();
      await vi.waitFor(() => expect(connector.isReconnecting()).toBe(true));

      await vi.waitFor(() => expect(states).toContain("reconnected"));
      expect(states.filter((s) => s === "reconnecting").length).toBe(5);
      expect(connector.isReconnecting()).toBe(false);
    });

    it("switches to Twitch's reconnect URL without subscribing again", async () => {
      const onFollow = capture(TOKIO_EVENTS.FOLLOW);
      await connector.connect("");
      const old = socket();
      const closed = once(old, "close");

      send(old, "session_reconnect", {
        session: {
          id: "session-1",
          status: "reconnecting",
          reconnect_url: `ws://127.0.0.1:${port}/ws?reconnect=1`,
        },
      });

      await closed;
      expect(twitch.sockets.at(-1)?.url).toBe("/ws?reconnect=1");
      expect(twitch.subscriptions).toHaveLength(7);
      expect(states).toEqual([]);

      notify("channel.follow", viewer);
      await vi.waitFor(() => expect(onFollow).toHaveBeenCalled());
    });
  });

  it("has no gifts and ignores keys", async () => {
    connector.setKey();
    expect(await connector.fetchGifts()).toEqual({ success: true, data: [] });
    expect(connector.isWaiting()).toBe(false);
  });

  it("revokes on sign-out and clears the account", async () => {
    const onDisconnected = capture(TOKIO_EVENTS.DISCONNECTED);
    await connector.connect("");

    await connector.signOut();

    expect(twitch.calls).toContain(config.REVOKE_URL);
    expect(saved).toHaveBeenLastCalledWith(NO_ACCOUNT);
    expect(connector.isConnected()).toBe(false);
    await vi.waitFor(() =>
      expect(onDisconnected).toHaveBeenCalledWith(undefined),
    );
  });
});
