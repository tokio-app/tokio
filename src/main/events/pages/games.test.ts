import {
  GameAction,
  GamesOverlaySchema,
  GamesSettings,
  GamesSettingsSchema,
  MediaFile,
  Profile,
} from "@/common/schemas";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  AppEventsMap,
  CustomGift,
  FEEDBACK_CODES,
  GamesOverlayData,
  GamesStatus,
  TOKIO_EVENTS,
} from "@/common/types";
import { defaultProfile, GAMES_PATH } from "@/common/util";
import { defaultStoreData } from "@/common/util/constants/store";
import Logger from "@/logger";
import { createHandler } from "@test/handler";
import {
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
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

const tnt: MediaFile = { name: "TNT", file: "c0ffee.png" };

const roseAction: GameAction = {
  id: "action-1",
  enabled: true,
  edition: "bedrock",
  trigger: {
    type: TOKIO_EVENTS.GIFT,
    gifts: [5655],
    every_gift: false,
    emotes: [],
    keyword: "",
    user: "",
  },
  likes_every: 100,
  steps: [{ type: "command", command: "say hi" }],
  overlay: { show: true, image: tnt, event: "", name: "Boom" },
};

const rose: CustomGift = {
  value: 5655,
  label: "Rose",
  img: "rose.png",
  coins: 1,
};

// What sendGamesOverlay reads, for a profile with one action on a Rose
const overlay = () => ({
  storeManagerService: {
    getProfileData: async () => ({
      ...defaultProfile,
      games: { ...defaultProfile.games, actions: [roseAction] },
    }),
  },
  overlayService: {
    getGifts: async () => [rose],
    getCustomGifts: async () => [],
  },
  serverService: { sendToClient: vi.fn((_id: string, _data: unknown) => true) },
});

const overlayData: GamesOverlayData = {
  look: defaultProfile.games.overlay,
  rows: [
    {
      id: "action-1",
      pictures: ["rose.png"],
      event: "Rose",
      image: "/games/minecraft/c0ffee.png",
      name: "Boom",
    },
  ],
};

describe("games events", () => {
  let logError: MockInstance<typeof Logger.error>;

  beforeEach(() => {
    logError = vi.spyOn(Logger, "error").mockImplementation(() => {});
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
    const settings: Profile["games"] = {
      actions: [],
      overlay: GamesOverlaySchema.parse({}),
    };

    it("saves the actions without a notice, since it's an autosave", async () => {
      const updateProfileData = vi.fn(async (_data: Partial<Profile>) => true);
      const { serverService, ...services } = overlay();
      const h = createHandler({
        ...services,
        serverService,
        storeManagerService: {
          ...services.storeManagerService,
          updateProfileData,
        },
      });

      await h.invoke(games, APP_EVENTS.UPDATE_GAMES_SETTINGS, { settings });

      expect(updateProfileData).toHaveBeenCalledExactlyOnceWith({
        games: settings,
      });
      expect(h.replies(APP_EVENTS_RESPONSE.UPDATE_GAMES_SETTINGS)).toEqual([
        { success: true },
      ]);
      expect(h.notices).toEqual([]);
      // The overlay gets the saved actions
      expect(serverService.sendToClient).toHaveBeenCalledExactlyOnceWith(
        GAMES_PATH,
        { type: "tokio:games", data: overlayData },
      );
    });

    it("doesn't fail the save when the overlay can't be sent", async () => {
      const h = createHandler({
        ...overlay(),
        storeManagerService: {
          updateProfileData: async () => true,
          getProfileData: async () => {
            throw new Error("EBUSY");
          },
        },
      });

      await h.invoke(games, APP_EVENTS.UPDATE_GAMES_SETTINGS, { settings });

      expect(h.replies(APP_EVENTS_RESPONSE.UPDATE_GAMES_SETTINGS)).toEqual([
        { success: true },
      ]);
      expect(h.notices).toEqual([]);
      expect(logError).toHaveBeenCalledWith(
        "<Games> Unable to update the games overlay -- EBUSY",
        undefined,
        expect.any(Error),
      );
    });

    it("reports a failed save as the system's", async () => {
      const sendToClient = vi.fn();
      const h = createHandler({
        storeManagerService: { updateProfileData: async () => false },
        serverService: { sendToClient },
      });

      await h.invoke(games, APP_EVENTS.UPDATE_GAMES_SETTINGS, { settings });
      expect(sendToClient).not.toHaveBeenCalled();

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

  describe("TEST_GAMES_OVERLAY", () => {
    it("lights the action's row up on the overlay, with no reply or notice", async () => {
      const sendToClient = vi.fn((_id: string, _data: unknown) => true);
      const h = createHandler({ serverService: { sendToClient } });

      await h.invoke(games, APP_EVENTS.TEST_GAMES_OVERLAY, { id: "action-1" });

      expect(sendToClient).toHaveBeenCalledExactlyOnceWith(GAMES_PATH, {
        type: "tokio:games:run",
        data: { id: "action-1" },
      });
      expect(h.sent()).toEqual([]);
    });
  });
});
