import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import home from "@/events/pages/home";
import { createHandler } from "@test/handler";
import { mcpClient } from "@test/mcp";
import { describe, expect, it, vi } from "vitest";

describe("settings MCP sections", () => {
  describe("features", () => {
    const setup = (saved = true) => {
      const features = { tts: true, music: true, alerts: true };
      const updateActiveFeatures = vi.fn(async (data: object) => {
        Object.assign(features, data);
        return saved;
      });
      const clearTalk = vi.fn();
      const h = createHandler(
        {
          storeManagerService: {
            getActiveFeatures: () => features,
            updateActiveFeatures,
            getSettings: () => ({
              activeProfile: { name: "Main", file: "main.json" },
              activeFeatures: features,
            }),
            getProfiles: () => [],
          },
          ttsService: { clearTalk },
          alertsService: { clear: vi.fn() },
          musicService: { clearHandler: vi.fn() },
        },
        { stack: home },
      );
      return { h, updateActiveFeatures, clearTalk };
    };

    it("reads them", async () => {
      const { h } = setup();
      const { call } = await mcpClient(h.handler);

      expect(
        (await call("get_settings", { section: "features" })).value,
      ).toEqual({ values: { tts: true, music: true, alerts: true } });
    });

    it("saves through ACTIVE_FEATURES, then sends the settings", async () => {
      const { h, updateActiveFeatures, clearTalk } = setup();
      const invoke = vi.spyOn(h.handler, "invoke");
      const { call } = await mcpClient(h.handler);

      const res = await call("update_settings", {
        section: "features",
        changes: { tts: false },
      });

      expect(res).toMatchObject({ isError: false, text: "Saved." });
      expect(invoke).toHaveBeenCalledExactlyOnceWith(
        APP_EVENTS.ACTIVE_FEATURES,
        { tts: false, music: true, alerts: true },
      );
      expect(updateActiveFeatures).toHaveBeenCalledOnce();
      expect(clearTalk).toHaveBeenCalledOnce();
      expect(h.pushed(APP_EVENTS_RESPONSE.GET_SETTINGS)).toEqual([
        expect.objectContaining({ success: true }),
      ]);
    });

    it("gives the handler's message when the save fails", async () => {
      const { h } = setup(false);
      const { call } = await mcpClient(h.handler);

      const res = await call("update_settings", {
        section: "features",
        changes: { alerts: false },
      });

      expect(res.isError).toBe(true);
      expect(res.text).toBe(h.notices.at(-1)?.message);
      // The window still shows what main holds
      expect(h.pushed(APP_EVENTS_RESPONSE.GET_SETTINGS)).toHaveLength(1);
    });

    it("refuses an unknown feature", async () => {
      const { h, updateActiveFeatures } = setup();
      const { call } = await mcpClient(h.handler);

      const res = await call("update_settings", {
        section: "features",
        changes: { games: true },
      });

      expect(res.isError).toBe(true);
      expect(updateActiveFeatures).not.toHaveBeenCalled();
    });
  });
});
