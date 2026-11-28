import { GamesOverlaySchema, type Profile } from "@/common/schemas";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  type CommandResult,
  type Platform,
  TOKIO_EVENTS,
} from "@/common/types";
import type { ServiceResult } from "@/services/shared";
import { createAction } from "@/common/util";
import games from "@/events/pages/games";
import { createHandler } from "@test/handler";
import { mcpClient } from "@test/mcp";
import { describe, expect, it, vi } from "vitest";

const setup = () => {
  const action = { ...createAction("bedrock"), id: "a1" };
  const state = {
    file: "main.json",
    games: {
      actions: [action],
      overlay: GamesOverlaySchema.parse({}),
    },
    pictures: [
      { name: "Old", file: "old.png" },
      { name: "New", file: "new.png" },
    ],
  };
  const profile = () => ({
    name: "Main",
    games: state.games,
    emotes: [],
    platforms: ["kick", "twitch"] as Platform[],
  });
  const updateProfileData = vi.fn(async (data: Partial<Profile>) => {
    if (data.games) state.games = data.games;
    return true;
  });
  const test = vi.fn(async (): Promise<ServiceResult<CommandResult[]>> => ({
    success: true,
    data: [{ command: "summon zombie", ok: true, message: "Object spawned" }],
  }));
  const getProfileData = vi.fn(async () => profile());
  const updateGamesSettings = vi.fn(async () => true);
  const sendToClient = vi.fn();
  const h = createHandler(
    {
      storeManagerService: {
        getProfileData,
        getProfiles: () => [],
        getActiveProfileFile: () => state.file,
        getSettings: () => ({
          activeProfile: { name: "Main", file: state.file },
          games: { minecraft: { enabled: false } },
        }),
        updateProfileData,
        updateGamesSettings,
        getMinecraftPictures: () => state.pictures,
        removeMinecraftPicture: async (file: string) => {
          state.pictures = state.pictures.filter((p) => p.file !== file);
          return true;
        },
        removeFromGames: async () => true,
      },
      gamesService: {
        setGames: vi.fn(),
        test,
        configure: async () => true,
        status: () => ({ minecraft: { state: "waiting" as const } }),
        deletePicture: async () => ({ success: true }),
      },
      overlayService: {
        getGifts: async () => [],
        getCustomGifts: async () => [],
      },
      serverService: { sendToClient },
    },
    { stack: games },
  );
  return {
    h,
    state,
    updateProfileData,
    updateGamesSettings,
    getProfileData,
    test,
    sendToClient,
  };
};

describe("games MCP tools", () => {
  describe("games_overlay", () => {
    it("saves the look with the actions kept, then sends the profile", async () => {
      const { h, state } = setup();
      const invoke = vi.spyOn(h.handler, "invoke");
      const { call } = await mcpClient(h.handler);

      const res = await call("update_settings", {
        section: "games_overlay",
        changes: { layout: "carousel", columns: 2 },
      });

      expect(res).toMatchObject({ isError: false, text: "Saved." });
      expect(invoke).toHaveBeenCalledExactlyOnceWith(
        APP_EVENTS.UPDATE_GAMES_SETTINGS,
        {
          settings: {
            actions: [expect.objectContaining({ id: "a1" })],
            overlay: expect.objectContaining({
              layout: "carousel",
              columns: 2,
            }),
          },
        },
      );
      expect(state.games.actions).toHaveLength(1);
      expect(h.pushed(APP_EVENTS_RESPONSE.GET_PROFILE)).toHaveLength(1);
      expect(
        (await call("get_settings", { section: "games_overlay" })).value,
      ).toMatchObject({
        values: { layout: "carousel" },
        columnURLs: [
          "http://tokio-app.local:37891/games/minecraft/1/",
          "http://tokio-app.local:37891/games/minecraft/2/",
        ],
      });
    });

    it("refuses an unknown field", async () => {
      const { h, updateProfileData } = setup();
      const { call } = await mcpClient(h.handler);

      const res = await call("update_settings", {
        section: "games_overlay",
        changes: { colour: "#ffffff" },
      });

      expect(res.isError).toBe(true);
      expect(updateProfileData).not.toHaveBeenCalled();
    });
  });

  it("turns Minecraft on through SET_GAMES_SETTINGS", async () => {
    const { h, updateGamesSettings } = setup();
    const { call } = await mcpClient(h.handler);

    const res = await call("update_settings", {
      section: "minecraft",
      changes: { minecraft: { enabled: true } },
    });

    expect(res.value).toEqual({ status: { state: "waiting" } });
    expect(updateGamesSettings).toHaveBeenCalledWith({
      minecraft: { enabled: true },
    });
    expect(h.pushed(APP_EVENTS_RESPONSE.GAMES)).toHaveLength(1);
  });

  describe("game_action", () => {
    it("creates one for the edition asked", async () => {
      const { h, state } = setup();
      const { call } = await mcpClient(h.handler);

      const res = await call("save_item", {
        kind: "game_action",
        changes: {
          edition: "java",
          steps: [{ type: "morph", mob: "creeper" }],
        },
      });

      expect(res.isError).toBe(false);
      const created = state.games.actions[1];
      expect(res.value).toEqual({
        id: created.id,
        overlayURL: "http://tokio-app.local:37891/games/minecraft/",
      });
      expect(created).toMatchObject({
        edition: "java",
        steps: [{ type: "morph", mob: "creeper", seconds: null }],
      });
      expect(h.pushed(APP_EVENTS_RESPONSE.GET_PROFILE)).toHaveLength(1);
    });

    it("merges changes onto the stored one", async () => {
      const { h, state } = setup();
      const { call } = await mcpClient(h.handler);

      await call("save_item", {
        kind: "game_action",
        id: "a1",
        changes: { enabled: false, trigger: { keyword: "boom" } },
      });

      expect(state.games.actions).toEqual([
        expect.objectContaining({
          id: "a1",
          enabled: false,
          trigger: expect.objectContaining({
            type: TOKIO_EVENTS.FOLLOW,
            keyword: "boom",
          }),
          steps: [expect.objectContaining({ type: "spawn", mob: "zombie" })],
        }),
      ]);
    });

    it.each([
      [{ steps: [{ type: "spawn", mob: "dragonite", amount: 1 }] }, "mob id"],
      [{ steps: [{ type: "morph", mob: "creeper" }] }, "Java Edition only"],
      [
        { edition: "java", steps: [{ type: "morph", mob: "tnt" }] },
        "isn't a living mob",
      ],
      [{ overlay: { image: { name: "X", file: "x.png" } } }, "pictures"],
      [{ steps: [{ type: "spawn", mob: "zombie", amount: 0 }] }, "Invalid"],
      [{ id: "other" }, "Unknown"],
      // The Games page can't show them
      [{ trigger: { min_coins: 500 } }, "Unknown settings: trigger.min_coins"],
      [
        { trigger: { roles: ["moderator"] } },
        "Unknown settings: trigger.roles",
      ],
    ])("refuses %j", async (changes, message) => {
      const { h, updateProfileData } = setup();
      const { call } = await mcpClient(h.handler);

      const res = await call("save_item", {
        kind: "game_action",
        id: "a1",
        changes,
      });

      expect(res.isError).toBe(true);
      expect(res.text).toContain(message);
      expect(updateProfileData).not.toHaveBeenCalled();
    });

    it("saves nothing when the profile changed meanwhile", async () => {
      const { h, state, updateProfileData, getProfileData } = setup();
      const read = getProfileData.getMockImplementation();
      getProfileData.mockImplementation(async () => {
        state.file = "other.json";
        return read!();
      });
      const { call } = await mcpClient(h.handler);

      const res = await call("save_item", {
        kind: "game_action",
        id: "a1",
        changes: { enabled: false },
      });

      expect(res.isError).toBe(true);
      expect(updateProfileData).not.toHaveBeenCalled();
    });

    it("removes one", async () => {
      const { h, state } = setup();
      const { call } = await mcpClient(h.handler);

      expect(
        (await call("remove", { kind: "game_action", id: "a1" })).text,
      ).toBe("Removed.");
      expect(state.games.actions).toEqual([]);
      expect(
        (await call("remove", { kind: "game_action", id: "a1" })).isError,
      ).toBe(true);
    });

    it("tests the stored one, with the game's replies", async () => {
      const { h, test } = setup();
      const { call } = await mcpClient(h.handler);

      const res = await call("test", { kind: "game_action", id: "a1" });

      expect(res.value).toEqual({
        results: [
          { command: "summon zombie", ok: true, gameReply: "Object spawned" },
        ],
      });
      expect(test).toHaveBeenCalledWith({
        edition: "bedrock",
        trigger: TOKIO_EVENTS.FOLLOW,
        // Kick has no follows: Twitch's sample
        platform: "twitch",
        steps: [expect.objectContaining({ type: "spawn", mob: "zombie" })],
      });
      // Private: a Games row testing the action would take it as its own
      expect(h.pushed(APP_EVENTS_RESPONSE.TEST_GAME_ACTION)).toEqual([]);
    });

    it("gives the test's failure", async () => {
      const { h, test } = setup();
      test.mockResolvedValue({ success: false, error: "No game.", data: [] });
      const { call } = await mcpClient(h.handler);

      expect(
        await call("test", { kind: "game_action", id: "a1" }),
      ).toMatchObject({ isError: true, text: "No game." });
    });

    it("lists and reads them", async () => {
      const { h } = setup();
      const { call } = await mcpClient(h.handler);

      expect((await call("list", { kind: "game_action" })).value).toEqual({
        total: 1,
        actions: [
          {
            id: "a1",
            enabled: true,
            edition: "bedrock",
            trigger: TOKIO_EVENTS.FOLLOW,
            does: "Zombie",
            shown: true,
          },
        ],
      });
      expect(
        (await call("get", { kind: "game_action", id: "a1" })).value,
      ).toMatchObject({
        action: { id: "a1" },
        overlayURL: "http://tokio-app.local:37891/games/minecraft/",
      });
      const { value } = await call("get", { kind: "game_action", id: "a1" });
      // What the Games page shows, so a trigger sent back isn't refused
      expect(value).not.toHaveProperty("action.trigger.min_coins");
      expect(value).not.toHaveProperty("action.trigger.roles");
      expect(value).toHaveProperty("action.trigger.type");
    });
  });

  it("lights a row on the games overlay", async () => {
    const { h, sendToClient } = setup();
    const { call } = await mcpClient(h.handler);

    expect(
      (await call("test", { kind: "games_overlay_row", id: "a1" })).isError,
    ).toBe(false);
    expect(sendToClient).toHaveBeenCalledWith("games", {
      type: "tokio:games:run",
      data: { id: "a1" },
    });
  });

  describe("minecraft_pictures", () => {
    it("lists the newest first", async () => {
      const { h } = setup();
      const { call } = await mcpClient(h.handler);

      expect(
        (await call("list", { kind: "minecraft_pictures" })).value,
      ).toEqual({
        total: 2,
        pictures: [
          { id: "new.png", name: "New", file: "new.png" },
          { id: "old.png", name: "Old", file: "old.png" },
        ],
      });
    });

    it("removes one through its handler", async () => {
      const { h, state } = setup();
      const { call } = await mcpClient(h.handler);

      const res = await call("remove", {
        kind: "minecraft_pictures",
        id: "old.png",
      });

      expect(res.text).toBe("Removed.");
      expect(state.pictures).toEqual([{ name: "New", file: "new.png" }]);
      expect(h.pushed(APP_EVENTS_RESPONSE.MINECRAFT_PICTURE_REMOVED)).toEqual([
        { file: "old.png" },
      ]);
      expect(
        (await call("remove", { kind: "minecraft_pictures", id: "x.png" }))
          .isError,
      ).toBe(true);
    });
  });
});
