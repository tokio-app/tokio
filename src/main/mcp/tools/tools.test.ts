import { TimerSettingsSchema } from "@/common/schemas";
import {
  APP_EVENTS_RESPONSE,
  type Gifter,
  type Platform,
} from "@/common/types";
import lives from "@/events/pages/lives";
import tools from "@/events/pages/tools";
import { createHandler } from "@test/handler";
import { mcpClient } from "@test/mcp";
import { describe, expect, it, vi } from "vitest";

const store = {
  getSettings: () => ({ activeProfile: { name: "Main", file: "main.json" } }),
};

describe("tools MCP tools", () => {
  describe("timer", () => {
    const setup = (status: "idle" | "running" = "idle") => {
      const timer = {
        settings: TimerSettingsSchema.parse({}),
        state: { status, remaining: 3_600_000 },
      };
      const timerService = {
        get: () => timer,
        setSettings: vi.fn((settings: typeof timer.settings) => {
          timer.settings = settings;
        }),
        control: vi.fn(),
        adjust: vi.fn(),
        save: vi.fn(async () => true),
      };
      const h = createHandler(
        { timerService, storeManagerService: store },
        { stack: tools },
      );
      return { h, timerService };
    };

    it("saves its settings through SET_TIMER_SETTINGS", async () => {
      const { h, timerService } = setup();
      const { call } = await mcpClient(h.handler);

      const res = await call("update_settings", {
        section: "timer",
        changes: { start: 90, seconds: { follow: 60 } },
      });

      expect(res.isError).toBe(false);
      expect(timerService.setSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          start: 90,
          seconds: expect.objectContaining({ follow: 60, share: 10 }),
        }),
      );
      expect(timerService.save).toHaveBeenCalledOnce();
      expect(
        (await call("get_settings", { section: "timer" })).value,
      ).toMatchObject({ values: { start: 90 } });
    });

    it("refuses an unknown setting", async () => {
      const { h, timerService } = setup();
      const { call } = await mcpClient(h.handler);

      const res = await call("update_settings", {
        section: "timer",
        changes: { look: { colour: "#ffffff" } },
      });

      expect(res.text).toContain("look.colour");
      expect(timerService.setSettings).not.toHaveBeenCalled();
    });

    it("starts it and gives its state", async () => {
      const { h, timerService } = setup();
      const { call } = await mcpClient(h.handler);

      expect((await call("timer", { action: "start" })).value).toEqual({
        status: "idle",
        remainingSeconds: 3600,
      });
      expect(timerService.control).toHaveBeenCalledWith("start");
    });

    it.each([
      ["add", 30_000],
      ["remove", -30_000],
    ])("can %s seconds", async (action, ms) => {
      const { h, timerService } = setup("running");
      const { call } = await mcpClient(h.handler);

      await call("timer", { action, seconds: 30 });

      expect(timerService.adjust).toHaveBeenCalledWith(ms);
    });

    it("says the clock can't change before it starts", async () => {
      const { h, timerService } = setup("idle");
      const { call } = await mcpClient(h.handler);

      const res = await call("timer", { action: "add", seconds: 30 });

      expect(res.isError).toBe(true);
      expect(res.text).toContain("hasn't started");
      expect(timerService.adjust).not.toHaveBeenCalled();
    });

    it("needs the seconds to add", async () => {
      const { h, timerService } = setup();
      const { call } = await mcpClient(h.handler);

      expect((await call("timer", { action: "add" })).isError).toBe(true);
      expect(timerService.adjust).not.toHaveBeenCalled();
    });

    it("gives the handler's message when the save fails", async () => {
      const { h, timerService } = setup();
      timerService.save.mockResolvedValue(false);
      const { call } = await mcpClient(h.handler);

      const res = await call("timer", { action: "reset" });

      expect(res.isError).toBe(true);
      expect(res.text).toBe(h.notices.at(-1)?.message);
    });
  });

  it("lists every platform's fans matching a search, without pictures", async () => {
    const fan = (username: string, handle: string, fanLevel: number) => ({
      userId: handle,
      username,
      handle,
      fanLevel,
      fanBadge: "https://p16-webcast.tiktokcdn.com/badge.png",
      superfan: false,
      seenAt: 0,
    });
    const sub = (handle: string, platform: Platform, months?: number) => ({
      ...fan(handle, handle, 0),
      userId: `${platform}:${handle}`,
      fanBadge: "",
      superfan: true,
      platform,
      ...(months && { months }),
    });
    const h = createHandler({
      fansService: {
        all: () => [
          fan("Kai", "kai", 20),
          fan("Ana", "ana_b", 5),
          sub("ana_t", "twitch", 14),
          sub("ana_y", "youtube"),
        ],
      },
    });
    const { call } = await mcpClient(h.handler);
    const seen = "1970-01-01T00:00:00.000Z";

    expect((await call("list", { kind: "fans", query: "@ana" })).value).toEqual(
      {
        total: 3,
        fans: [
          {
            nickname: "Ana",
            handle: "ana_b",
            platform: "tiktok",
            fanLevel: 5,
            superfan: false,
            lastSeenAt: seen,
          },
          {
            nickname: "ana_t",
            handle: "ana_t",
            platform: "twitch",
            months: 14,
            superfan: true,
            lastSeenAt: seen,
          },
          {
            nickname: "ana_y",
            handle: "ana_y",
            platform: "youtube",
            superfan: true,
            lastSeenAt: seen,
          },
        ],
      },
    );
  });

  describe("lives", () => {
    const gifter: Gifter = {
      userId: "1",
      username: "Kai",
      handle: "kai",
      picture: "https://p16.tiktokcdn.com/kai.jpg",
      coins: 500,
      gifts: 3,
      giftSubs: 0,
      giftedAt: 1000,
    };
    const kicker: Gifter = {
      ...gifter,
      userId: "kick:2",
      username: "Bea",
      handle: "bea",
      coins: 200,
      gifts: 1,
      platform: "kick",
    };
    const twitcher: Gifter = {
      ...gifter,
      userId: "twitch:3",
      username: "Mia",
      handle: "mia",
      coins: 100,
      gifts: 0,
      giftSubs: 5,
      platform: "twitch",
    };
    // YouTube's Gifts in Jewels, apart from its Super Chats' dollars
    const tuber: Gifter = {
      ...gifter,
      userId: "youtube:UC4",
      username: "Yui",
      handle: "yui",
      coins: 0,
      gifts: 2,
      jewels: 20,
      platform: "youtube",
    };
    const parts = {
      tiktok: { amount: 500, gifts: 3, giftSubs: 0 },
      kick: { amount: 200, gifts: 1, giftSubs: 0 },
      twitch: { amount: 100, gifts: 0, giftSubs: 5 },
      youtube: { amount: 0, gifts: 2, giftSubs: 0, jewels: 20 },
    };
    const live = {
      username: "streamer",
      startedAt: 1_000,
      endedAt: 61_000,
      coins: 500,
      kicks: 200,
      gifts: 6,
      platforms: parts,
    };
    // Each amount named after its currency
    const named = {
      tiktok: { coins: 500, gifts: 3, giftSubs: 0 },
      twitch: { bits: 100, gifts: 0, giftSubs: 5 },
      youtube: { usd: 0, jewels: 20, gifts: 2, giftSubs: 0 },
      kick: { kicks: 200, gifts: 1, giftSubs: 0 },
    };
    const setup = () => {
      const history = {
        lives: [live],
        gifters: [gifter, kicker, twitcher],
        subGifters: [twitcher],
        jewelGifters: [tuber],
      };
      const historyService = {
        getHistory: () => history,
        getLive: vi.fn(async (startedAt: number) =>
          startedAt === live.startedAt
            ? {
                ...live,
                gifters: [gifter, kicker, twitcher, tuber],
                minutes: [],
              }
            : null,
        ),
        deleteLive: vi.fn(async () => {
          history.lives = [];
          return true;
        }),
        clear: vi.fn(async () => true),
        getTotals: vi.fn(async () => ({
          coins: 500,
          kicks: 200,
          gifts: 4,
          platforms: parts,
        })),
        // Each ranked within their platform
        getGifters: vi.fn(async () => ({
          gifters: [
            { ...gifter, rank: 1 },
            { ...kicker, rank: 1 },
            { ...twitcher, rank: 1 },
          ],
          subGifters: [{ ...twitcher, rank: 1 }],
          jewelGifters: [{ ...tuber, rank: 1 }],
        })),
      };
      const h = createHandler({ historyService }, { stack: lives });
      return { h, historyService };
    };
    const row = {
      nickname: "Kai",
      handle: "kai",
      coins: 500,
      gifts: 3,
      giftSubs: 0,
      lastGiftAt: "1970-01-01T00:00:01.000Z",
    };
    const kickRow = {
      nickname: "Bea",
      handle: "bea",
      kicks: 200,
      gifts: 1,
      giftSubs: 0,
      lastGiftAt: "1970-01-01T00:00:01.000Z",
    };
    const twitchRow = {
      nickname: "Mia",
      handle: "mia",
      bits: 100,
      gifts: 0,
      giftSubs: 5,
      lastGiftAt: "1970-01-01T00:00:01.000Z",
    };
    const youtubeRow = {
      nickname: "Yui",
      handle: "yui",
      usd: 0,
      jewels: 20,
      gifts: 2,
      giftSubs: 0,
      lastGiftAt: "1970-01-01T00:00:01.000Z",
    };

    it("lists them and reads one", async () => {
      const { h } = setup();
      const { call } = await mcpClient(h.handler);

      expect((await call("list", { kind: "lives" })).value).toEqual({
        total: 1,
        lives: [
          {
            id: "1000",
            username: "streamer",
            startedAt: "1970-01-01T00:00:01.000Z",
            endedAt: "1970-01-01T00:01:01.000Z",
            gifts: 6,
            platforms: named,
          },
        ],
      });
      expect(
        (await call("get", { kind: "lives", id: "1000" })).value,
      ).toMatchObject({
        gifts: 6,
        platforms: named,
        totalGifters: 4,
        gifters: {
          tiktok: [row],
          twitch: [twitchRow],
          youtube: [],
          kick: [kickRow],
        },
        // Only who gifted some
        subGifters: { tiktok: [], twitch: [twitchRow], youtube: [], kick: [] },
        jewelGifters: {
          tiktok: [],
          twitch: [],
          youtube: [youtubeRow],
          kick: [],
        },
      });
      expect((await call("get", { kind: "lives", id: "5" })).isError).toBe(
        true,
      );
    });

    it("deletes one through DELETE_LIVE", async () => {
      const { h, historyService } = setup();
      const { call } = await mcpClient(h.handler);

      expect((await call("remove", { kind: "lives", id: "1000" })).text).toBe(
        "Deleted.",
      );
      expect(historyService.deleteLive).toHaveBeenCalledWith(1000);
      expect(h.pushed(APP_EVENTS_RESPONSE.LIVES)).toHaveLength(1);
      expect(
        (await call("remove", { kind: "lives", id: "1000" })).isError,
      ).toBe(true);
    });

    it("clears the history through CLEAR_LIVES", async () => {
      const { h, historyService } = setup();
      const { call } = await mcpClient(h.handler);

      expect((await call("clear_history")).text).toBe("Cleared.");
      expect(historyService.clear).toHaveBeenCalledOnce();
    });

    it("ranks the gifters in some dates", async () => {
      const { h, historyService } = setup();
      const { call } = await mcpClient(h.handler);

      const res = await call("get_gifters", {
        from: "2026-11-01",
        to: "2026-11-02T00:00:00Z",
        query: "kai",
      });

      const from = new Date(2026, 10, 1).getTime();
      const to = Date.UTC(2026, 10, 2);
      expect(res.value).toEqual({
        platform: "tiktok",
        by: "amount",
        totals: named,
        gifters: [{ rank: 1, ...row }],
      });
      expect(
        (await call("get_gifters", { platform: "kick" })).value,
      ).toMatchObject({
        platform: "kick",
        gifters: [{ rank: 1, ...kickRow }],
      });
      expect(
        (await call("get_gifters", { platform: "twitch" })).value,
      ).toMatchObject({ gifters: [{ rank: 1, ...twitchRow }] });
      expect(
        (await call("get_gifters", { platform: "twitch", by: "subs" })).value,
      ).toMatchObject({ by: "subs", gifters: [{ rank: 1, ...twitchRow }] });
      expect(
        (await call("get_gifters", { platform: "kick", by: "subs" })).value,
      ).toMatchObject({ gifters: [] });
      expect(
        (await call("get_gifters", { platform: "youtube", by: "jewels" }))
          .value,
      ).toMatchObject({ by: "jewels", gifters: [{ rank: 1, ...youtubeRow }] });
      expect(historyService.getTotals).toHaveBeenCalledWith({ from, to });
      expect(historyService.getGifters).toHaveBeenCalledWith({
        from,
        to,
        query: "kai",
      });
    });

    it("refuses a date it can't read", async () => {
      const { h, historyService } = setup();
      const { call } = await mcpClient(h.handler);

      expect((await call("get_gifters", { from: "soon" })).isError).toBe(true);
      expect(historyService.getGifters).not.toHaveBeenCalled();
    });
  });
});
