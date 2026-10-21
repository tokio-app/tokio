import { TOKIO_EVENTS } from "@/common/types";
import {
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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TikTokLiveConnector } from "./index";

type Connection = {
  username: string;
  options: {
    requestTimeoutMs?: number;
    logger?: (
      level: string,
      message: string,
      data?: { error?: unknown },
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
  // Thrown by connect(), or run before it resolves
  connect: {
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
      combine: { icon: { uri: "webcast/fans_badge_12", urlList: [] } },
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
    live.connect.error = undefined;
    live.connect.during = undefined;
    connector = new TikTokLiveConnector();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  describe("connect", () => {
    it("needs a username", async () => {
      connector.setKey("euler-key");
      const onConnected = capture(TOKIO_EVENTS.CONNECTED);

      const res = await connector.connect("@");

      expect(res.error?.kind).toBe("notFound");
      expect(onConnected).toHaveBeenCalledWith(res);
      expect(live.connections).toEqual([]);
    });

    it("needs an Euler Stream API key", async () => {
      const onConnected = capture(TOKIO_EVENTS.CONNECTED);

      const res = await connector.connect("streamer");

      expect(res).toEqual({
        success: false,
        error: expect.objectContaining({ kind: "noKey" }),
      });
      expect(onConnected).toHaveBeenCalledWith(res);
      expect(live.connections).toEqual([]);
    });

    it("signs with the saved key when connect gets none", async () => {
      expect(await connected()).toEqual({ success: true });

      expect(connection().username).toBe("streamer");
      expect(live.signers).toEqual([{ apiKey: "euler-key" }]);
      expect(connector.isConnected()).toBe(true);
    });

    it("signs with the key connect gets, and keeps it", async () => {
      connector.setKey("old-key");

      await connector.connect("streamer", "new-key");
      await connector.disconnect();
      await connector.connect("streamer");

      expect(live.signers).toEqual([
        { apiKey: "new-key" },
        { apiKey: "new-key" },
      ]);
    });

    it("listens before connecting, and says it's connected first", async () => {
      const onConnected = capture(TOKIO_EVENTS.CONNECTED);
      const onChat = capture(TOKIO_EVENTS.CHAT);
      live.connect.during = (c) =>
        c.emit("chat", { user: rawUser, content: "hi", emotes: [] });

      await connected();

      expect(live.listening).toEqual([1]);
      expect(onConnected).toHaveBeenCalledExactlyOnceWith({ success: true });
      expect(onChat).toHaveBeenCalledOnce();
      expect(onConnected.mock.invocationCallOrder[0]).toBeLessThan(
        onChat.mock.invocationCallOrder[0],
      );
    });

    it.each([
      [new OfflineError("Not LIVE"), "offline"],
      [new RoomNotFoundError("No room"), "notFound"],
      [new InvalidUsernameError("Bad username"), "notFound"],
      [new SignError("Unauthorized", { status: 401 }), "badKey"],
      [new SignError("Forbidden", { status: 403 }), "badKey"],
      [new SignError("Bad gateway", { status: 502 }), "sign"],
      [new PremiumFeatureError("Paid plan", { status: 402 }), "sign"],
      [new TimeoutError("Slow", { phase: "connect" }), "network"],
      [new WebSocketError("Closed"), "network"],
      [new ConnectorError("NETWORK", "Offline"), "network"],
      [new ConnectorError("PROTOCOL", "Garbled"), "unknown"],
      [new Error("A bug"), "unknown"],
    ])("reports %s as %s and stops listening", async (error, kind) => {
      live.connect.error = error;
      const onConnected = capture(TOKIO_EVENTS.CONNECTED);

      const res = await connected();

      expect(res.success).toBe(false);
      expect(res.error).toMatchObject({ kind, cause: error });
      expect(onConnected).toHaveBeenCalledWith(res);
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
  });

  it("logs the connection's warnings and errors, not its routine lines", async () => {
    const warn = vi.spyOn(Logger, "warn");
    const error = vi.spyOn(Logger, "error");
    const info = vi.spyOn(Logger, "info");
    connector.setLogFile("connector.log");
    await connected();
    const log = connection().options.logger!;
    const cause = new Error("closed");

    log("warn", "The connection dropped (wsClose): reconnecting", {
      error: cause,
    });
    log("error", "Gave up reconnecting after 10 attempts", { error: cause });
    log("info", "Connected to room 1");
    log("debug", "Opening the WebSocket");

    expect(warn).toHaveBeenCalledExactlyOnceWith(
      "<Connector> The connection dropped (wsClose): reconnecting",
      "connector.log",
    );
    expect(error).toHaveBeenCalledExactlyOnceWith(
      "<Connector> Gave up reconnecting after 10 attempts",
      "connector.log",
      cause,
    );
    expect(info).not.toHaveBeenCalled();
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

      expect(onDisconnected).toHaveBeenCalledExactlyOnceWith(undefined);
      expect(closed.listenerCount("chat")).toBe(0);
      expect(connector.isConnected()).toBe(false);
    });

    it("says the LIVE ended", () => {
      const onDisconnected = capture(TOKIO_EVENTS.DISCONNECTED);

      connection().state = "disconnected";
      connection().emit("disconnected", {
        reason: "streamEnd",
        willReconnect: false,
      });

      expect(onDisconnected).toHaveBeenCalledExactlyOnceWith({
        reason: "ended",
      });
      expect(connection().listenerCount("chat")).toBe(0);
      expect(connector.isConnected()).toBe(false);
    });

    it.each(["giveUp", "signError", "wsClose"])(
      "says the connection was lost (%s)",
      (reason) => {
        const onDisconnected = capture(TOKIO_EVENTS.DISCONNECTED);

        connection().state = "disconnected";
        connection().emit("disconnected", { reason, willReconnect: false });

        expect(onDisconnected).toHaveBeenCalledExactlyOnceWith({
          reason: "lost",
        });
        expect(connection().listenerCount("chat")).toBe(0);
      },
    );

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

      connection().state = "connected";
      connection().emit("connected", {
        roomId: "1",
        reconnected: true,
        attempt: 1,
      });

      expect(onReconnect).toHaveBeenLastCalledWith("reconnected");
      expect(onConnected).not.toHaveBeenCalled();
      expect(onDisconnected).not.toHaveBeenCalled();
      expect(connection().listenerCount("chat")).toBe(1);
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

    it("maps gifts and marks the end of a combo", () => {
      const onGift = capture(TOKIO_EVENTS.GIFT);
      const gift = {
        user: rawUser,
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
        user: mappedUser,
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
        },
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
            score: 300,
            position: 1,
          },
        ],
      });
    });
  });

  describe("fetchGifts", () => {
    const geo = { country_code: "MX", languages: "es-MX,en" };
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

    const stubGeo = (ok = true) => {
      const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
        Response.json(geo, { status: ok ? 200 : 503 }),
      );
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    };

    let fetchGifts: ReturnType<typeof vi.fn<(o: unknown) => Promise<unknown>>>;

    beforeEach(() => {
      fetchGifts = vi.fn(async () => gifts);
      live.fetchGifts = fetchGifts;
    });

    it("lists the gifts of the viewer's region and language", async () => {
      stubGeo();

      expect(await connector.fetchGifts()).toEqual({
        success: true,
        warn: undefined,
        data: [
          { id: 1, name: "Rose", coins: 1, image: "r" },
          { id: 2, name: "Lion", coins: 29999, image: "" },
        ],
      });
      expect(fetchGifts).toHaveBeenCalledWith({
        region: "MX",
        language: "es-MX",
      });
    });

    it("falls back to US English when the location lookup fails", async () => {
      stubGeo(false);

      const res = await connector.fetchGifts();

      expect(res.success).toBe(true);
      expect(res.warn).toBe("Failed to fetch user region");
      expect(fetchGifts).toHaveBeenCalledWith({
        region: "US",
        language: "en-US",
      });
    });

    it("gives up on requests that take too long", async () => {
      const fetchMock = stubGeo();

      await connector.fetchGifts();

      expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
      expect(connection().options.requestTimeoutMs).toBeGreaterThan(0);
    });

    it("asks the LIVE's connection while connected", async () => {
      stubGeo();
      await connected();

      const res = await connector.fetchGifts();

      expect(res.success).toBe(true);
      expect(live.connections).toHaveLength(1);
    });

    it("fails when TikTok does", async () => {
      stubGeo();
      fetchGifts.mockRejectedValue(new Error("Unavailable"));

      const res = await connector.fetchGifts();

      expect(res).toEqual(
        expect.objectContaining({ success: false, data: [] }),
      );
    });
  });
});
