import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  FEEDBACK_CODES,
  Platform,
  PLATFORMS,
  PlatformStatus,
  TOKIO_EVENTS,
} from "@/common/types";
import Logger from "@/logger";
import { connectFailure, ConnectorFailure } from "@/services/connector/common";
import { createHandler, eventSource } from "@test/handler";
import { describe, expect, it, vi } from "vitest";
import home from "./home";

const stats = { likes: 3, viewers: 2, views: 10 };
// What CONNECTED says: the saved stats, and each platform's viewers
const replied = { ...stats, platformViewers: { tiktok: 2 } };
const noStats = { likes: 0, viewers: 0, views: 0, platformViewers: {} };
const noTotals = { followers: 0, shares: 0, gifts: 0, coins: 0 };
const fail = (): never => {
  throw new Error("broken");
};

describe("home events", () => {
  describe("CONNECT", () => {
    // connect() answers with `result` after running `during`, which can
    // emit live events, as the connector does before it resolves.
    const setup = (
      result: { success: boolean; error?: ConnectorFailure },
      during = () => {},
    ) => {
      const live = eventSource();
      // Connected, with a session, from the connect on, as the connector is
      let on = false;
      const connectorService = {
        ...live,
        connect: vi.fn(async () => {
          on = result.success;
          during();
          return result;
        }),
        isConnected: vi.fn(() => on),
        isReconnecting: vi.fn(() => false),
        isWaiting: () => false,
        status: vi.fn((): Partial<Record<Platform, PlatformStatus>> => ({})),
        viewers: () => ({ tiktok: 2 }),
        channel: vi.fn((_platform: Platform) => ""),
        username: "",
      };
      const profile = {
        platforms: ["tiktok"] as Platform[],
        channels: {},
      };
      const storeManagerService = {
        updateProfileData: vi.fn(async (_updates: unknown) => true),
        getProfileData: vi.fn(async () => profile),
        getTwitchAccount: () => ({ id: "twitch:1", login: "mia", key: "x" }),
        getLiveStats: () => stats,
      };
      const liveService = {
        getSession: () => ({ startedAt: on ? 1000 : null }),
      };
      const h = createHandler({
        connectorService,
        storeManagerService,
        liveService,
      });
      return { h, live, connectorService, storeManagerService, profile };
    };

    it("saves the username and answers with the saved stats", async () => {
      const { h, connectorService, storeManagerService } = setup({
        success: true,
      });

      await h.invoke(home, APP_EVENTS.CONNECT, { username: " @streamer " });

      expect(storeManagerService.updateProfileData).toHaveBeenCalledWith({
        connector: { username: "streamer" },
      });
      expect(connectorService.connect).toHaveBeenCalledWith({
        tiktok: "streamer",
      });
      expect(h.replies(APP_EVENTS_RESPONSE.CONNECTED)).toEqual([
        {
          success: true,
          live: true,
          reconnecting: false,
          waiting: false,
          platforms: {},
          stats: replied,
        },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "success",
          code: FEEDBACK_CODES.CONNECTED,
          message: "Connected to @streamer.",
        }),
      ]);
    });

    it("saves and connects a pasted LIVE link as its username", async () => {
      const { h, connectorService, storeManagerService } = setup({
        success: true,
      });

      await h.invoke(home, APP_EVENTS.CONNECT, {
        username: "https://www.tiktok.com/@mia/live",
      });

      expect(storeManagerService.updateProfileData).toHaveBeenCalledWith({
        connector: { username: "mia" },
      });
      expect(connectorService.connect).toHaveBeenCalledWith({ tiktok: "mia" });
      expect(h.notices[0].message).toBe("Connected to @mia.");
    });

    it("keeps the LIVE it's on when asked for another account", async () => {
      const { h, connectorService, storeManagerService } = setup({
        success: true,
      });
      connectorService.isConnected.mockReturnValue(true);
      connectorService.status.mockReturnValue({ tiktok: "connected" });
      connectorService.channel.mockReturnValue("first");

      await h.invoke(home, APP_EVENTS.CONNECT, { username: "second" });

      expect(storeManagerService.updateProfileData).toHaveBeenCalledWith({
        connector: { username: "first" },
      });
      expect(connectorService.connect).toHaveBeenCalledWith({
        tiktok: "first",
      });
      expect(h.notices[0].message).toBe("Connected to @first.");
    });

    it("connects but warns when the username can't be saved", async () => {
      const { h, connectorService, storeManagerService } = setup({
        success: true,
      });
      storeManagerService.updateProfileData.mockResolvedValue(false);

      await h.invoke(home, APP_EVENTS.CONNECT, { username: "streamer" });

      expect(connectorService.connect).toHaveBeenCalledWith({
        tiktok: "streamer",
      });
      expect(h.replies(APP_EVENTS_RESPONSE.CONNECTED)).toEqual([
        {
          success: true,
          live: true,
          reconnecting: false,
          waiting: false,
          platforms: {},
          stats: replied,
        },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "warning",
          code: FEEDBACK_CODES.SETTINGS_SAVE_FAILED,
        }),
        expect.objectContaining({ code: FEEDBACK_CODES.CONNECTED }),
      ]);
    });

    it("answers once when the connected event comes before connect resolves", async () => {
      const { h, live } = setup({ success: true }, () => {
        live.emit(TOKIO_EVENTS.CONNECTED, undefined);
      });

      await h.invoke(home, APP_EVENTS.CONNECT, { username: "streamer" });

      expect(h.replies(APP_EVENTS_RESPONSE.CONNECTED)).toHaveLength(1);
      expect(h.notices).toHaveLength(1);
    });

    it("stops listening for the connected event once it's done", async () => {
      const { h, live } = setup({ success: true });

      await h.invoke(home, APP_EVENTS.CONNECT, { username: "streamer" });
      live.emit(TOKIO_EVENTS.CONNECTED, undefined);

      expect(live.listeners(TOKIO_EVENTS.CONNECTED)).toBe(0);
      expect(h.replies(APP_EVENTS_RESPONSE.CONNECTED)).toHaveLength(1);
    });

    it("replies empty stats when it can't connect, without logging it again", async () => {
      const error = vi.spyOn(Logger, "error");
      const { h, live } = setup({
        success: false,
        error: connectFailure("unknown", "Something broke"),
      });

      await h.invoke(home, APP_EVENTS.CONNECT, { username: "streamer" });

      const failure = {
        code: FEEDBACK_CODES.CONNECT_FAILED,
        message: "Unable to connect to @streamer. Try again in a moment.",
      };
      expect(h.replies(APP_EVENTS_RESPONSE.CONNECTED)).toEqual([
        { success: false, live: false, stats: noStats, error: failure },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({ level: "error", ...failure }),
      ]);
      expect(live.listeners(TOKIO_EVENTS.CONNECTED)).toBe(0);
      // The connector service logs its own failures
      expect(error).not.toHaveBeenCalled();
    });

    it.each([
      [
        connectFailure("offline", ""),
        "@streamer isn't LIVE right now. Connect once the LIVE has started.",
      ],
      [
        connectFailure("notFound", ""),
        "Couldn't find @streamer on TikTok. Check the username.",
      ],
      [
        connectFailure("rateLimited", "", { retryAfterSeconds: 42 }),
        "Your Euler Stream API key hit its rate limit. Try again in 42 seconds.",
      ],
      [
        connectFailure("rateLimited", ""),
        "Your Euler Stream API key hit its rate limit. Try again in a minute.",
      ],
      [
        connectFailure("noKey", ""),
        "Tokio needs your Euler Stream API key to connect. Add it in Settings.",
      ],
      [
        connectFailure("badKey", ""),
        "Euler Stream didn't accept your API key. Check it in Settings.",
      ],
      [
        connectFailure("premium", ""),
        "Your Euler Stream plan doesn't include this connection. Check your plan on Euler Stream.",
      ],
      [
        connectFailure("sign", ""),
        "Euler Stream couldn't sign the connection. Try again in a moment.",
      ],
      [
        connectFailure("network", ""),
        "Unable to reach TikTok. Check your internet connection.",
      ],
    ])("says what to do when it fails (%#)", async (error, message) => {
      const { h } = setup({ success: false, error });

      await h.invoke(home, APP_EVENTS.CONNECT, { username: "streamer" });

      expect(h.notices).toEqual([
        expect.objectContaining({
          code: FEEDBACK_CODES.CONNECT_FAILED,
          message,
        }),
      ]);
    });
    it("saves the channel typed over the profile's others", async () => {
      const { h, profile, storeManagerService } = setup({ success: true });
      profile.platforms = ["youtube"];
      profile.channels = { youtube: "old", other: "kept" };

      await h.invoke(home, APP_EVENTS.CONNECT, {
        username: "",
        channels: { youtube: "@new" },
      });

      expect(storeManagerService.updateProfileData).toHaveBeenCalledWith({
        channels: { youtube: "@new", other: "kept" },
      });
    });
    it.each([
      [
        connectFailure("noChat", ""),
        "@streamer",
        "The chat is off on @streamer's LIVE. Turn it on in YouTube Studio, then connect again.",
      ],
      [
        connectFailure("rateLimited", "", { retryAfterSeconds: 42 }),
        "@streamer",
        "YouTube is limiting Tokio's requests. Try again in a few minutes.",
      ],
      [
        connectFailure("notFound", ""),
        "@streamer",
        "Couldn't find @streamer on YouTube. Check the username.",
      ],
      [
        connectFailure("offline", ""),
        "https://youtube.com/watch?v=abc",
        "https://youtube.com/watch?v=abc isn't LIVE right now. Connect once the LIVE has started.",
      ],
    ])(
      "says what YouTube's failures mean (%#)",
      async (error, channel, message) => {
        const { h, connectorService, profile } = setup({
          success: false,
          error,
        });
        profile.platforms = ["youtube"];

        await h.invoke(home, APP_EVENTS.CONNECT, {
          username: "",
          channels: { youtube: channel },
        });

        expect(connectorService.connect).toHaveBeenCalledWith({
          youtube: channel.replace(/^@/, ""),
        });
        expect(h.notices).toEqual([
          expect.objectContaining({
            code: FEEDBACK_CODES.CONNECT_FAILED,
            message,
          }),
        ]);
      },
    );

    it("connects only the platforms asked for, as a row's Connect does", async () => {
      const { h, connectorService, profile } = setup({ success: true });
      profile.platforms = ["tiktok", "kick"];

      await h.invoke(home, APP_EVENTS.CONNECT, {
        username: "@streamer",
        channels: { kick: "westcol" },
        platforms: ["kick"],
      });

      expect(connectorService.connect).toHaveBeenCalledWith({
        kick: "westcol",
      });
    });

    it.each([
      [
        connectFailure("rateLimited", ""),
        "Kick is limiting Tokio's requests. Try again in a few minutes.",
      ],
      [
        connectFailure("notFound", ""),
        "Couldn't find @streamer on Kick. Check the username.",
      ],
    ])("says what Kick's failures mean (%#)", async (error, message) => {
      const { h, connectorService, profile } = setup({ success: false, error });
      profile.platforms = ["kick"];

      await h.invoke(home, APP_EVENTS.CONNECT, {
        username: "",
        channels: { kick: "@streamer" },
      });

      expect(connectorService.connect).toHaveBeenCalledWith({
        kick: "streamer",
      });
      expect(h.notices).toEqual([expect.objectContaining({ message })]);
    });
  });

  describe("CONNECT on several platforms", () => {
    const both = (
      results: Partial<
        Record<Platform, { success: boolean; error?: ConnectorFailure }>
      >,
    ) => {
      const live = eventSource();
      const status: Partial<Record<Platform, PlatformStatus>> = {};
      const connectorService = {
        ...live,
        connect: vi.fn(
          async (
            channels: Partial<Record<Platform, string>>,
            onResult?: (
              platform: Platform,
              res: { success: boolean; error?: ConnectorFailure },
            ) => void,
          ) => {
            for (const platform of PLATFORMS.filter((p) => p in channels)) {
              const res = results[platform] ?? { success: true };
              if (res.success) {
                status[platform] = "connected";
                // The session starts with the first one up
                if (Object.keys(status).length === 1) {
                  live.emit(TOKIO_EVENTS.CONNECTED, undefined);
                }
              }
              onResult?.(platform, res);
            }
            return { success: true };
          },
        ),
        isConnected: () => Object.keys(status).length > 0,
        isReconnecting: () => false,
        isWaiting: () => false,
        status: () => ({ ...status }),
        viewers: () => ({ tiktok: 2 }),
        channel: (_platform: Platform) => "",
        username: "",
      };
      const storeManagerService = {
        updateProfileData: vi.fn(async (_updates: unknown) => true),
        getProfileData: async () => ({
          platforms: ["tiktok", "twitch"] as Platform[],
          channels: {},
        }),
        getTwitchAccount: () => ({ id: "twitch:1", login: "mia", key: "x" }),
        getLiveStats: () => stats,
      };
      const liveService = {
        getSession: () => ({
          startedAt: Object.keys(status).length > 0 ? 1000 : null,
        }),
      };
      const h = createHandler({
        connectorService,
        storeManagerService,
        liveService,
      });
      return { h, live, connectorService, storeManagerService, status };
    };

    it("connects every platform, each with its own notice", async () => {
      const { h, connectorService, storeManagerService } = both({});

      await h.invoke(home, APP_EVENTS.CONNECT, {
        username: "@streamer",
        channels: {},
      });

      expect(connectorService.connect).toHaveBeenCalledWith(
        { tiktok: "streamer", twitch: "mia" },
        expect.any(Function),
      );
      expect(storeManagerService.updateProfileData).toHaveBeenCalledWith({
        connector: { username: "streamer" },
        channels: {},
      });
      // The session's start, then each platform's result
      const replies = h.replies(APP_EVENTS_RESPONSE.CONNECTED);
      expect(replies).toHaveLength(3);
      expect(replies[0]).toMatchObject({
        success: true,
        live: true,
        platforms: { tiktok: "connected" },
      });
      expect(replies[2]).toMatchObject({
        platforms: { tiktok: "connected", twitch: "connected" },
      });
      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "success",
          code: FEEDBACK_CODES.CONNECTED,
          message: "Connected to @streamer on TikTok.",
        }),
        expect.objectContaining({
          level: "success",
          message: "Connected to @mia on Twitch.",
        }),
      ]);
    });

    it("says why one failed while the other connects", async () => {
      const { h } = both({
        twitch: { success: false, error: connectFailure("noKey", "") },
      });

      await h.invoke(home, APP_EVENTS.CONNECT, { username: "streamer" });

      expect(h.notices).toEqual([
        expect.objectContaining({
          message: "Connected to @streamer on TikTok.",
        }),
        expect.objectContaining({
          level: "error",
          code: FEEDBACK_CODES.CONNECT_FAILED,
          message:
            "Tokio needs your Twitch account to connect. Sign in with Twitch in Settings.",
        }),
      ]);
      expect(h.replies(APP_EVENTS_RESPONSE.CONNECTED).at(-1)).toMatchObject({
        success: true,
        platforms: { tiktok: "connected" },
      });
    });

    it("replies the state without a failure of its own when all fail", async () => {
      const { h } = both({
        tiktok: { success: false, error: connectFailure("offline", "") },
        twitch: { success: false, error: connectFailure("badKey", "") },
      });

      await h.invoke(home, APP_EVENTS.CONNECT, { username: "streamer" });

      expect(h.notices.map((n) => n.message)).toEqual([
        "@streamer isn't LIVE on TikTok right now. Connect once the LIVE has started.",
        "Twitch signed Tokio out. Sign in with Twitch again in Settings.",
      ]);
      expect(h.replies(APP_EVENTS_RESPONSE.CONNECTED)).toEqual([
        expect.objectContaining({ success: false, live: false }),
        expect.objectContaining({ success: false, live: false }),
      ]);
    });

    it("tells nothing again for a platform that was already up", async () => {
      const { h, status } = both({});
      status.tiktok = "connected";

      await h.invoke(home, APP_EVENTS.CONNECT, { username: "streamer" });

      expect(h.notices.map((n) => n.message)).toEqual([
        "Connected to @mia on Twitch.",
      ]);
    });

    it.each([
      [
        connectFailure("network", ""),
        "Unable to reach Twitch. Check your internet connection.",
      ],
      [
        connectFailure("notFound", ""),
        "Couldn't find @mia on Twitch. Check the username.",
      ],
      [
        connectFailure("rateLimited", ""),
        "Twitch is limiting Tokio's requests. Try again in a few minutes.",
      ],
      [
        connectFailure("premium", ""),
        "Unable to connect to @mia on Twitch. Try again in a moment.",
      ],
    ])("names the platform a failure is from (%#)", async (error, message) => {
      const { h } = both({ twitch: { success: false, error } });

      await h.invoke(home, APP_EVENTS.CONNECT, { username: "streamer" });

      expect(h.notices.at(-1)?.message).toBe(message);
    });
  });

  describe("SET_PLATFORMS", () => {
    const setup = (
      on: Partial<Record<Platform, PlatformStatus>> = {},
      saved = true,
    ) => {
      const profile = { platforms: ["tiktok"] as Platform[] };
      const storeManagerService = {
        updateProfileData: vi.fn(async (_updates: unknown) => saved),
        getProfileData: async () => profile,
      };
      const timerService = { setPlatforms: vi.fn((_p: Platform[]) => {}) };
      const h = createHandler({
        connectorService: { status: () => on },
        storeManagerService,
        timerService,
      });
      return { h, storeManagerService, timerService };
    };

    it("saves the known ones in Home's order, with no notice", async () => {
      const { h, storeManagerService, timerService } = setup();

      await h.invoke(home, APP_EVENTS.SET_PLATFORMS, {
        platforms: [
          "twitch",
          // A newer Tokio's
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion
          "trovo" as Platform,
          "tiktok",
          "twitch",
        ],
      });

      expect(storeManagerService.updateProfileData).toHaveBeenCalledWith({
        platforms: ["tiktok", "twitch"],
      });
      expect(h.replies(APP_EVENTS_RESPONSE.SET_PLATFORMS)).toEqual([
        { success: true, platforms: ["tiktok", "twitch"] },
      ]);
      expect(timerService.setPlatforms).toHaveBeenCalledWith([
        "tiktok",
        "twitch",
      ]);
      expect(h.notices).toEqual([]);
    });

    it("adds a platform while live, and keeps one that's on", async () => {
      const { h, storeManagerService } = setup({ tiktok: "connected" });

      await h.invoke(home, APP_EVENTS.SET_PLATFORMS, { platforms: ["kick"] });

      expect(storeManagerService.updateProfileData).toHaveBeenCalledWith({
        platforms: ["tiktok", "kick"],
      });
      expect(h.replies(APP_EVENTS_RESPONSE.SET_PLATFORMS)).toEqual([
        { success: true, platforms: ["tiktok", "kick"] },
      ]);
      expect(h.notices).toEqual([]);
    });

    it("says when the platforms can't be saved", async () => {
      vi.spyOn(Logger, "error");
      const { h, timerService } = setup({}, false);

      await h.invoke(home, APP_EVENTS.SET_PLATFORMS, { platforms: ["twitch"] });

      expect(h.notices).toEqual([
        expect.objectContaining({ code: FEEDBACK_CODES.SETTINGS_SAVE_FAILED }),
      ]);
      expect(timerService.setPlatforms).not.toHaveBeenCalled();
      await vi.waitFor(() =>
        expect(h.replies(APP_EVENTS_RESPONSE.SET_PLATFORMS)).toEqual([
          expect.objectContaining({ success: false, platforms: ["tiktok"] }),
        ]),
      );
    });
  });

  describe("DISCONNECT", () => {
    it("disconnects and answers empty stats", async () => {
      const disconnect = vi.fn(async () => {});
      const h = createHandler({ connectorService: { disconnect } });

      await h.invoke(home, APP_EVENTS.DISCONNECT);

      expect(disconnect).toHaveBeenCalledOnce();
      expect(h.replies(APP_EVENTS_RESPONSE.CONNECTED)).toEqual([
        { success: false, live: false, stats: noStats },
      ]);
      expect(h.notices).toEqual([]);
    });

    it("disconnects one platform and answers what main holds", async () => {
      const disconnect = vi.fn(async (_platform?: Platform) => {});
      const h = createHandler({
        connectorService: {
          disconnect,
          isConnected: () => true,
          isReconnecting: () => false,
          isWaiting: () => false,
          status: () => ({ twitch: "connected" }),
          viewers: () => ({ twitch: 1 }),
        },
        liveService: { getSession: () => ({ startedAt: 1000 }) },
        storeManagerService: { getLiveStats: () => stats },
      });

      await h.invoke(home, APP_EVENTS.DISCONNECT, { platform: "kick" });

      expect(disconnect).toHaveBeenCalledWith("kick");
      expect(h.replies(APP_EVENTS_RESPONSE.CONNECTED)).toEqual([
        expect.objectContaining({
          success: true,
          live: true,
          platforms: { twitch: "connected" },
        }),
      ]);
    });

    it("replies and notifies when disconnecting fails", async () => {
      vi.spyOn(Logger, "error");
      const h = createHandler({
        connectorService: {
          disconnect: async () => {
            throw new Error("socket");
          },
        },
      });

      await h.invoke(home, APP_EVENTS.DISCONNECT);

      const failure = {
        code: FEEDBACK_CODES.DISCONNECT_FAILED,
        message: "Unable to disconnect from the LIVE.",
      };
      expect(h.replies(APP_EVENTS_RESPONSE.CONNECTED)).toEqual([
        { success: false, live: false, stats: noStats, error: failure },
      ]);
      expect(h.notices).toEqual([expect.objectContaining(failure)]);
    });
  });

  describe("IS_CONNECTED", () => {
    // A session starts once the connect worked
    const connected = (
      startedAt: number | null,
      { reconnecting = false, waiting = false } = {},
    ) => ({
      connectorService: {
        isConnected: () => true,
        isReconnecting: () => reconnecting,
        isWaiting: () => waiting,
        status: () => ({}),
        viewers: () => ({ tiktok: 2 }),
      },
      liveService: { getSession: () => ({ startedAt }) },
      storeManagerService: { getLiveStats: () => stats },
    });

    it("answers with the saved stats and whether the LIVE is connected", async () => {
      const h = createHandler(connected(1000));

      await h.invoke(home, APP_EVENTS.IS_CONNECTED);

      expect(h.replies(APP_EVENTS_RESPONSE.CONNECTED)).toEqual([
        {
          success: true,
          live: true,
          reconnecting: false,
          waiting: false,
          platforms: {},
          stats: replied,
        },
      ]);
    });

    it("locks the profile but isn't LIVE while connecting", async () => {
      const h = createHandler(connected(null));

      await h.invoke(home, APP_EVENTS.IS_CONNECTED);

      expect(h.replies(APP_EVENTS_RESPONSE.CONNECTED)).toEqual([
        {
          success: true,
          live: false,
          reconnecting: false,
          waiting: false,
          platforms: {},
          stats: replied,
        },
      ]);
    });

    it("says when the connection is coming back, keeping the LIVE", async () => {
      const h = createHandler(connected(1000, { reconnecting: true }));

      await h.invoke(home, APP_EVENTS.IS_CONNECTED);

      expect(h.replies(APP_EVENTS_RESPONSE.CONNECTED)).toEqual([
        {
          success: true,
          live: true,
          reconnecting: true,
          waiting: false,
          platforms: {},
          stats: replied,
        },
      ]);
    });

    it("says when it looks for a LIVE that stopped, with no session", async () => {
      const h = createHandler(connected(null, { waiting: true }));

      await h.invoke(home, APP_EVENTS.IS_CONNECTED);

      expect(h.replies(APP_EVENTS_RESPONSE.CONNECTED)).toEqual([
        {
          success: true,
          live: false,
          reconnecting: false,
          waiting: true,
          platforms: {},
          stats: replied,
        },
      ]);
    });

    it("replies without a notice when it fails", async () => {
      vi.spyOn(Logger, "error");
      const h = createHandler({
        connectorService: {
          isConnected: () => {
            throw new Error("no provider");
          },
        },
        storeManagerService: { getLiveStats: () => stats },
      });

      await h.invoke(home, APP_EVENTS.IS_CONNECTED);

      expect(h.replies(APP_EVENTS_RESPONSE.CONNECTED)).toEqual([
        expect.objectContaining({
          success: false,
          live: false,
          stats: noStats,
        }),
      ]);
      expect(h.notices).toEqual([]);
    });
  });

  describe("GET_LIVE_SESSION", () => {
    it("replies with the session without a notice", async () => {
      const session = {
        startedAt: 1000,
        totals: { followers: 1, shares: 0, gifts: 0, coins: 0 },
        activity: [],
      };
      const h = createHandler({ liveService: { getSession: () => session } });

      await h.invoke(home, APP_EVENTS.GET_LIVE_SESSION);

      expect(h.replies(APP_EVENTS_RESPONSE.LIVE_SESSION)).toEqual([
        { data: session },
      ]);
      expect(h.notices).toEqual([]);
    });
  });

  describe("GET_LIVE_GIFTERS", () => {
    it("replies with this LIVE's top gifters without a notice", async () => {
      const gifter = {
        userId: "1",
        username: "Leo",
        handle: "leo",
        picture: "",
        live: { coins: 1000, gifts: 1 },
        allTime: { coins: 5000, gifts: 9 },
        giftedAt: 1000,
      };
      const h = createHandler({
        historyService: {
          top: () => ({ live: [gifter], allTime: [] }),
          topByPlatform: () => ({ tiktok: [gifter] }),
        },
      });

      await h.invoke(home, APP_EVENTS.GET_LIVE_GIFTERS);

      expect(h.replies(APP_EVENTS_RESPONSE.LIVE_GIFTERS)).toEqual([
        { data: [gifter], byPlatform: { tiktok: [gifter] } },
      ]);
      expect(h.notices).toEqual([]);
    });
  });

  describe("GET_SONGS", () => {
    it("replies with the request queue without a notice", async () => {
      const songs = [
        {
          title: "Blinding Lights",
          thumbnail: "",
          playing: true,
          played: false,
        },
      ];
      const h = createHandler({ musicService: { songs: () => songs } });

      await h.invoke(home, APP_EVENTS.GET_SONGS);

      expect(h.replies(APP_EVENTS_RESPONSE.SONGS)).toEqual([{ data: songs }]);
      expect(h.notices).toEqual([]);
    });
  });

  it.each([
    [APP_EVENTS.GET_LIVE_GIFTERS, { historyService: { top: () => fail() } }],
    [APP_EVENTS.GET_SONGS, { musicService: { songs: () => fail() } }],
  ] as const)(
    "sends no reply and no notice when %s fails",
    async (event, services) => {
      const error = vi.spyOn(Logger, "error");
      const h = createHandler(services);

      await h.invoke(home, event);

      expect(h.sent()).toEqual([]);
      expect(h.notices).toEqual([]);
      expect(error).toHaveBeenCalled();
    },
  );

  describe("SET_ACTIVITY_FEED", () => {
    const feed = {
      chat: false,
      gift: true,
      follow: true,
      share: true,
      superfan: true,
      join: false,
      sub: true,
      giftsub: true,
      cheer: true,
      raid: true,
      redeem: true,
      superchat: true,
    };

    it("saves the feed and replies with the events it still shows", async () => {
      const session = { startedAt: 1000, totals: noTotals, activity: [] };
      const updateActivityFeed = vi.fn(async () => true);
      const setFeed = vi.fn();
      const h = createHandler({
        storeManagerService: { updateActivityFeed },
        liveService: { setFeed, getSession: () => session },
      });

      await h.invoke(home, APP_EVENTS.SET_ACTIVITY_FEED, { feed });

      expect(updateActivityFeed).toHaveBeenCalledWith(feed);
      expect(setFeed).toHaveBeenCalledWith(feed);
      expect(h.sent()).toEqual([
        [APP_EVENTS_RESPONSE.LIVE_SESSION, { data: session }],
        [
          "notice",
          expect.objectContaining({
            level: "success",
            code: FEEDBACK_CODES.ACTIVITY_FEED_UPDATED,
            message: "Activity feed updated.",
          }),
        ],
      ]);
    });

    it("shows the feed it changed, and says it wasn't saved", async () => {
      const session = { startedAt: 1000, totals: noTotals, activity: [] };
      const h = createHandler({
        storeManagerService: { updateActivityFeed: async () => false },
        liveService: { setFeed: vi.fn(), getSession: () => session },
      });

      await h.invoke(home, APP_EVENTS.SET_ACTIVITY_FEED, { feed });

      expect(h.sent()).toEqual([
        [APP_EVENTS_RESPONSE.LIVE_SESSION, { data: session }],
        [
          "notice",
          expect.objectContaining({
            level: "error",
            code: FEEDBACK_CODES.SETTINGS_SAVE_FAILED,
            message:
              "Tokio couldn't save the change. Check the logs folder for details.",
          }),
        ],
      ]);
    });

    it("leaves the feed as it was when saving fails", async () => {
      vi.spyOn(Logger, "error");
      const setFeed = vi.fn();
      const h = createHandler({
        storeManagerService: {
          updateActivityFeed: async () => {
            throw new Error("not initialized");
          },
        },
        liveService: { setFeed },
      });

      await h.invoke(home, APP_EVENTS.SET_ACTIVITY_FEED, { feed });

      expect(setFeed).not.toHaveBeenCalled();
      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "error",
          source: "system",
          code: FEEDBACK_CODES.SETTINGS_SAVE_FAILED,
          message: "Unable to save the activity feed.",
        }),
      ]);
    });
  });

  describe("ACTIVE_FEATURES", () => {
    const setup = () => {
      const updateActiveFeatures = vi.fn(async () => true);
      const clearTalk = vi.fn();
      const clearAlerts = vi.fn();
      const clearMusic = vi.fn();
      const h = createHandler({
        storeManagerService: { updateActiveFeatures },
        ttsService: { clearTalk },
        alertsService: { clear: clearAlerts },
        musicService: { clearHandler: clearMusic },
      });
      return { h, updateActiveFeatures, clearTalk, clearAlerts, clearMusic };
    };

    it("saves the features without a notice", async () => {
      const { h, updateActiveFeatures, clearTalk, clearAlerts, clearMusic } =
        setup();

      await h.invoke(home, APP_EVENTS.ACTIVE_FEATURES, {
        tts: true,
        music: true,
      });

      expect(updateActiveFeatures).toHaveBeenCalledWith({
        tts: true,
        music: true,
      });
      expect(clearTalk).not.toHaveBeenCalled();
      expect(clearAlerts).not.toHaveBeenCalled();
      expect(clearMusic).not.toHaveBeenCalled();
      expect(h.pushed(APP_EVENTS_RESPONSE.TTS_CLEAR)).toEqual([]);
      expect(h.pushed(APP_EVENTS_RESPONSE.ALERT_CLEAR)).toEqual([]);
      expect(h.notices).toEqual([]);
    });

    it("stops TTS when it's turned off", async () => {
      const { h, clearTalk, clearAlerts } = setup();

      await h.invoke(home, APP_EVENTS.ACTIVE_FEATURES, { tts: false });

      expect(clearTalk).toHaveBeenCalledOnce();
      expect(h.pushed(APP_EVENTS_RESPONSE.TTS_CLEAR)).toEqual([undefined]);
      expect(clearAlerts).not.toHaveBeenCalled();
      expect(h.pushed(APP_EVENTS_RESPONSE.ALERT_CLEAR)).toEqual([]);
    });

    it("stops the alerts when they're turned off", async () => {
      const { h, clearAlerts } = setup();

      await h.invoke(home, APP_EVENTS.ACTIVE_FEATURES, { alerts: false });

      expect(clearAlerts).toHaveBeenCalledOnce();
      expect(h.pushed(APP_EVENTS_RESPONSE.ALERT_CLEAR)).toEqual([undefined]);
    });

    it("drops the song requests when music is turned off", async () => {
      const { h, clearMusic } = setup();

      await h.invoke(home, APP_EVENTS.ACTIVE_FEATURES, { music: false });

      expect(clearMusic).toHaveBeenCalledOnce();
    });

    it("reports a failure as the system's", async () => {
      vi.spyOn(Logger, "error");
      const h = createHandler({
        storeManagerService: {
          updateActiveFeatures: () => {
            throw new Error("not initialized");
          },
        },
      });

      await h.invoke(home, APP_EVENTS.ACTIVE_FEATURES, { music: true });

      expect(h.notices).toEqual([
        expect.objectContaining({
          source: "system",
          code: FEEDBACK_CODES.FEATURES_UPDATE_FAILED,
        }),
      ]);
    });
  });
});
