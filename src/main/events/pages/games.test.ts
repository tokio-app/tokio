import { GamesSettings, GamesSettingsSchema, Profile } from "@/common/schemas";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  AppEventsMap,
  FEEDBACK_CODES,
  GamesStatus,
  TOKIO_EVENTS,
} from "@/common/types";
import { defaultStoreData } from "@/common/util/constants/store";
import Logger from "@/logger";
import { createHandler } from "@test/handler";
import { beforeEach, describe, expect, it, vi } from "vitest";
import games from "./games";

const waiting: GamesStatus = { minecraft: { state: "waiting" } };
const on: GamesSettings = { minecraft: { enabled: true } };

// A store holding the games' settings, which updateGamesSettings changes
const store = (saved = true) => {
  const settings = structuredClone(defaultStoreData.settings);
  return {
    getSettings: () => settings,
    updateGamesSettings: vi.fn(async (games: unknown) => {
      settings.games = GamesSettingsSchema.parse(games);
      return saved;
    }),
  };
};

describe("games events", () => {
  beforeEach(() => {
    vi.spyOn(Logger, "error").mockImplementation(() => {});
    vi.spyOn(Logger, "warn").mockImplementation(() => {});
  });

  describe("GET_GAMES", () => {
    it("replies the settings and the connections' status", async () => {
      const h = createHandler({
        storeManagerService: store(),
        gamesService: { status: () => waiting },
      });

      await h.invoke(games, APP_EVENTS.GET_GAMES);

      expect(h.replies(APP_EVENTS_RESPONSE.GAMES)).toEqual([
        {
          success: true,
          data: { settings: defaultStoreData.settings.games, status: waiting },
        },
      ]);
      expect(h.notices).toEqual([]);
    });
  });

  describe("SET_GAMES_SETTINGS", () => {
    it("saves, turns Minecraft on and replies what main holds", async () => {
      const storeManagerService = store();
      const configure = vi.fn(async (_settings: GamesSettings) => true);
      const h = createHandler({
        storeManagerService,
        gamesService: { configure, status: () => waiting },
      });

      await h.invoke(games, APP_EVENTS.SET_GAMES_SETTINGS, { settings: on });

      expect(storeManagerService.updateGamesSettings).toHaveBeenCalledWith(on);
      expect(configure).toHaveBeenCalledExactlyOnceWith(on);
      expect(h.replies(APP_EVENTS_RESPONSE.GAMES)).toEqual([
        { success: true, data: { settings: on, status: waiting } },
      ]);
      expect(h.notices).toEqual([]);
    });

    it("shows a port in use only in the status", async () => {
      const status: GamesStatus = {
        minecraft: { state: "error", error: "Port 37892 is in use." },
      };
      const h = createHandler({
        storeManagerService: store(),
        gamesService: { configure: async () => false, status: () => status },
      });

      await h.invoke(games, APP_EVENTS.SET_GAMES_SETTINGS, { settings: on });

      expect(h.replies(APP_EVENTS_RESPONSE.GAMES)).toEqual([
        { success: true, data: { settings: on, status } },
      ]);
      expect(h.notices).toEqual([]);
    });

    it("replies what main holds, then reports an unsaved store", async () => {
      const h = createHandler({
        storeManagerService: store(false),
        gamesService: { configure: async () => true, status: () => waiting },
      });

      await h.invoke(games, APP_EVENTS.SET_GAMES_SETTINGS, { settings: on });

      const error = {
        code: FEEDBACK_CODES.SETTINGS_SAVE_FAILED,
        message:
          "Tokio couldn't save the change. Check the logs folder for details.",
      };
      expect(h.replies(APP_EVENTS_RESPONSE.GAMES)).toEqual([
        { success: true, data: { settings: on, status: waiting } },
        { success: false, error },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({ source: "games", ...error }),
      ]);
    });
  });

  describe("UPDATE_GAMES_SETTINGS", () => {
    const settings: Profile["games"] = { actions: [] };

    it("saves the actions without a notice, since it's an autosave", async () => {
      const updateProfileData = vi.fn(async (_data: Partial<Profile>) => true);
      const h = createHandler({ storeManagerService: { updateProfileData } });

      await h.invoke(games, APP_EVENTS.UPDATE_GAMES_SETTINGS, { settings });

      expect(updateProfileData).toHaveBeenCalledExactlyOnceWith({
        games: settings,
      });
      expect(h.replies(APP_EVENTS_RESPONSE.UPDATE_GAMES_SETTINGS)).toEqual([
        { success: true },
      ]);
      expect(h.notices).toEqual([]);
    });

    it("reports a failed save as the system's", async () => {
      const h = createHandler({
        storeManagerService: { updateProfileData: async () => false },
      });

      await h.invoke(games, APP_EVENTS.UPDATE_GAMES_SETTINGS, { settings });

      const failure = {
        code: FEEDBACK_CODES.PROFILE_SAVE_FAILED,
        message: "Unable to save the game actions.",
      };
      expect(h.replies(APP_EVENTS_RESPONSE.UPDATE_GAMES_SETTINGS)).toEqual([
        { success: false, error: failure },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({ source: "system", ...failure }),
      ]);
    });
  });

  describe("TEST_GAME_ACTION", () => {
    const request: AppEventsMap[APP_EVENTS.TEST_GAME_ACTION] = {
      id: "action-1",
      edition: "bedrock",
      trigger: TOKIO_EVENTS.FOLLOW,
      steps: [{ type: "command", command: "say hi" }],
    };

    it("runs the steps in the action's edition and replies each command with the game's answer", async () => {
      const results = [{ command: "say hi", ok: true, message: "" }];
      const test = vi.fn(async () => ({ success: true, data: results }));
      const h = createHandler({ gamesService: { test } });

      await h.invoke(games, APP_EVENTS.TEST_GAME_ACTION, {
        ...request,
        edition: "java",
      });

      expect(test).toHaveBeenCalledWith({
        edition: "java",
        trigger: request.trigger,
        steps: request.steps,
      });
      expect(h.replies(APP_EVENTS_RESPONSE.TEST_GAME_ACTION)).toEqual([
        { success: true, id: "action-1", results },
      ]);
      expect(h.notices).toEqual([]);
    });

    it("fails with its id when no game is connected, without a notice", async () => {
      const h = createHandler({
        gamesService: {
          test: async () => ({
            success: false,
            error: "Turn on Minecraft and connect the game first.",
          }),
        },
      });

      await h.invoke(games, APP_EVENTS.TEST_GAME_ACTION, request);

      expect(h.replies(APP_EVENTS_RESPONSE.TEST_GAME_ACTION)).toEqual([
        {
          success: false,
          id: "action-1",
          results: [],
          error: {
            code: FEEDBACK_CODES.GAME_TEST_FAILED,
            message: "Turn on Minecraft and connect the game first.",
          },
        },
      ]);
      expect(h.notices).toEqual([]);
    });

    it("refuses steps the schema doesn't allow", async () => {
      const test = vi.fn();
      const h = createHandler({ gamesService: { test } });

      await h.invoke(games, APP_EVENTS.TEST_GAME_ACTION, {
        ...request,
        steps: [{ type: "spawn", mob: "zombie", amount: 1000, name: "" }],
      });

      expect(test).not.toHaveBeenCalled();
      expect(h.replies(APP_EVENTS_RESPONSE.TEST_GAME_ACTION)).toEqual([
        {
          success: false,
          id: "action-1",
          results: [],
          error: {
            code: FEEDBACK_CODES.GAME_TEST_FAILED,
            message: "Unable to test the action.",
          },
        },
      ]);
    });
  });
});
