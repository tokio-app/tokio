import { TOKIO_EVENTS } from "@/common/types";
import { WebcastEvent } from "tiktok-live-connector";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TikTokLiveConnector } from "./index";

// Stands in for TikTok: tests emit raw webcast events on the last connection.
const live = vi.hoisted(() => ({
  connections: [] as {
    username: string;
    options: any;
    isConnected: boolean;
    emit: (event: string, data?: unknown) => boolean;
  }[],
  connect: { fail: false },
}));

vi.mock("tiktok-live-connector", async () => {
  const { EventEmitter } = await import("node:events");
  class TikTokLiveConnection extends EventEmitter {
    isConnected = false;
    constructor(
      public username: string,
      public options: unknown,
    ) {
      super();
      live.connections.push(this);
    }
    async connect() {
      if (live.connect.fail) throw new Error("LIVE has ended");
      this.isConnected = true;
      return { isConnected: true };
    }
    async disconnect() {
      this.isConnected = false;
    }
  }
  const names = [
    "SHARE",
    "FOLLOW",
    "CHAT",
    "GIFT",
    "LIKE",
    "ENVELOPE",
    "SUPER_FAN_BOX",
    "SUPER_FAN",
    "MEMBER",
    "SUPER_FAN_JOIN",
    "ROOM_USER",
    "STREAM_END",
  ];
  const WebcastEvent = Object.fromEntries(names.map((n) => [n, n]));
  return { TikTokLiveConnection, WebcastEvent };
});

const rawUser = {
  nickname: "Viewer",
  displayId: "viewer",
  avatarThumb: { urlList: ["https://img/1.png"] },
  badgeList: [
    {
      combine: { icon: { uri: "webcast/fans_badge_12" } },
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

  // connect() waits a second before listening to events.
  const connected = async () => {
    const res = connector.connect("@streamer", "session-id");
    await vi.advanceTimersByTimeAsync(1000);
    return res;
  };

  const capture = (event: TOKIO_EVENTS) => {
    const listener = vi.fn();
    connector.on(event, listener);
    return listener;
  };

  beforeEach(() => {
    vi.useFakeTimers();
    live.connections.length = 0;
    live.connect.fail = false;
    connector = new TikTokLiveConnector();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("connect", () => {
    it("needs a username", async () => {
      const onConnected = capture(TOKIO_EVENTS.CONNECTED);

      const res = await connector.connect("@");

      expect(res.success).toBe(false);
      expect(onConnected).toHaveBeenCalledWith(
        expect.objectContaining({ success: false }),
      );
      expect(live.connections).toEqual([]);
    });

    it("connects without the @ and with the session cookie", async () => {
      const onConnected = capture(TOKIO_EVENTS.CONNECTED);

      expect(await connected()).toEqual({ success: true });

      expect(connection().username).toBe("streamer");
      expect(connection().options.session.cookie.value.sessionId).toBe(
        "session-id",
      );
      expect(onConnected).toHaveBeenCalledWith({ success: true });
      expect(connector.isConnected()).toBe(true);
    });

    it("reports a failed connection", async () => {
      live.connect.fail = true;
      const onConnected = capture(TOKIO_EVENTS.CONNECTED);

      const res = await connector.connect("streamer");

      expect(res.success).toBe(false);
      expect(res.error?.message).toBe("LIVE has ended");
      expect(onConnected).toHaveBeenCalledWith(res);
    });

    it("disconnects when the stream ends", async () => {
      await connected();
      const onDisconnected = capture(TOKIO_EVENTS.DISCONNECTED);

      connection().emit(WebcastEvent.STREAM_END);
      await vi.advanceTimersByTimeAsync(0);

      expect(connector.isConnected()).toBe(false);
      expect(onDisconnected).toHaveBeenCalledExactlyOnceWith({
        reason: "ended",
      });
    });

    it("disconnects without a reason when asked to", async () => {
      await connected();
      const onDisconnected = capture(TOKIO_EVENTS.DISCONNECTED);

      await connector.disconnect();
      await connector.disconnect();

      expect(onDisconnected).toHaveBeenCalledExactlyOnceWith(undefined);
    });
  });

  describe("events", () => {
    beforeEach(async () => {
      await connected();
    });

    it("maps a chat message with the user's roles and emotes", () => {
      const onChat = capture(TOKIO_EVENTS.CHAT);

      connection().emit(WebcastEvent.CHAT, {
        user: rawUser,
        userIdentity: { isFollowerOfAnchor: true, isModeratorOfAnchor: true },
        content: "hello",
        contentLanguage: "en",
        emotes: [
          { index: 5, emote: { emoteId: "e1", image: { urlList: ["u"] } } },
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
        giftId: 5655,
        gift: {
          type: 1,
          name: "Rose",
          diamondCount: 1,
          image: { urlList: ["g"] },
        },
        repeatCount: 3,
      };

      connection().emit(WebcastEvent.GIFT, { ...gift, repeatEnd: 0 });
      connection().emit(WebcastEvent.GIFT, { ...gift, repeatEnd: 1 });

      expect(onGift.mock.calls.map(([e]) => e.gift.repeatEnd)).toEqual([
        false,
        true,
      ]);
      expect(onGift).toHaveBeenLastCalledWith({
        user: mappedUser,
        gift: {
          id: 5655,
          type: 1,
          name: "Rose",
          repeatEnd: true,
          coins: 1,
          comboCount: 3,
          image: "g",
        },
      });
    });

    it("maps likes, follows, shares and members", () => {
      const onLike = capture(TOKIO_EVENTS.LIKE);
      const onFollow = capture(TOKIO_EVENTS.FOLLOW);
      const onShare = capture(TOKIO_EVENTS.SHARE);
      const onMember = capture(TOKIO_EVENTS.MEMBER_JOIN);

      connection().emit(WebcastEvent.LIKE, {
        user: rawUser,
        count: 15,
        total: "1200",
      });
      connection().emit(WebcastEvent.FOLLOW, { user: rawUser });
      connection().emit(WebcastEvent.SHARE, { user: rawUser });
      connection().emit(WebcastEvent.MEMBER, { user: rawUser });

      expect(onLike).toHaveBeenCalledWith({
        user: mappedUser,
        likeCount: 15,
        totalLikes: 1200,
      });
      expect(onFollow).toHaveBeenCalledWith({ user: mappedUser });
      expect(onShare).toHaveBeenCalledWith({ user: mappedUser, shareCount: 0 });
      expect(onMember).toHaveBeenCalledWith({ user: mappedUser });
    });

    it("fills in missing user data", () => {
      const onFollow = capture(TOKIO_EVENTS.FOLLOW);

      connection().emit(WebcastEvent.FOLLOW, {});

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

      connection().emit(WebcastEvent.ROOM_USER, {
        total: "40",
        totalUser: "900",
        ranks: [{ user: rawUser, score: "300", rank: "1" }],
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
      data: {
        gifts: [
          { id: 1, name: "Rose", diamond_count: 1, image: { url_list: ["r"] } },
          { id: 1, name: "Rose", diamond_count: 1, image: { url_list: ["r"] } },
          { id: 2, name: "Lion", diamond_count: 29999 },
        ],
      },
    };

    const stubFetch = (geoOk = true) => {
      const fetchMock = vi.fn(async (url: string, _init?: RequestInit) =>
        url.includes("ipapi")
          ? Response.json(geo, { status: geoOk ? 200 : 503 })
          : Response.json(gifts),
      );
      vi.stubGlobal("fetch", fetchMock);
      return fetchMock;
    };

    it("lists each gift once", async () => {
      stubFetch();

      expect(await connector.fetchGifts()).toEqual({
        success: true,
        warn: undefined,
        data: [
          { id: 1, name: "Rose", coins: 1, image: "r" },
          { id: 2, name: "Lion", coins: 29999, image: undefined },
        ],
      });
    });

    it("falls back to US English when the location lookup fails", async () => {
      const fetchMock = stubFetch(false);

      const res = await connector.fetchGifts();

      expect(res.success).toBe(true);
      expect(res.warn).toBe("Failed to fetch user region");
      const url = new URL(fetchMock.mock.calls[1][0]);
      expect([...url.searchParams.values()]).toEqual(
        expect.arrayContaining(["US", "en-US"]),
      );
    });

    it("gives up on requests that take too long", async () => {
      const fetchMock = stubFetch();

      await connector.fetchGifts();

      for (const [, init] of fetchMock.mock.calls) {
        expect(init?.signal).toBeInstanceOf(AbortSignal);
      }
    });

    it("asks for the gifts in the viewer's region and language", async () => {
      const fetchMock = stubFetch();

      await connector.fetchGifts();

      const url = new URL(fetchMock.mock.calls[1][0]);
      expect(url.searchParams.get("region")).toBe("MX");
      expect(url.searchParams.get("app_language")).toBe("es-MX");
    });

    it("fails when TikTok does", async () => {
      vi.stubGlobal("fetch", async (url: string) =>
        url.includes("ipapi")
          ? Response.json(geo)
          : new Response("", { status: 500 }),
      );

      const res = await connector.fetchGifts();

      expect(res).toEqual(
        expect.objectContaining({ success: false, data: [] }),
      );
    });
  });
});
