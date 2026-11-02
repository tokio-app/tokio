import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  FEEDBACK_CODES,
  LiveHistory,
  LiveRecord,
  LiveSummary,
} from "@/common/types";
import { createHandler } from "@test/handler";
import { describe, expect, it, vi } from "vitest";
import lives from "./lives";

const summary: LiveSummary = {
  username: "streamer",
  startedAt: 1000,
  endedAt: 5000,
  coins: 10,
  gifts: 2,
};
const gifter = {
  userId: "42",
  username: "Ana",
  handle: "ana",
  picture: "ana.png",
  coins: 10,
  gifts: 2,
  giftedAt: 2000,
};
const record: LiveRecord = { ...summary, gifters: [gifter], minutes: [] };
const totals = { coins: 10, gifts: 2 };
const history: LiveHistory = { lives: [summary], gifters: [gifter] };
const empty: LiveHistory = { lives: [], gifters: [] };

const notice = (fields: object) => ["notice", expect.objectContaining(fields)];

describe("lives events", () => {
  describe("GET_LIVES", () => {
    it("replies the history without a notice", async () => {
      const h = createHandler({
        historyService: { getHistory: () => history },
      });

      await h.invoke(lives, APP_EVENTS.GET_LIVES);

      expect(h.sent()).toEqual([
        [APP_EVENTS_RESPONSE.LIVES, { data: history }],
      ]);
    });
  });

  describe("GET_LIVE", () => {
    it("replies the LIVE with its startedAt", async () => {
      const getLive = vi.fn(async (_startedAt: number) => record);
      const h = createHandler({ historyService: { getLive } });

      await h.invoke(lives, APP_EVENTS.GET_LIVE, { startedAt: 1000 });

      expect(getLive).toHaveBeenCalledExactlyOnceWith(1000);
      expect(h.sent()).toEqual([
        [
          APP_EVENTS_RESPONSE.LIVE,
          { success: true, startedAt: 1000, data: record },
        ],
      ]);
    });

    it("keeps the startedAt on a LIVE it can't load", async () => {
      const h = createHandler({
        historyService: { getLive: async () => null },
      });

      await h.invoke(lives, APP_EVENTS.GET_LIVE, { startedAt: 1000 });

      const error = {
        code: FEEDBACK_CODES.LIVE_LOAD_FAILED,
        message:
          "Unable to load that LIVE. Its file may be missing or damaged.",
      };
      expect(h.replies(APP_EVENTS_RESPONSE.LIVE)).toEqual([
        { success: false, startedAt: 1000, error },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({ level: "warning", ...error }),
      ]);
    });

    it("keeps the startedAt when reading throws", async () => {
      const h = createHandler({
        historyService: {
          getLive: async () => {
            throw new Error("EBUSY");
          },
        },
      });

      await h.invoke(lives, APP_EVENTS.GET_LIVE, { startedAt: 1000 });

      expect(h.replies(APP_EVENTS_RESPONSE.LIVE)).toEqual([
        {
          success: false,
          startedAt: 1000,
          error: {
            code: FEEDBACK_CODES.LIVE_LOAD_FAILED,
            message: "Unable to load the LIVE.",
          },
        },
      ]);
    });
  });

  describe("GET_GIFTERS", () => {
    it("replies the dates' totals first, then again with their gifters", async () => {
      const found = [{ ...gifter, rank: 1 }];
      const getTotals = vi.fn(
        async (_range: { from?: number; to?: number }) => totals,
      );
      const h = createHandler({
        historyService: { getTotals, getGifters: async () => found },
      });

      await h.invoke(lives, APP_EVENTS.GET_GIFTERS, { from: 1000, to: 2000 });

      expect(getTotals).toHaveBeenCalledExactlyOnceWith({
        from: 1000,
        to: 2000,
      });
      expect(h.replies(APP_EVENTS_RESPONSE.GIFTERS)).toEqual([
        { success: true, from: 1000, to: 2000, totals },
        { success: true, from: 1000, to: 2000, totals, data: found },
      ]);
    });

    it("replies the range's gifters with the range and the search", async () => {
      const found = [{ ...gifter, rank: 3 }];
      const getGifters = vi.fn(
        async (_args: { from?: number; to?: number; query?: string }) => found,
      );
      const h = createHandler({ historyService: { getGifters } });

      await h.invoke(lives, APP_EVENTS.GET_GIFTERS, {
        from: 1000,
        query: "ana",
      });

      expect(getGifters).toHaveBeenCalledExactlyOnceWith({
        from: 1000,
        query: "ana",
      });
      expect(h.sent()).toEqual([
        [
          APP_EVENTS_RESPONSE.GIFTERS,
          { success: true, from: 1000, query: "ana", data: found },
        ],
      ]);
    });

    it("replies nothing more once another profile loaded", async () => {
      const after = createHandler({
        historyService: {
          getTotals: async () => totals,
          getGifters: async () => null,
        },
      });
      const before = createHandler({
        historyService: {
          getTotals: async () => null,
          getGifters: async () => [],
        },
      });

      await after.invoke(lives, APP_EVENTS.GET_GIFTERS, { from: 1000 });
      await before.invoke(lives, APP_EVENTS.GET_GIFTERS, { from: 1000 });

      expect(after.replies(APP_EVENTS_RESPONSE.GIFTERS)).toEqual([
        { success: true, from: 1000, totals },
      ]);
      expect(before.sent()).toEqual([]);
    });

    it("keeps the range when reading throws", async () => {
      const h = createHandler({
        historyService: {
          getTotals: async () => totals,
          getGifters: async () => {
            throw new Error("EBUSY");
          },
        },
      });

      await h.invoke(lives, APP_EVENTS.GET_GIFTERS, { from: 1000, to: 2000 });

      expect(h.replies(APP_EVENTS_RESPONSE.GIFTERS)).toEqual([
        { success: true, from: 1000, to: 2000, totals },
        {
          success: false,
          from: 1000,
          to: 2000,
          error: {
            code: FEEDBACK_CODES.LIVE_LOAD_FAILED,
            message: "Unable to load the gifters.",
          },
        },
      ]);
    });
  });

  describe("DELETE_LIVE", () => {
    it("deletes the LIVE, replies the history and notifies", async () => {
      const deleteLive = vi.fn(async (_startedAt: number) => true);
      const h = createHandler({
        historyService: { deleteLive, getHistory: () => empty },
      });

      await h.invoke(lives, APP_EVENTS.DELETE_LIVE, { startedAt: 1000 });

      expect(deleteLive).toHaveBeenCalledExactlyOnceWith(1000);
      expect(h.sent()).toEqual([
        [APP_EVENTS_RESPONSE.LIVES, { data: empty }],
        notice({
          level: "success",
          code: FEEDBACK_CODES.LIVE_DELETED,
          message: "LIVE deleted.",
        }),
      ]);
    });

    it("replies what main holds before saying the save failed", async () => {
      const h = createHandler({
        historyService: {
          deleteLive: async () => false,
          getHistory: () => empty,
        },
      });

      await h.invoke(lives, APP_EVENTS.DELETE_LIVE, { startedAt: 1000 });

      expect(h.sent()).toEqual([
        [APP_EVENTS_RESPONSE.LIVES, { data: empty }],
        notice({
          level: "error",
          code: FEEDBACK_CODES.HISTORY_SAVE_FAILED,
          message:
            "Tokio couldn't save the LIVE history. Check the logs folder for details.",
        }),
      ]);
    });
  });

  describe("CLEAR_LIVES", () => {
    it("clears the history, replies it and notifies", async () => {
      const clear = vi.fn(async () => true);
      const h = createHandler({
        historyService: { clear, getHistory: () => empty },
      });

      await h.invoke(lives, APP_EVENTS.CLEAR_LIVES);

      expect(clear).toHaveBeenCalledOnce();
      expect(h.sent()).toEqual([
        [APP_EVENTS_RESPONSE.LIVES, { data: empty }],
        notice({
          level: "success",
          code: FEEDBACK_CODES.HISTORY_CLEARED,
          message: "LIVE history cleared.",
        }),
      ]);
    });

    it("replies what main holds before saying it couldn't clear", async () => {
      const h = createHandler({
        historyService: { clear: async () => false, getHistory: () => history },
      });

      await h.invoke(lives, APP_EVENTS.CLEAR_LIVES);

      expect(h.sent()).toEqual([
        [APP_EVENTS_RESPONSE.LIVES, { data: history }],
        notice({
          level: "error",
          code: FEEDBACK_CODES.HISTORY_CLEAR_FAILED,
          message: "Unable to clear the LIVE history.",
        }),
      ]);
    });
  });
});
