import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  FEEDBACK_CODES,
  TOKIO_EVENTS,
} from "@/common/types";
import Logger from "@/logger";
import { connectFailure, ConnectorFailure } from "@/services/connector/common";
import { createHandler, eventSource } from "@test/handler";
import { describe, expect, it, vi } from "vitest";
import home from "./home";

const stats = { likes: 3, viewers: 2, views: 10 };
const noStats = { likes: 0, viewers: 0, views: 0 };
const noTotals = { followers: 0, shares: 0, gifts: 0, coins: 0 };

describe("home events", () => {
  describe("CONNECT", () => {
    // connect() answers with `result` after running `during`, which can
    // emit live events, as the connector does before it resolves.
    const setup = (
      result: { success: boolean; error?: ConnectorFailure },
      during = () => {},
    ) => {
      const live = eventSource();
      const connectorService = {
        ...live,
        connect: vi.fn(async () => {
          during();
          return result;
        }),
      };
      const storeManagerService = {
        updateProfileData: vi.fn(async () => true),
        getSettings: () => ({ liveStats: stats }),
      };
      const h = createHandler({ connectorService, storeManagerService });
      return { h, live, connectorService, storeManagerService };
    };

    it("saves the username and answers with the saved stats", async () => {
      const { h, connectorService, storeManagerService } = setup({
        success: true,
      });

      await h.invoke(home, APP_EVENTS.CONNECT, { username: "@streamer" });

      expect(storeManagerService.updateProfileData).toHaveBeenCalledWith({
        connector: { username: "@streamer" },
      });
      expect(connectorService.connect).toHaveBeenCalledWith("@streamer");
      expect(h.replies(APP_EVENTS_RESPONSE.CONNECTED)).toEqual([
        { success: true, stats },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "success",
          code: FEEDBACK_CODES.CONNECTED,
          message: "Connected to @streamer.",
        }),
      ]);
    });

    it("answers once when the connected event comes before connect resolves", async () => {
      const { h, live } = setup({ success: true }, () => {
        live.emit(TOKIO_EVENTS.CONNECTED, { success: true });
      });

      await h.invoke(home, APP_EVENTS.CONNECT, { username: "streamer" });

      expect(h.replies(APP_EVENTS_RESPONSE.CONNECTED)).toHaveLength(1);
      expect(h.notices).toHaveLength(1);
    });

    it("stops listening for the connected event once it's done", async () => {
      const { h, live } = setup({ success: true });

      await h.invoke(home, APP_EVENTS.CONNECT, { username: "streamer" });
      live.emit(TOKIO_EVENTS.CONNECTED, { success: true });

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
        { success: false, stats: noStats, error: failure },
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

    it("ignores a connected event that failed", async () => {
      const { h, live } = setup({ success: false }, () => {
        live.emit(TOKIO_EVENTS.CONNECTED, { success: false });
      });

      await h.invoke(home, APP_EVENTS.CONNECT, { username: "streamer" });

      expect(h.replies(APP_EVENTS_RESPONSE.CONNECTED)).toEqual([
        expect.objectContaining({ success: false }),
      ]);
    });
  });

  describe("DISCONNECT", () => {
    it("disconnects and answers empty stats", async () => {
      const disconnect = vi.fn(async () => {});
      const h = createHandler({ connectorService: { disconnect } });

      await h.invoke(home, APP_EVENTS.DISCONNECT);

      expect(disconnect).toHaveBeenCalledOnce();
      expect(h.replies(APP_EVENTS_RESPONSE.CONNECTED)).toEqual([
        { success: false, stats: noStats },
      ]);
      expect(h.notices).toEqual([]);
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
        { success: false, stats: noStats, error: failure },
      ]);
      expect(h.notices).toEqual([expect.objectContaining(failure)]);
    });
  });

  describe("IS_CONNECTED", () => {
    it("answers with the saved stats and whether the LIVE is connected", async () => {
      const h = createHandler({
        connectorService: { isConnected: () => true },
        storeManagerService: { getSettings: () => ({ liveStats: stats }) },
      });

      await h.invoke(home, APP_EVENTS.IS_CONNECTED);

      expect(h.replies(APP_EVENTS_RESPONSE.CONNECTED)).toEqual([
        { success: true, stats },
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
        storeManagerService: { getSettings: () => ({ liveStats: stats }) },
      });

      await h.invoke(home, APP_EVENTS.IS_CONNECTED);

      expect(h.replies(APP_EVENTS_RESPONSE.CONNECTED)).toEqual([
        expect.objectContaining({ success: false, stats: noStats }),
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

  describe("SET_ACTIVITY_FEED", () => {
    const feed = {
      chat: false,
      gift: true,
      follow: true,
      share: true,
      superfan: true,
      join: false,
    };

    it("saves the feed and replies with the events it still shows", async () => {
      const session = { startedAt: 1000, totals: noTotals, activity: [] };
      const updateActivityFeed = vi.fn(async () => {});
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
      const updateActiveFeatures = vi.fn();
      const clearTalk = vi.fn();
      const clearSpeech = vi.fn();
      const h = createHandler({
        storeManagerService: { updateActiveFeatures },
        ttsService: { clearTalk },
        alertsService: { clearSpeech },
      });
      return { h, updateActiveFeatures, clearTalk, clearSpeech };
    };

    it("saves the features without a notice", async () => {
      const { h, updateActiveFeatures, clearTalk, clearSpeech } = setup();

      await h.invoke(home, APP_EVENTS.ACTIVE_FEATURES, { tts: true });

      expect(updateActiveFeatures).toHaveBeenCalledWith({ tts: true });
      expect(clearTalk).not.toHaveBeenCalled();
      expect(clearSpeech).not.toHaveBeenCalled();
      expect(h.pushed(APP_EVENTS_RESPONSE.TTS_CLEAR)).toEqual([]);
      expect(h.pushed(APP_EVENTS_RESPONSE.ALERT_CLEAR)).toEqual([]);
      expect(h.notices).toEqual([]);
    });

    it("stops TTS when it's turned off", async () => {
      const { h, clearTalk, clearSpeech } = setup();

      await h.invoke(home, APP_EVENTS.ACTIVE_FEATURES, { tts: false });

      expect(clearTalk).toHaveBeenCalledOnce();
      expect(h.pushed(APP_EVENTS_RESPONSE.TTS_CLEAR)).toEqual([undefined]);
      expect(clearSpeech).not.toHaveBeenCalled();
      expect(h.pushed(APP_EVENTS_RESPONSE.ALERT_CLEAR)).toEqual([]);
    });

    it("stops the alerts when they're turned off", async () => {
      const { h, clearSpeech } = setup();

      await h.invoke(home, APP_EVENTS.ACTIVE_FEATURES, { alerts: false });

      expect(clearSpeech).toHaveBeenCalledOnce();
      expect(h.pushed(APP_EVENTS_RESPONSE.ALERT_CLEAR)).toEqual([undefined]);
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
