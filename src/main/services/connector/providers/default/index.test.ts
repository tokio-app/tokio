import { ChatEvent, TOKIO_EVENTS } from "@/common/types";
import {
  AbortError,
  ConnectorError,
  InvalidUsernameError,
  OfflineError,
  PremiumFeatureError,
  RateLimitError,
  RoomNotFoundError,
  SignError,
  TimeoutError,
  WebSocketError,
} from "@tokioapp/connector";
import Logger from "@/logger";
import { app } from "@test/electron";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import type { ReconnectState } from "../../common";
import { TikTokLiveConnector } from "./index";

type Connection = {
  username: string;
  options: {
    requestTimeoutMs?: number;
    signTimeoutMs?: number;
    reconnect?: unknown;
    logger?: (
      level: string,
      message: string,
      data?: { error?: unknown; attempt?: number },
    ) => void;
  };
  state: string;
  emit: (event: string, data?: unknown) => boolean;
  listenerCount: (event: string) => number;
};

// Stands in for TikTok: tests emit the library's events on the last connection.
const live = vi.hoisted(() => ({
  connections: [] as Connection[],
  signers: [] as unknown[],
  // connect() waits on the gate while connecting, then throws the error or
  // runs `during` before it resolves
  connect: {
    gate: Promise.resolve(),
    error: undefined as Error | undefined,
    during: undefined as ((c: Connection) => void) | undefined,
  },
  // Listeners the connection had when connect() was called
  listening: [] as number[],
  // Every connection's fetchGifts, set in each test
  fetchGifts: (_options: unknown): Promise<unknown> => Promise.resolve(),
}));

vi.mock("@tokioapp/connector", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@tokioapp/connector")>();
  const { EventEmitter } = await import("node:events");
  class TikTokLiveConnection extends EventEmitter {
    state = "idle";
    constructor(
      public username: string,
      public options: Connection["options"],
    ) {
      super();
      live.connections.push(this);
    }
    async connect() {
      live.listening.push(this.listenerCount("chat"));
      this.state = "connecting";
      await live.connect.gate;
      if (live.connect.error) {
        this.state = "disconnected";
        throw live.connect.error;
      }
      this.state = "connected";
      this.emit("connected", { roomId: "1", reconnected: false, attempt: 0 });
      live.connect.during?.(this);
      return { roomId: "1" };
    }
    fetchGifts(options: unknown) {
      return live.fetchGifts(options);
    }
    async disconnect() {
      if (this.state === "disconnected") return;
      this.state = "disconnected";
      this.emit("disconnected", { reason: "user", willReconnect: false });
    }
  }
  class EulerSigner {
    constructor(options: unknown) {
      live.signers.push(options);
    }
  }
  return { ...actual, TikTokLiveConnection, EulerSigner };
});

const rawUser = {
  userId: "1",
  nickname: "Viewer",
  displayId: "viewer",
  avatarThumb: { urlList: ["https://img/1.png"], uri: "" },
  badgeList: [
    {
      sceneType: 10,
      combine: {
        icon: {
          uri: "webcast-va/fans_badge_icon_lv10_v4.png",
          urlList: ["https://img/lv10.png", "https://img2/lv10.png"],
        },
      },
      privilegeLogExtra: { level: "12" },
    },
  ],
};

const mappedUser = {
  username: "Viewer",
  handle: "viewer",
  profilePictures: ["https://img/1.png"],
  superfan: false,
  follower: false,
  moderator: false,
  fanLevel: 12,
  fanBadge: "https://img/lv10.png",
  userId: "1",
  platform: "tiktok",
};

describe("TikTokLiveConnector", () => {
  let connector: TikTokLiveConnector;

  const connection = () => live.connections[live.connections.length - 1];

  const connected = async () => {
    connector.setKey("euler-key");
    return connector.connect("@streamer");
  };

  const capture = (event: TOKIO_EVENTS) => {
    const listener = vi.fn();
    connector.on(event, listener);
    return listener;
  };

  beforeEach(() => {
    live.connections.length = 0;
    live.signers.length = 0;
    live.listening.length = 0;
    live.connect.gate = Promise.resolve();
    live.connect.error = undefined;
    live.connect.during = undefined;
    connector = new TikTokLiveConnector();
  });

  afterEach(async () => {
    // A look for the LIVE leaves a timer
    await connector.disconnect();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe("connect", () => {
    it("needs a username", async () => {
      connector.setKey("euler-key");
      const onConnected = capture(TOKIO_EVENTS.CONNECTED);

      const res = await connector.connect("@");

      expect(res.error?.kind).toBe("notFound");
      expect(onConnected).not.toHaveBeenCalled();
      expect(live.connections).toEqual([]);
    });

    it("needs an Euler Stream API key", async () => {
      const onConnected = capture(TOKIO_EVENTS.CONNECTED);

      const res = await connector.connect("streamer");

      expect(res).toEqual({
        success: false,
        error: expect.objectContaining({ kind: "noKey" }),
      });
      expect(onConnected).not.toHaveBeenCalled();
      expect(live.connections).toEqual([]);
    });

    it("signs with the saved key", async () => {
      expect(await connected()).toEqual({ success: true });

      expect(connection().username).toBe("streamer");
      expect(live.signers).toEqual([{ apiKey: "euler-key" }]);
      expect(connector.isConnected()).toBe(true);
    });

    it("never gives up reconnecting, tries every 15 s at most, and gives a sign 20 s", async () => {
      await connected();

      expect(connection().options.reconnect).toEqual({
        maxAttempts: Infinity,
        maxDelayMs: 15_000,
      });
      expect(connection().options.signTimeoutMs).toBe(20_000);
    });

    it("opens one connection when connect comes again while connecting", async () => {
      connector.setKey("euler-key");
      let open!: () => void;
      live.connect.gate = new Promise((resolve) => (open = resolve));

      const first = connector.connect("streamer");
      const second = connector.connect("streamer");
      open();

      expect(await Promise.all([first, second])).toEqual([
        { success: true },
        { success: true },
      ]);
      expect(live.connections).toHaveLength(1);

      await connector.disconnect();

      expect(connection().state).toBe("disconnected");
      expect(connector.isConnected()).toBe(false);
    });

    it("counts as connected while connecting", async () => {
      connector.setKey("euler-key");
      let open!: () => void;
      live.connect.gate = new Promise((resolve) => (open = resolve));

      const connecting = connector.connect("streamer");
      const during = connector.isConnected();
      open();
      await connecting;

      expect(during).toBe(true);
      expect(connector.isConnected()).toBe(true);
    });

    it("listens before connecting, and says it's connected first", async () => {
      const onConnected = capture(TOKIO_EVENTS.CONNECTED);
      const onChat = capture(TOKIO_EVENTS.CHAT);
      live.connect.during = (c) =>
        c.emit("chat", { user: rawUser, content: "hi", emotes: [] });

      await connected();

      expect(live.listening).toEqual([1]);
      expect(onConnected).toHaveBeenCalledOnce();
      expect(onChat).toHaveBeenCalledOnce();
      expect(onConnected.mock.invocationCallOrder[0]).toBeLessThan(
        onChat.mock.invocationCallOrder[0],
      );
    });

    it.each([
      [new OfflineError("Not LIVE"), "offline"],
      [new RoomNotFoundError("No room"), "notFound"],
      [
        new RoomNotFoundError("No lookup answered", { retryable: true }),
        "network",
      ],
      [new InvalidUsernameError("Bad username"), "notFound"],
      [new SignError("Unauthorized", { status: 401 }), "badKey"],
      [new SignError("Forbidden", { status: 403 }), "badKey"],
      [new SignError("Bad gateway", { status: 502 }), "sign"],
      [new PremiumFeatureError("Paid plan", { status: 402 }), "premium"],
      [new TimeoutError("Slow", { phase: "connect" }), "network"],
      [new WebSocketError("Closed"), "network"],
      [new ConnectorError("NETWORK", "Offline"), "network"],
      [new ConnectorError("PROTOCOL", "Garbled"), "unknown"],
      // disconnect() interrupted the connect
      [new AbortError(), "canceled"],
      [new Error("A bug"), "unknown"],
    ])("reports %s as %s and stops listening", async (error, kind) => {
      // A network failure is tried again first
      vi.useFakeTimers();
      live.connect.error = error;
      const onConnected = capture(TOKIO_EVENTS.CONNECTED);

      const pending = connected();
      await vi.runAllTimersAsync();
      const res = await pending;

      expect(res.success).toBe(false);
      expect(res.error).toMatchObject({ kind, cause: error });
      expect(onConnected).not.toHaveBeenCalled();
      expect(connection().listenerCount("chat")).toBe(0);
      expect(connector.isConnected()).toBe(false);
    });

    it("says how long to wait when rate limited", async () => {
      live.connect.error = new RateLimitError("Slow down", {
        retryAfterMs: 12_300,
      });

      const res = await connected();

      expect(res.error).toMatchObject({
        kind: "rateLimited",
        retryAfterSeconds: 13,
      });
    });

    it("tries a connect that failed on the network 3 times, 3 s apart", async () => {
      vi.useFakeTimers();
      live.connect.error = new WebSocketError("The server answered 200");

      const pending = connected();
      await vi.advanceTimersByTimeAsync(0);
      expect(live.listening).toHaveLength(1);
      // Still connecting, so the profile stays locked
      expect(connector.isConnected()).toBe(true);
      await vi.advanceTimersByTimeAsync(3000);
      expect(live.listening).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(3000);

      expect((await pending).error?.kind).toBe("network");
      expect(live.listening).toHaveLength(3);
      expect(live.connections).toHaveLength(1);
      expect(connector.isConnected()).toBe(false);
    });

    it("connects when a later try works", async () => {
      vi.useFakeTimers();
      live.connect.error = new TimeoutError("Slow", { phase: "sign" });
      const onConnected = capture(TOKIO_EVENTS.CONNECTED);

      const pending = connected();
      await vi.advanceTimersByTimeAsync(0);
      live.connect.error = undefined;
      await vi.advanceTimersByTimeAsync(3000);

      expect(await pending).toEqual({ success: true });
      expect(onConnected).toHaveBeenCalledOnce();
    });

    it.each([
      new OfflineError("Not LIVE"),
      new RateLimitError("Slow down"),
      new SignError("Unauthorized", { status: 401 }),
    ])("tells %s at once", async (error) => {
      live.connect.error = error;

      expect((await connected()).success).toBe(false);
      expect(live.listening).toHaveLength(1);
    });

    it("stops trying when disconnected", async () => {
      vi.useFakeTimers();
      live.connect.error = new WebSocketError("Closed");

      const pending = connected();
      await vi.advanceTimersByTimeAsync(0);
      await connector.disconnect();

      // Canceled, not the last try's network failure: nothing to tell
      expect(await pending).toMatchObject({
        success: false,
        error: { kind: "canceled" },
      });
      await vi.advanceTimersByTimeAsync(10_000);
      expect(live.listening).toHaveLength(1);
      expect(connector.isConnected()).toBe(false);
    });
  });

  it("logs the connection's warnings with their reason, errors, connects and stops, routine lines at debug", async () => {
    const warn = vi.spyOn(Logger, "warn");
    const error = vi.spyOn(Logger, "error");
    const info = vi.spyOn(Logger, "info");
    const debug = vi.spyOn(Logger, "debug");
    connector.setLogFile("connector.log");
    await connected();
    const log = connection().options.logger!;
    const cause = new Error("closed");
    const kicked = new WebSocketError("Closed with code 4005 (kicked)");

    log("warn", "The connection dropped (wsClose): reconnecting", {
      error: kicked,
    });
    log("warn", "The signer named a room id that isn't one");
    log("error", "Gave up reconnecting after 10 attempts", { error: cause });
    log("info", "Connected to room 1", { attempt: 0 });
    log("info", "Connected to room 1", { attempt: 3 });
    log("info", "Disconnected (signError)", { error: kicked });
    log("debug", "Opening the WebSocket");

    expect(warn.mock.calls).toEqual([
      [
        "<Connector> The connection dropped (wsClose): reconnecting -- Closed with code 4005 (kicked)",
        "connector.log",
      ],
      [
        "<Connector> The signer named a room id that isn't one",
        "connector.log",
      ],
    ]);
    expect(error).toHaveBeenCalledExactlyOnceWith(
      "<Connector> Gave up reconnecting after 10 attempts",
      "connector.log",
      cause,
    );
    expect(info.mock.calls).toEqual(
      expect.arrayContaining([
        ["<Connector> Connected to room 1", "connector.log"],
        ["<Connector> Connected to room 1 (attempt 3)", "connector.log"],
        [
          "<Connector> Disconnected (signError) -- Closed with code 4005 (kicked)",
          "connector.log",
        ],
      ]),
    );
    expect(debug.mock.calls).toEqual(
      expect.arrayContaining([
        ["<Connector> Opening the WebSocket", "connector.log"],
      ]),
    );
    expect(debug).not.toHaveBeenCalledWith(
      "<Connector> Connected to room 1",
      "connector.log",
    );
  });

  it("logs an error that repeats at most every 30 seconds", async () => {
    vi.useFakeTimers();
    const error = vi.spyOn(Logger, "error");
    await connected();
    const log = connection().options.logger!;
    const dropped = new ConnectorError("PROTOCOL", "Dropped message 1");
    const gaveUp = new ConnectorError("RECONNECT_GAVE_UP", "Gave up");

    log("error", dropped.message, { error: dropped });
    log("error", "Dropped message 2", { error: dropped });
    log("error", gaveUp.message, { error: gaveUp });
    vi.advanceTimersByTime(30_000);
    log("error", "Dropped message 3", { error: dropped });

    expect(error.mock.calls.map(([message]) => message)).toEqual([
      "<Connector> Dropped message 1",
      "<Connector> Gave up",
      "<Connector> Dropped message 3",
    ]);
  });

  describe("disconnects", () => {
    beforeEach(async () => {
      await connected();
    });

    it("says nothing about why when asked to, and stops listening", async () => {
      const onDisconnected = capture(TOKIO_EVENTS.DISCONNECTED);
      const closed = connection();

      await connector.disconnect();
      await connector.disconnect();
      await new Promise(setImmediate);

      expect(onDisconnected).toHaveBeenCalledExactlyOnceWith(undefined);
      expect(closed.listenerCount("chat")).toBe(0);
      expect(connector.isConnected()).toBe(false);
    });

    it("says the LIVE ended", async () => {
      const onDisconnected = capture(TOKIO_EVENTS.DISCONNECTED);

      connection().state = "disconnected";
      connection().emit("disconnected", {
        reason: "streamEnd",
        willReconnect: false,
      });
      await new Promise(setImmediate);

      expect(onDisconnected).toHaveBeenCalledExactlyOnceWith({
        reason: "ended",
      });
      expect(connection().listenerCount("chat")).toBe(0);
      expect(connector.isConnected()).toBe(false);
      expect(connector.isWaiting()).toBe(false);
    });

    it.each(["giveUp", "signError", "wsClose"])(
      "says the connection was lost (%s), and looks for the LIVE",
      async (reason) => {
        const onDisconnected = capture(TOKIO_EVENTS.DISCONNECTED);
        let waiting: boolean | undefined;
        connector.on(TOKIO_EVENTS.DISCONNECTED, () => {
          waiting = connector.isWaiting();
        });

        connection().state = "disconnected";
        connection().emit("disconnected", { reason, willReconnect: false });
        await new Promise(setImmediate);

        expect(onDisconnected).toHaveBeenCalledExactlyOnceWith({
          reason: "lost",
        });
        expect(connection().listenerCount("chat")).toBe(0);
        // Already looking when DISCONNECTED comes, for what it pushes
        expect(waiting).toBe(true);
        expect(connector.isConnected()).toBe(true);
      },
    );

    describe("looks for the LIVE after an abnormal stop", () => {
      let onReconnect: Mock<(state: ReconnectState) => void>;

      const lose = (reason = "wsClose") => {
        connection().state = "disconnected";
        connection().emit("disconnected", { reason, willReconnect: false });
      };

      beforeEach(() => {
        vi.useFakeTimers();
        onReconnect = vi.fn();
        connector.onReconnect(onReconnect);
      });

      it("connects 10 s later when the LIVE is back, starting a new one", async () => {
        const onConnected = capture(TOKIO_EVENTS.CONNECTED);

        lose();
        await vi.advanceTimersByTimeAsync(9_999);
        expect(live.connections).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(1);

        expect(live.connections).toHaveLength(2);
        expect(onConnected).toHaveBeenCalledOnce();
        expect(onReconnect).toHaveBeenCalledExactlyOnceWith("reconnected");
        expect(connector.isWaiting()).toBe(false);
        expect(connector.isConnected()).toBe(true);
      });

      it("gives up 2 minutes after the stop", async () => {
        live.connect.error = new OfflineError("Not LIVE");

        lose();
        await vi.advanceTimersByTimeAsync(119_000);
        expect(connector.isWaiting()).toBe(true);
        expect(onReconnect).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1_000);

        expect(onReconnect).toHaveBeenCalledExactlyOnceWith("stopped");
        expect(connector.isWaiting()).toBe(false);
        expect(connector.isConnected()).toBe(false);
        await vi.advanceTimersByTimeAsync(60_000);
        expect(live.connections).toHaveLength(13);
      });

      it("gives up at once when the key is refused", async () => {
        live.connect.error = new SignError("Unauthorized", { status: 401 });

        lose();
        await vi.advanceTimersByTimeAsync(10_000);

        expect(onReconnect).toHaveBeenCalledExactlyOnceWith("stopped");
        expect(connector.isWaiting()).toBe(false);
      });

      it("keeps the first stop's deadline when the LIVE it found stops again", async () => {
        lose();
        await vi.advanceTimersByTimeAsync(10_000);
        expect(live.connections).toHaveLength(2);

        live.connect.error = new OfflineError("Not LIVE");
        await vi.advanceTimersByTimeAsync(10_000);
        lose();
        await vi.advanceTimersByTimeAsync(99_000);
        expect(connector.isWaiting()).toBe(true);
        await vi.advanceTimersByTimeAsync(1_000);

        expect(onReconnect).toHaveBeenLastCalledWith("stopped");
        expect(connector.isWaiting()).toBe(false);
      });

      it("after a LIVE that ended while reconnecting", async () => {
        const onDisconnected = capture(TOKIO_EVENTS.DISCONNECTED);

        connection().state = "reconnecting";
        connection().emit("streamEnd", { action: "ended" });
        lose("streamEnd");
        await vi.advanceTimersByTimeAsync(0);

        expect(onDisconnected).toHaveBeenCalledExactlyOnceWith({
          reason: "ended",
        });
        expect(connector.isWaiting()).toBe(true);
      });

      it("after a LIVE whose end came with what a reconnect caught up on", async () => {
        connection().emit("connected", {
          roomId: "1",
          reconnected: true,
          attempt: 2,
        });
        connection().emit("streamEnd", { action: "ended" });
        lose("streamEnd");

        expect(connector.isWaiting()).toBe(true);
      });

      it("not after a LIVE that ended on a working connection", async () => {
        await vi.advanceTimersByTimeAsync(0);
        connection().emit("connected", {
          roomId: "1",
          reconnected: true,
          attempt: 1,
        });
        // The batches the reconnect caught up on came and went
        await vi.advanceTimersByTimeAsync(0);
        connection().emit("streamEnd", { action: "ended" });
        lose("streamEnd");

        expect(connector.isWaiting()).toBe(false);
        expect(connector.isConnected()).toBe(false);
      });

      it("not after a Disconnect", async () => {
        await connector.disconnect();

        expect(connector.isWaiting()).toBe(false);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(live.connections).toHaveLength(1);
      });

      it("ends when Connect tries at once", async () => {
        lose();

        expect(await connector.connect("streamer")).toEqual({ success: true });
        expect(connector.isWaiting()).toBe(false);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(live.connections).toHaveLength(2);
        expect(onReconnect).not.toHaveBeenCalled();
      });

      it("ends on Disconnect", async () => {
        lose();
        await connector.disconnect();

        expect(connector.isWaiting()).toBe(false);
        expect(connector.isConnected()).toBe(false);
        await vi.advanceTimersByTimeAsync(10_000);
        expect(live.connections).toHaveLength(1);
      });
    });

    it("ends the LIVE after the events that came with its end", async () => {
      const order: string[] = [];
      const profile = async () => {};
      connector.on(TOKIO_EVENTS.CHAT, async () => {
        await profile();
        order.push("chat");
      });
      connector.on(TOKIO_EVENTS.DISCONNECTED, () => order.push("end"));

      connection().emit("chat", {
        user: rawUser,
        content: "hello",
        contentLanguage: "en",
        emotes: [],
      });
      connection().state = "disconnected";
      connection().emit("disconnected", {
        reason: "streamEnd",
        willReconnect: false,
      });

      await vi.waitFor(() => expect(order).toEqual(["chat", "end"]));
    });

    it("stays connected while it reconnects", () => {
      const onReconnect = vi.fn();
      connector.onReconnect(onReconnect);
      const onConnected = capture(TOKIO_EVENTS.CONNECTED);
      const onDisconnected = capture(TOKIO_EVENTS.DISCONNECTED);

      connection().state = "reconnecting";
      connection().emit("disconnected", {
        reason: "wsClose",
        willReconnect: true,
      });

      expect(onReconnect).toHaveBeenCalledExactlyOnceWith("reconnecting");
      expect(connector.isConnected()).toBe(true);
      expect(connector.isReconnecting()).toBe(true);

      connection().state = "connected";
      connection().emit("connected", {
        roomId: "1",
        reconnected: true,
        attempt: 1,
      });

      expect(onReconnect).toHaveBeenLastCalledWith("reconnected");
      expect(connector.isReconnecting()).toBe(false);
      expect(onConnected).not.toHaveBeenCalled();
      expect(onDisconnected).not.toHaveBeenCalled();
      expect(connection().listenerCount("chat")).toBe(1);
    });

    it("says it's reconnecting on every attempt", () => {
      const onReconnect = vi.fn();
      connector.onReconnect(onReconnect);

      connection().emit("reconnecting", {
        attempt: 2,
        delayMs: 2000,
        reason: "wsClose",
      });

      expect(onReconnect).toHaveBeenCalledExactlyOnceWith("reconnecting");
    });
  });

  describe("events", () => {
    beforeEach(async () => {
      await connected();
    });

    it("maps a chat message with the user's roles and emotes", () => {
      const onChat = capture(TOKIO_EVENTS.CHAT);

      connection().emit("chat", {
        user: rawUser,
        userIdentity: {
          isSubscriberOfAnchor: false,
          isFollowerOfAnchor: true,
          isModeratorOfAnchor: true,
        },
        content: "hello",
        contentLanguage: "en",
        emotes: [
          {
            index: 5,
            emote: { emoteId: "e1", image: { urlList: ["u"], uri: "" } },
          },
        ],
      });

      expect(onChat).toHaveBeenCalledWith({
        user: { ...mappedUser, follower: true, moderator: true },
        comment: {
          content: "hello",
          lang: "en",
          emotes: [{ emoteID: "e1", images: ["u"], index: 5 }],
        },
      });
    });

    it("maps a comment made of emotes only as a chat message", () => {
      const onChat = capture(TOKIO_EVENTS.CHAT);

      connection().emit("emote", {
        user: rawUser,
        userIdentity: {
          isSubscriberOfAnchor: true,
          isFollowerOfAnchor: false,
          isModeratorOfAnchor: false,
        },
        emoteList: [
          { emoteId: "e1", image: { urlList: ["u"], uri: "" } },
          { emoteId: "e2" },
        ],
      });

      expect(onChat).toHaveBeenCalledExactlyOnceWith({
        user: { ...mappedUser, superfan: true },
        comment: {
          content: "",
          lang: "",
          emotes: [
            { emoteID: "e1", images: ["u"], index: 0 },
            { emoteID: "e2", images: [], index: 0 },
          ],
        },
      });
    });

    it("sends a chat through the stage, and drops it once the connection stopped", async () => {
      const onChat = capture(TOKIO_EVENTS.CHAT);
      const stage = vi.fn((chat: ChatEvent) =>
        Promise.resolve({
          ...chat,
          comment: {
            ...chat.comment,
            translation: { text: "hola", from: "en", to: "es" },
          },
        }),
      );
      connector.setChatStage(stage);
      const chat = { user: rawUser, content: "hello", contentLanguage: "en" };

      connection().emit("chat", { ...chat, emotes: [] });
      await vi.waitFor(() => expect(onChat).toHaveBeenCalledOnce());
      expect(onChat.mock.calls[0][0].comment.translation).toEqual({
        text: "hola",
        from: "en",
        to: "es",
      });

      connection().emit("chat", { ...chat, emotes: [] });
      await connector.disconnect();
      await Promise.resolve();
      expect(stage).toHaveBeenCalledTimes(2);
      expect(onChat).toHaveBeenCalledOnce();
    });

    it("sends an emote-only comment through the stage", () => {
      const onChat = capture(TOKIO_EVENTS.CHAT);
      const stage = vi.fn((_chat: ChatEvent) => null);
      connector.setChatStage(stage);

      connection().emit("emote", {
        user: rawUser,
        emoteList: [{ emoteId: "e1" }],
      });

      expect(stage).toHaveBeenCalledOnce();
      expect(onChat).toHaveBeenCalledOnce();
    });

    it("maps gifts and marks the end of a combo", () => {
      const onGift = capture(TOKIO_EVENTS.GIFT);
      const gift = {
        user: rawUser,
        userIdentity: {
          isSubscriberOfAnchor: true,
          isFollowerOfAnchor: true,
          isModeratorOfAnchor: false,
        },
        giftId: "5655",
        gift: {
          type: 1,
          name: "Rose",
          diamondCount: 1,
          image: { urlList: ["g"], uri: "" },
        },
        repeatCount: 3,
      };

      connection().emit("gift", { ...gift, repeatEnd: false });
      connection().emit("gift", { ...gift, repeatEnd: true });

      expect(onGift.mock.calls.map(([e]) => e.gift.repeatEnd)).toEqual([
        false,
        true,
      ]);
      expect(onGift).toHaveBeenLastCalledWith({
        user: { ...mappedUser, follower: true, superfan: true },
        gift: {
          id: "5655",
          type: 1,
          name: "Rose",
          repeatEnd: true,
          coins: 1,
          comboCount: 3,
          image: "g",
        },
      });
    });

    it("counts a gift that can't be sent in a combo when it arrives", () => {
      const onGift = capture(TOKIO_EVENTS.GIFT);

      connection().emit("gift", {
        user: rawUser,
        giftId: "1",
        gift: { type: 2, name: "Lion", diamondCount: 29999 },
        repeatCount: 1,
        repeatEnd: false,
      });

      expect(onGift.mock.calls[0][0].gift).toMatchObject({
        repeatEnd: true,
        image: "",
      });
    });

    describe("a combo of a gift that isn't streakable", () => {
      // As TikTok sends one: a message per gift, each with repeatCount 1 and
      // the combo's group id, and no end
      const heart = (groupId = "7") => ({
        user: rawUser,
        giftId: "5660",
        groupId,
        gift: { type: 2, combo: true, name: "Hand Heart", diamondCount: 100 },
        repeatCount: 1,
        repeatEnd: false,
      });
      const counts = (onGift: ReturnType<typeof capture>) =>
        onGift.mock.calls.map(([e]) => [e.gift.comboCount, e.gift.repeatEnd]);

      beforeEach(() => {
        vi.useFakeTimers();
      });

      it("adds up its gifts and ends it 4 s after the last one", () => {
        const onGift = capture(TOKIO_EVENTS.GIFT);

        connection().emit("gift", heart());
        connection().emit("gift", heart());
        vi.advanceTimersByTime(3999);
        connection().emit("gift", heart());
        vi.advanceTimersByTime(3999);

        expect(counts(onGift)).toEqual([
          [1, false],
          [2, false],
          [3, false],
        ]);

        vi.advanceTimersByTime(1);

        expect(onGift).toHaveBeenCalledTimes(4);
        expect(onGift).toHaveBeenLastCalledWith({
          user: mappedUser,
          gift: {
            id: "5660",
            type: 2,
            name: "Hand Heart",
            repeatEnd: true,
            coins: 100,
            comboCount: 3,
            image: "",
          },
        });
      });

      it("ends the last combo when a new one starts", () => {
        const onGift = capture(TOKIO_EVENTS.GIFT);

        connection().emit("gift", heart("7"));
        connection().emit("gift", heart("7"));
        connection().emit("gift", heart("8"));
        vi.advanceTimersByTime(4000);

        expect(counts(onGift)).toEqual([
          [1, false],
          [2, false],
          [2, true],
          [1, false],
          [1, true],
        ]);
      });

      it("keeps it going through a reconnect, which delivers the gap's gifts", () => {
        const onGift = capture(TOKIO_EVENTS.GIFT);

        connection().emit("gift", heart());
        connection().state = "reconnecting";
        vi.advanceTimersByTime(10_000);
        connection().state = "connected";
        connection().emit("gift", heart());
        vi.advanceTimersByTime(4000);

        expect(counts(onGift)).toEqual([
          [1, false],
          [2, false],
          [2, true],
        ]);
      });

      it("keeps each sender's combo apart", () => {
        const onGift = capture(TOKIO_EVENTS.GIFT);

        connection().emit("gift", heart());
        connection().emit("gift", {
          ...heart(),
          user: { ...rawUser, userId: "2" },
        });

        expect(counts(onGift)).toEqual([
          [1, false],
          [1, false],
        ]);
      });

      it("drops its end once the connection stops", async () => {
        const onGift = capture(TOKIO_EVENTS.GIFT);

        connection().emit("gift", heart());
        await connector.disconnect();
        vi.advanceTimersByTime(4000);

        expect(counts(onGift)).toEqual([[1, false]]);
      });
    });

    it("maps likes, follows, shares and members", () => {
      const onLike = capture(TOKIO_EVENTS.LIKE);
      const onFollow = capture(TOKIO_EVENTS.FOLLOW);
      const onShare = capture(TOKIO_EVENTS.SHARE);
      const onMember = capture(TOKIO_EVENTS.MEMBER_JOIN);

      connection().emit("like", { user: rawUser, count: 15, total: 1200 });
      connection().emit("follow", { user: rawUser });
      connection().emit("share", { user: rawUser, shareCount: 2 });
      connection().emit("member", { user: rawUser });

      expect(onLike).toHaveBeenCalledWith({
        user: mappedUser,
        likeCount: 15,
        totalLikes: 1200,
      });
      expect(onFollow).toHaveBeenCalledWith({ user: mappedUser });
      expect(onShare).toHaveBeenCalledWith({ user: mappedUser, shareCount: 2 });
      expect(onMember).toHaveBeenCalledWith({ user: mappedUser });
    });

    it("maps envelopes and super fans", () => {
      const onEnvelope = capture(TOKIO_EVENTS.ENVELOPE);
      const onBox = capture(TOKIO_EVENTS.SUPER_FAN_BOX);
      const onSuperFan = capture(TOKIO_EVENTS.SUPER_FAN);
      const onJoin = capture(TOKIO_EVENTS.SUPER_FAN_JOIN);

      connection().emit("envelope", {});
      connection().emit("superFanBox", {});
      connection().emit("superFan", { user: rawUser });
      connection().emit("superFanJoin", { user: rawUser });

      expect(onEnvelope).toHaveBeenCalledWith(undefined);
      expect(onBox).toHaveBeenCalledWith(undefined);
      expect(onSuperFan).toHaveBeenCalledWith({ user: mappedUser });
      expect(onJoin).toHaveBeenCalledWith({ user: mappedUser });
    });

    it("fills in missing user data", () => {
      const onFollow = capture(TOKIO_EVENTS.FOLLOW);

      connection().emit("follow", {});

      expect(onFollow).toHaveBeenCalledWith({
        user: {
          username: "",
          handle: "",
          profilePictures: [],
          superfan: false,
          follower: false,
          moderator: false,
          fanLevel: 0,
          fanBadge: "",
          userId: "",
          platform: "tiktok",
        },
      });
    });

    it("reads a fan level that isn't a number as 0", () => {
      const onFollow = capture(TOKIO_EVENTS.FOLLOW);
      const [badge] = rawUser.badgeList;

      connection().emit("follow", {
        user: {
          ...rawUser,
          badgeList: [{ ...badge, privilegeLogExtra: { level: "x" } }],
        },
      });

      expect(onFollow).toHaveBeenCalledWith({
        user: expect.objectContaining({ fanLevel: 0 }),
      });
    });

    it("maps viewer ranks like other users", () => {
      const onRoom = capture(TOKIO_EVENTS.ROOM_USER);

      connection().emit("roomUser", {
        total: 40,
        totalUser: 900,
        ranks: [{ user: rawUser, score: 300, rank: 1 }],
      });

      expect(onRoom).toHaveBeenCalledWith({
        viewers: 40,
        views: 900,
        ranks: [
          {
            username: "Viewer",
            handle: "viewer",
            profilePictures: ["https://img/1.png"],
            userId: "1",
            score: 300,
            position: 1,
          },
        ],
      });
    });
  });

  describe("fetchGifts", () => {
    const gifts = {
      source: "region",
      gifts: [
        {
          id: "1",
          name: "Rose",
          diamondCount: 1,
          image: { urlList: ["r"], uri: "" },
        },
        { id: "2", name: "Lion", diamondCount: 29999 },
      ],
    };

    let fetchGifts: ReturnType<typeof vi.fn<(o: unknown) => Promise<unknown>>>;

    beforeEach(() => {
      fetchGifts = vi.fn(async () => gifts);
      live.fetchGifts = fetchGifts;
    });

    it("lists the gifts of the system's region and language", async () => {
      app.getLocaleCountryCode.mockReturnValue("MX");
      app.getLocale.mockReturnValue("es-MX");
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      expect(await connector.fetchGifts()).toEqual({
        success: true,
        data: [
          { id: 1, name: "Rose", coins: 1, image: "r" },
          { id: 2, name: "Lion", coins: 29999, image: "" },
        ],
      });
      expect(fetchGifts).toHaveBeenCalledWith({
        region: "MX",
        language: "es-MX",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("falls back to the US when the system has no country", async () => {
      app.getLocaleCountryCode.mockReturnValue("");

      await connector.fetchGifts();

      expect(fetchGifts).toHaveBeenCalledWith({
        region: "US",
        language: "en-US",
      });
    });

    it("gives up on requests that take too long", async () => {
      await connector.fetchGifts();

      expect(connection().options.requestTimeoutMs).toBeGreaterThan(0);
    });

    it("asks the LIVE's connection while connected", async () => {
      await connected();

      const res = await connector.fetchGifts();

      expect(res.success).toBe(true);
      expect(live.connections).toHaveLength(1);
    });

    it("fails when TikTok does", async () => {
      fetchGifts.mockRejectedValue(new Error("Unavailable"));

      const res = await connector.fetchGifts();

      expect(res).toEqual(
        expect.objectContaining({ success: false, data: [] }),
      );
    });
  });
});
