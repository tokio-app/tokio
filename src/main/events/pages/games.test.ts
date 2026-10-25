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
import { defaultProfile, GAMES_PATH, IMAGE_EXTENSIONS } from "@/common/util";
import { defaultStoreData } from "@/common/util/constants/store";
import Logger from "@/logger";
import type { GamesResult } from "@/services/games";
import { dialog } from "@test/electron";
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
const creeper: MediaFile = { name: "Creeper", file: "beef.png" };

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
    min_coins: 0,
    roles: [],
  },
  likes_every: 100,
  steps: [{ type: "command", command: "say hi" }],
  overlay: { show: true, image: tnt, event: "", name: "Boom", column: 1 },
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
      withText: false,
      eventCount: 0,
      image: "/games/minecraft/pictures/c0ffee.png",
      name: "Boom",
      count: 0,
      column: 1,
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

  describe("GET_MINECRAFT_PICTURES", () => {
    it("replies the library", async () => {
      const h = createHandler({
        storeManagerService: { getMinecraftPictures: () => [tnt] },
      });

      await h.invoke(games, APP_EVENTS.GET_MINECRAFT_PICTURES);

      expect(h.replies(APP_EVENTS_RESPONSE.MINECRAFT_PICTURES)).toEqual([
        { success: true, data: [tnt] },
      ]);
    });

    it("replies an empty library when it can't be read", async () => {
      const h = createHandler({
        storeManagerService: {
          getMinecraftPictures: () => {
            throw new Error("StoreManagerService is not initialized.");
          },
        },
      });

      await h.invoke(games, APP_EVENTS.GET_MINECRAFT_PICTURES);

      const error = {
        code: FEEDBACK_CODES.GAME_PICTURES_LOAD_FAILED,
        message: "Unable to load the Minecraft pictures.",
      };
      expect(h.replies(APP_EVENTS_RESPONSE.MINECRAFT_PICTURES)).toEqual([
        { success: false, data: [], error },
      ]);
      expect(h.notices).toEqual([expect.objectContaining(error)]);
    });
  });

  describe("IMPORT_MINECRAFT_PICTURE", () => {
    const pickFiles = (...filePaths: string[]) =>
      dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths });

    // Each path imports as the picture named after it, or fails for .svg
    const setup = () => {
      const library: MediaFile[] = [];
      const gamesService = {
        importPicture: vi.fn(
          async (path: string): Promise<GamesResult<MediaFile>> =>
            path.endsWith(".svg")
              ? { success: false, error: "Unsupported format: svg" }
              : { success: true, data: path === "/tnt.png" ? tnt : creeper },
        ),
      };
      const storeManagerService = {
        addMinecraftPicture: vi.fn(async (picture: MediaFile) => {
          library.push(picture);
          return true;
        }),
        getMinecraftPictures: () => library,
      };
      const h = createHandler({ gamesService, storeManagerService });
      return { h, gamesService, storeManagerService };
    };

    it("does nothing when the dialog is canceled", async () => {
      const { h, gamesService } = setup();

      await h.invoke(games, APP_EVENTS.IMPORT_MINECRAFT_PICTURE, {
        id: "action-1",
      });

      expect(gamesService.importPicture).not.toHaveBeenCalled();
      expect(h.sent()).toEqual([]);
    });

    it("adds a picture and gives it to the action", async () => {
      const { h, gamesService } = setup();
      pickFiles("/tnt.png");

      await h.invoke(games, APP_EVENTS.IMPORT_MINECRAFT_PICTURE, {
        id: "action-1",
      });

      expect(dialog.showOpenDialog.mock.calls[0][1]).toMatchObject({
        title: "Select pictures",
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "Images", extensions: IMAGE_EXTENSIONS }],
      });
      expect(gamesService.importPicture).toHaveBeenCalledExactlyOnceWith(
        "/tnt.png",
      );
      expect(h.sent()).toEqual([
        [
          APP_EVENTS_RESPONSE.SET_MINECRAFT_PICTURE,
          { success: true, id: "action-1", picture: tnt },
        ],
        [
          APP_EVENTS_RESPONSE.MINECRAFT_PICTURES,
          { success: true, data: [tnt] },
        ],
        [
          "notice",
          expect.objectContaining({
            level: "success",
            source: "games",
            code: FEEDBACK_CODES.GAME_PICTURES_ADDED,
            message: 'Picture "TNT" added.',
          }),
        ],
      ]);
    });

    it("adds every picture, the first going on the action", async () => {
      const { h } = setup();
      pickFiles("/creeper.png", "/tnt.png", "/tnt.png");

      await h.invoke(games, APP_EVENTS.IMPORT_MINECRAFT_PICTURE, {
        id: "action-1",
      });

      expect(h.replies(APP_EVENTS_RESPONSE.SET_MINECRAFT_PICTURE)).toEqual([
        { success: true, id: "action-1", picture: creeper },
      ]);
      expect(h.replies(APP_EVENTS_RESPONSE.MINECRAFT_PICTURES)).toEqual([
        { success: true, data: [creeper, tnt] },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({ message: "2 pictures added." }),
      ]);
    });

    it("adds the rest and warns when some files can't be used", async () => {
      const { h } = setup();
      pickFiles("/icon.svg", "/tnt.png", "/logo.svg");

      await h.invoke(games, APP_EVENTS.IMPORT_MINECRAFT_PICTURE, {
        id: "action-1",
      });

      expect(h.replies(APP_EVENTS_RESPONSE.SET_MINECRAFT_PICTURE)).toEqual([
        { success: true, id: "action-1", picture: tnt },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({ code: FEEDBACK_CODES.GAME_PICTURES_ADDED }),
        expect.objectContaining({
          level: "warning",
          code: FEEDBACK_CODES.GAME_PICTURE_IMPORT_FAILED,
          message:
            "Unable to use 2 of the files. Pick png, jpg, gif or webp files up to 50 MB.",
        }),
      ]);
    });

    it("replies the action's id without a notice when no file can be used", async () => {
      const { h, storeManagerService } = setup();
      pickFiles("/icon.svg");

      await h.invoke(games, APP_EVENTS.IMPORT_MINECRAFT_PICTURE, {
        id: "action-1",
      });

      expect(h.sent()).toEqual([
        [
          APP_EVENTS_RESPONSE.SET_MINECRAFT_PICTURE,
          {
            success: false,
            id: "action-1",
            error: {
              code: FEEDBACK_CODES.GAME_PICTURE_IMPORT_FAILED,
              message:
                "Unable to use the file. Pick a png, jpg, gif or webp file up to 50 MB.",
            },
          },
        ],
      ]);
      expect(storeManagerService.addMinecraftPicture).not.toHaveBeenCalled();
      // The service logged it
      expect(logError).not.toHaveBeenCalled();
    });

    it("gives the action nothing when the library can't be saved", async () => {
      const { h, storeManagerService } = setup();
      storeManagerService.addMinecraftPicture.mockResolvedValue(false);
      pickFiles("/tnt.png");

      await h.invoke(games, APP_EVENTS.IMPORT_MINECRAFT_PICTURE, {
        id: "action-1",
      });

      expect(h.sent()).toEqual([
        [
          APP_EVENTS_RESPONSE.SET_MINECRAFT_PICTURE,
          {
            success: false,
            id: "action-1",
            error: expect.objectContaining({
              code: FEEDBACK_CODES.SETTINGS_SAVE_FAILED,
            }),
          },
        ],
      ]);
    });
  });

  describe("REMOVE_MINECRAFT_PICTURE", () => {
    const setup = (
      cleared = true,
      deleted: GamesResult<void> = { success: true },
    ) => {
      const services = overlay();
      const gamesService = {
        deletePicture: vi.fn(async (_file: string) => deleted),
      };
      const storeManagerService = {
        ...services.storeManagerService,
        removeMinecraftPicture: vi.fn(async (_file: string) => true),
        removeFromGames: vi.fn(async (_file: string) => cleared),
        getMinecraftPictures: () => [creeper],
      };
      const h = createHandler({
        ...services,
        gamesService,
        storeManagerService,
      });
      return { ...services, h, gamesService, storeManagerService };
    };

    it("takes the picture off every action, then deletes it", async () => {
      const { h, gamesService, storeManagerService, serverService } = setup();

      await h.invoke(games, APP_EVENTS.REMOVE_MINECRAFT_PICTURE, {
        file: tnt.file,
      });

      expect(
        storeManagerService.removeMinecraftPicture,
      ).toHaveBeenCalledExactlyOnceWith(tnt.file);
      expect(storeManagerService.removeFromGames).toHaveBeenCalledWith(
        tnt.file,
      );
      expect(gamesService.deletePicture).toHaveBeenCalledExactlyOnceWith(
        tnt.file,
      );
      expect(h.sent()).toEqual([
        // The Games page takes it off the actions it shows
        [APP_EVENTS_RESPONSE.MINECRAFT_PICTURE_REMOVED, { file: tnt.file }],
        [
          APP_EVENTS_RESPONSE.MINECRAFT_PICTURES,
          { success: true, data: [creeper] },
        ],
        [
          "notice",
          expect.objectContaining({
            level: "success",
            source: "games",
            code: FEEDBACK_CODES.GAME_PICTURE_REMOVED,
            message: "Picture deleted.",
          }),
        ],
      ]);
      expect(serverService.sendToClient).toHaveBeenCalledExactlyOnceWith(
        GAMES_PATH,
        { type: "tokio:games", data: overlayData },
      );
    });

    it("warns when the file can't be deleted", async () => {
      const { h } = setup(true, { success: false, error: "EBUSY" });

      await h.invoke(games, APP_EVENTS.REMOVE_MINECRAFT_PICTURE, {
        file: tnt.file,
      });

      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "warning",
          code: FEEDBACK_CODES.GAME_PICTURE_REMOVE_FAILED,
          message:
            "Picture removed from the library, but its file couldn't be deleted.",
        }),
      ]);
    });

    it("keeps the file while a profile that has it couldn't be saved", async () => {
      const { h, gamesService } = setup(false);

      await h.invoke(games, APP_EVENTS.REMOVE_MINECRAFT_PICTURE, {
        file: tnt.file,
      });

      expect(gamesService.deletePicture).not.toHaveBeenCalled();
      expect(h.sent()).toEqual([
        [APP_EVENTS_RESPONSE.MINECRAFT_PICTURE_REMOVED, { file: tnt.file }],
        [
          APP_EVENTS_RESPONSE.MINECRAFT_PICTURES,
          {
            success: false,
            data: [creeper],
            error: expect.objectContaining({
              code: FEEDBACK_CODES.SETTINGS_SAVE_FAILED,
            }),
          },
        ],
      ]);
    });

    it("changes nothing when the library can't be saved", async () => {
      const { h, gamesService, storeManagerService } = setup();
      storeManagerService.removeMinecraftPicture.mockResolvedValue(false);

      await h.invoke(games, APP_EVENTS.REMOVE_MINECRAFT_PICTURE, {
        file: tnt.file,
      });

      expect(storeManagerService.removeFromGames).not.toHaveBeenCalled();
      expect(gamesService.deletePicture).not.toHaveBeenCalled();
      expect(h.replies(APP_EVENTS_RESPONSE.MINECRAFT_PICTURE_REMOVED)).toEqual(
        [],
      );
    });
  });
});
