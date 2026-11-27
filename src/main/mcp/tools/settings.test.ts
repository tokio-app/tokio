import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { defaultProfile, defaultStoreData } from "@/common/util";
import controls from "@/events/pages/controls";
import home from "@/events/pages/home";
import settingsStack from "@/events/pages/settings";
import { ShortcutsSchema } from "@/common/schemas";
import { ControlsService } from "@/services/controls";
import { globalShortcut } from "@test/electron";
import { createHandler } from "@test/handler";
import { mcpClient } from "@test/mcp";
import { describe, expect, it, vi } from "vitest";
import { shortcutProblem } from "./settings";

// The store's settings, as the handlers read and change them
const storeSettings = () => structuredClone(defaultStoreData.settings);

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

  describe("activity_feed", () => {
    const setup = () => {
      const settings = storeSettings();
      const updateActivityFeed = vi.fn(
        async (feed: typeof settings.activityFeed) => {
          settings.activityFeed = feed;
          return true;
        },
      );
      const setFeed = vi.fn();
      const h = createHandler(
        {
          storeManagerService: {
            getSettings: () => settings,
            getProfiles: () => [],
            updateActivityFeed,
          },
          liveService: { setFeed, getSession: () => ({}) },
        },
        { stack: home },
      );
      return { h, updateActivityFeed, setFeed };
    };

    it("saves the merged feed through SET_ACTIVITY_FEED, then sends the settings", async () => {
      const { h, updateActivityFeed, setFeed } = setup();
      const { call } = await mcpClient(h.handler);

      const res = await call("update_settings", {
        section: "activity_feed",
        changes: { kick: { chat: false } },
      });

      expect(res).toMatchObject({ isError: false, text: "Saved." });
      // Kick's chats alone
      const feed = structuredClone(defaultStoreData.settings.activityFeed);
      feed.kick.chat = false;
      expect(updateActivityFeed).toHaveBeenCalledExactlyOnceWith(feed);
      expect(setFeed).toHaveBeenCalledWith(feed);
      expect(h.pushed(APP_EVENTS_RESPONSE.GET_SETTINGS)).toHaveLength(1);
      expect(
        (await call("get_settings", { section: "activity_feed" })).value,
      ).toEqual({ values: feed });
    });
  });

  describe("app", () => {
    const setup = () => {
      const settings = storeSettings();
      const store = {
        getSettings: () => settings,
        getProfiles: () => [],
        updateTraySettings: vi.fn(async (enabled: boolean) => {
          settings.tray.enabled = enabled;
          return true;
        }),
        updateTranslationLanguage: vi.fn(async (language: string) => {
          settings.translation.language = language;
          return true;
        }),
        updateLogsSettings: vi.fn(async () => false),
      };
      const h = createHandler(
        { storeManagerService: store, trayService: { setEnabled: vi.fn() } },
        { stack: settingsStack },
      );
      return { h, store, settings };
    };

    it("reads them by their own names", async () => {
      const { h, settings } = setup();
      // A language Tokio no longer has falls back, as main applies it
      settings.language = "xx";
      const { call } = await mcpClient(h.handler);

      expect((await call("get_settings", { section: "app" })).value).toEqual({
        values: {
          language: "system",
          translation: "",
          tray: true,
          updates: true,
          overlay_updates: true,
          detailed_logs: false,
        },
      });
    });

    it("saves only the changed ones, each through its handler", async () => {
      const { h, store } = setup();
      const invoke = vi.spyOn(h.handler, "invoke");
      const { call } = await mcpClient(h.handler);

      const res = await call("update_settings", {
        section: "app",
        changes: { translation: "es", tray: false },
      });

      expect(res).toMatchObject({ isError: false, text: "Saved." });
      expect(invoke.mock.calls).toEqual([
        [APP_EVENTS.SET_TRANSLATION, { language: "es" }],
        [APP_EVENTS.SET_TRAY, { enabled: false }],
      ]);
      expect(store.updateTranslationLanguage).toHaveBeenCalledWith("es");
      expect(store.updateTraySettings).toHaveBeenCalledWith(false);
      // Their handlers sent the settings
      expect(h.pushed(APP_EVENTS_RESPONSE.GET_SETTINGS)).toHaveLength(2);
    });

    it("says what was saved before one failed", async () => {
      const { h } = setup();
      const { call } = await mcpClient(h.handler);

      const res = await call("update_settings", {
        section: "app",
        changes: { tray: false, detailed_logs: true },
      });

      expect(res.isError).toBe(true);
      expect(res.text).toMatch(/^Saved tray, but not detailed_logs: /);
    });

    it("refuses a language Tokio doesn't have", async () => {
      const { h } = setup();
      const invoke = vi.spyOn(h.handler, "invoke");
      const { call } = await mcpClient(h.handler);

      const res = await call("update_settings", {
        section: "app",
        changes: { language: "fr" },
      });

      expect(res.isError).toBe(true);
      expect(invoke).not.toHaveBeenCalled();
    });
  });

  describe("shortcuts", () => {
    const setup = () => {
      const settings = storeSettings();
      const store = {
        getSettings: () => settings,
        getProfiles: () => [],
        updateShortcuts: vi.fn(async (value: unknown) => {
          settings.shortcuts = ShortcutsSchema.parse(value);
          return true;
        }),
      };
      const h = createHandler(
        {
          storeManagerService: store,
          controlsService: new ControlsService(),
        },
        { stack: controls },
      );
      return { h, store };
    };

    it("saves them through SET_SHORTCUTS and says which another app holds", async () => {
      const { h, store } = setup();
      globalShortcut.take("F13");
      const { call } = await mcpClient(h.handler);

      const res = await call("update_settings", {
        section: "shortcuts",
        changes: { pause: "F13", skipSong: "Ctrl+Shift+S" },
      });

      expect(res.value).toEqual({ saved: true, takenByAnotherApp: ["pause"] });
      expect(store.updateShortcuts).toHaveBeenCalledWith({
        ...defaultStoreData.settings.shortcuts,
        pause: "F13",
        skipSong: "Ctrl+Shift+S",
      });
      expect(h.pushed(APP_EVENTS_RESPONSE.GET_SETTINGS)).toHaveLength(1);
    });

    it("refuses one that would take a key from every app", async () => {
      const { h, store } = setup();
      const { call } = await mcpClient(h.handler);

      const res = await call("update_settings", {
        section: "shortcuts",
        changes: { stopTts: "A" },
      });

      expect(res.isError).toBe(true);
      expect(res.text).toContain("stopTts (A)");
      expect(store.updateShortcuts).not.toHaveBeenCalled();
    });

    it.each([
      ["", undefined],
      ["F13", undefined],
      ["MediaPlayPause", undefined],
      ["Ctrl+Shift+S", undefined],
      ["Ctrl+Alt+Shift+1", undefined],
      ["Ctrl+Shift+num5", undefined],
    ])("takes %j", (accelerator) => {
      expect(shortcutProblem(accelerator, false)).toBeUndefined();
    });

    it.each([
      "A",
      "F5",
      "Ctrl+S",
      "Alt+Shift+S",
      "Ctrl+Alt+S",
      "Ctrl+Ctrl+S",
      "Ctrl+Shift+Hyper",
      "Meta+Shift+S",
    ])("refuses %j", (accelerator) => {
      expect(shortcutProblem(accelerator, false)).toBeDefined();
    });

    it("takes macOS's Command and Ctrl+Alt there", () => {
      expect(shortcutProblem("Command+Shift+S", true)).toBeUndefined();
      expect(shortcutProblem("Control+Alt+S", true)).toBeUndefined();
      expect(shortcutProblem("Command+Shift+S", false)).toBeDefined();
    });
  });

  describe("translation", () => {
    const setup = (language = "es") => {
      const settings = storeSettings();
      settings.translation.language = language;
      const test = vi.fn(async () => ({
        kind: "translated" as const,
        translation: { text: "hola", from: "en", to: "es" },
      }));
      const h = createHandler(
        {
          storeManagerService: {
            getSettings: () => settings,
            getProfileData: async () => defaultProfile,
            getStudio: () => [],
          },
          overlayService: { chatCommands: () => [] },
          translationService: { test },
        },
        { stack: settingsStack },
      );
      return { h, test };
    };

    it("tests a text through TEST_TRANSLATION", async () => {
      const { h, test } = setup();
      const { call } = await mcpClient(h.handler);

      const res = await call("test", {
        kind: "translation",
        args: { text: "hello" },
      });

      expect(res.value).toEqual({
        kind: "translated",
        translation: "hola",
        from: "en",
        to: "es",
      });
      expect(test).toHaveBeenCalledWith("hello", expect.anything());
    });

    it("says when translation is off", async () => {
      const { h, test } = setup("");
      const { call } = await mcpClient(h.handler);

      const res = await call("test", {
        kind: "translation",
        args: { text: "hello" },
      });

      expect(res.isError).toBe(true);
      expect(test).not.toHaveBeenCalled();
    });
  });
});
