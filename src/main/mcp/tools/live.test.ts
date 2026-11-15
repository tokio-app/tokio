import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import controls from "@/events/pages/controls";
import { t } from "@/helper/i18n";
import { ControlsService } from "@/services/controls";
import { createHandler } from "@test/handler";
import { mcpClient } from "@test/mcp";
import { describe, expect, it, vi } from "vitest";

describe("live MCP tools", () => {
  describe("profiles", () => {
    const store = () => ({
      getSettings: () => ({
        activeProfile: { name: "Main", file: "main.json" },
      }),
      getProfiles: () => [
        { name: "Main", file: "main.json" },
        { name: "Gaming", file: "gaming.json" },
        { name: "Game night", file: "game-night.json" },
      ],
    });

    it("lists them with the active one", async () => {
      const { call } = await mcpClient(
        createHandler({ storeManagerService: store() }).handler,
      );

      expect((await call("list", { kind: "profiles" })).value).toEqual({
        total: 3,
        profiles: [
          { id: "main.json", name: "Main", active: true },
          { id: "gaming.json", name: "Gaming", active: false },
          { id: "game-night.json", name: "Game night", active: false },
        ],
      });
    });

    it("filters by name and limits", async () => {
      const { call } = await mcpClient(
        createHandler({ storeManagerService: store() }).handler,
      );

      expect(
        (await call("list", { kind: "profiles", query: "GAM", limit: 1 }))
          .value,
      ).toEqual({
        total: 2,
        profiles: [{ id: "gaming.json", name: "Gaming", active: false }],
      });
    });
  });

  describe("control", () => {
    const setup = () => {
      const controlsService = new ControlsService();
      const skip = vi.fn(() => false);
      const h = createHandler(
        {
          controlsService,
          musicService: { skip },
          ttsService: { clearTalk: vi.fn() },
          alertsService: { clear: vi.fn() },
          gamesService: { stopRuns: vi.fn() },
        },
        { stack: controls },
      );
      return { h, controlsService, skip };
    };

    it.each([
      ["skip_song", { action: "skipSong" }],
      ["stop_tts", { action: "stopTts" }],
      ["replay_alert", { action: "replayAlert" }],
      ["pause", { action: "pause", paused: true }],
      ["resume", { action: "pause", paused: false }],
    ])("runs %s through CONTROL", async (action, data) => {
      const { h } = setup();
      const invoke = vi.spyOn(h.handler, "invoke");
      const { call } = await mcpClient(h.handler);

      const res = await call("control", { action });

      expect(res.isError).toBe(false);
      expect(invoke).toHaveBeenCalledExactlyOnceWith(APP_EVENTS.CONTROL, data);
      // Pages see it as if they'd asked, after a flush
      expect(h.pushed(APP_EVENTS_RESPONSE.FLUSH_SETTINGS)).toHaveLength(1);
      expect(h.pushed(APP_EVENTS_RESPONSE.CONTROL)).toHaveLength(1);
    });

    it("says whether there was something to do, and the pause", async () => {
      const { h, controlsService } = setup();
      const { call } = await mcpClient(h.handler);

      expect((await call("control", { action: "skip_song" })).value).toEqual({
        done: false,
        paused: false,
      });
      expect((await call("control", { action: "pause" })).value).toEqual({
        done: true,
        paused: true,
      });
      expect(controlsService.isPaused()).toBe(true);
    });

    it("gives the handler's message when it fails", async () => {
      const { h, skip } = setup();
      skip.mockImplementation(() => {
        throw new Error("boom");
      });
      const { call } = await mcpClient(h.handler);

      const res = await call("control", { action: "skip_song" });

      expect(res).toMatchObject({
        isError: true,
        text: t("main.failure.control"),
      });
    });

    it("refuses an action it doesn't have", async () => {
      const { h } = setup();
      const { call } = await mcpClient(h.handler);

      expect((await call("control", { action: "skipSong" })).isError).toBe(
        true,
      );
    });
  });
});
