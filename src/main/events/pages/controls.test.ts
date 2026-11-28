import { RemoteSettingsSchema, ShortcutsSchema } from "@/common/schemas";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  ControlAction,
  FEEDBACK_CODES,
} from "@/common/types";
import { defaultStoreData } from "@/common/util";
import { logsPlace } from "@/helper/feedback";
import { t } from "@/helper/i18n";
import Logger from "@/logger";
import type { AlertAudio } from "@/services/alerts";
import { ControlsService } from "@/services/controls";
import { globalShortcut } from "@test/electron";
import { createHandler } from "@test/handler";
import { describe, expect, it, vi } from "vitest";
import controls from "./controls";

const audio = (id: string): AlertAudio => ({
  id,
  key: `${id}.mp3`,
  volume: 1,
  channel: "alerts",
  maxQueueLength: 5,
  repeat: 3,
});

const setup = () => {
  const controlsService = new ControlsService();
  const services = {
    controlsService,
    musicService: { skip: vi.fn(() => true) },
    ttsService: { clearTalk: vi.fn() },
    alertsService: { clear: vi.fn() },
    gamesService: { stopRuns: vi.fn() },
  };
  const h = createHandler(services, { stack: controls });
  const control = (action: ControlAction, paused?: boolean) =>
    h.invoke(controls, APP_EVENTS.CONTROL, { action, paused });
  return { h, ...services, control };
};

describe("CONTROL", () => {
  it.each([true, false])(
    "skips the song, done: %s as the music service queued it",
    async (queued) => {
      const { h, musicService, control } = setup();
      musicService.skip.mockReturnValue(queued);

      await control("skipSong");

      expect(h.replies(APP_EVENTS_RESPONSE.CONTROL)).toEqual([
        { success: true, action: "skipSong", done: queued, paused: false },
      ]);
      expect(h.notices).toEqual([]);
    },
  );

  it("stops the TTS in main and in the window together", async () => {
    const { h, ttsService, control } = setup();

    await control("stopTts");

    expect(ttsService.clearTalk).toHaveBeenCalledOnce();
    expect(h.pushed(APP_EVENTS_RESPONSE.TTS_CLEAR)).toEqual([undefined]);
    expect(h.replies(APP_EVENTS_RESPONSE.CONTROL)).toEqual([
      { success: true, action: "stopTts", done: true, paused: false },
    ]);
  });

  it("replays the last event's alerts once each", async () => {
    const { h, controlsService, control } = setup();
    controlsService.recordAlerts([audio("a"), audio("b")]);

    await control("replayAlert");

    expect(h.pushed(APP_EVENTS_RESPONSE.ALERT_AUDIO)).toEqual([
      { ...audio("a"), repeat: 1 },
      { ...audio("b"), repeat: 1 },
    ]);
    expect(h.replies(APP_EVENTS_RESPONSE.CONTROL)).toEqual([
      { success: true, action: "replayAlert", done: true, paused: false },
    ]);
  });

  it("replays nothing before any alert", async () => {
    const { h, control } = setup();

    await control("replayAlert");

    expect(h.pushed(APP_EVENTS_RESPONSE.ALERT_AUDIO)).toEqual([]);
    expect(h.replies(APP_EVENTS_RESPONSE.CONTROL)).toEqual([
      expect.objectContaining({ success: true, done: false }),
    ]);
  });

  it("pauses, stopping what plays and what waits, then resumes", async () => {
    const {
      h,
      controlsService,
      ttsService,
      alertsService,
      gamesService,
      control,
    } = setup();

    await control("pause");

    expect(controlsService.isPaused()).toBe(true);
    expect(ttsService.clearTalk).toHaveBeenCalledOnce();
    // The streaks go on counting while paused
    expect(alertsService.clear).toHaveBeenCalledExactlyOnceWith({
      streaks: false,
    });
    expect(gamesService.stopRuns).toHaveBeenCalledOnce();
    expect(h.pushed(APP_EVENTS_RESPONSE.TTS_CLEAR)).toHaveLength(1);
    expect(h.pushed(APP_EVENTS_RESPONSE.ALERT_CLEAR)).toHaveLength(1);

    await control("pause");

    expect(controlsService.isPaused()).toBe(false);
    expect(ttsService.clearTalk).toHaveBeenCalledOnce();
    expect(h.replies(APP_EVENTS_RESPONSE.CONTROL)).toEqual([
      { success: true, action: "pause", done: true, paused: true },
      { success: true, action: "pause", done: true, paused: false },
    ]);
    expect(h.notices).toEqual([]);
  });

  it("sets the pause it's given, done: false when it was already so", async () => {
    const { h, controlsService, control } = setup();

    await control("pause", false);
    await control("pause", true);
    await control("pause", true);

    expect(controlsService.isPaused()).toBe(true);
    expect(
      h.replies(APP_EVENTS_RESPONSE.CONTROL).map(({ done }) => done),
    ).toEqual([false, true, false]);
  });

  it("refuses an unknown action, with the pause as it is", async () => {
    const { h, controlsService } = setup();
    controlsService.setPaused(true);

    await h.invoke(controls, APP_EVENTS.CONTROL, {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- what a bad caller could send
      action: "dance" as ControlAction,
    });

    const failure = {
      code: FEEDBACK_CODES.CONTROL_FAILED,
      message: "Unable to run that control.",
    };
    expect(h.replies(APP_EVENTS_RESPONSE.CONTROL)).toEqual([
      {
        success: false,
        error: failure,
        action: "dance",
        done: false,
        paused: true,
      },
    ]);
    expect(h.notices).toEqual([expect.objectContaining(failure)]);
  });
});

describe("GET_CONTROLS", () => {
  it("replies the state", async () => {
    const { h, controlsService } = setup();
    controlsService.setPaused(true);

    await h.invoke(controls, APP_EVENTS.GET_CONTROLS);

    expect(h.replies(APP_EVENTS_RESPONSE.CONTROLS)).toEqual([{ paused: true }]);
  });
});

describe("SET_SHORTCUTS", () => {
  const shortcuts = (set: Partial<Record<ControlAction, string>> = {}) => ({
    ...defaultStoreData.settings.shortcuts,
    ...set,
  });

  // The store's own parse, keeping the stored ones on a throw
  const setupStore = (saved = true) => {
    const settings = { shortcuts: shortcuts() };
    const store = {
      getSettings: () => settings,
      getProfiles: () => [],
      updateShortcuts: vi.fn(async (value: unknown) => {
        settings.shortcuts = ShortcutsSchema.parse(value);
        return saved;
      }),
    };
    const musicService = { skip: vi.fn(() => true) };
    const h = createHandler(
      {
        storeManagerService: store,
        musicService,
        controlsService: new ControlsService(),
      },
      { stack: controls },
    );
    return { h, store, musicService };
  };

  it("saves and applies them, each running its control", async () => {
    const { h, musicService } = setupStore();
    // The recorder left them suspended
    globalShortcut.setSuspended(true);

    await h.invoke(controls, APP_EVENTS.SET_SHORTCUTS, {
      shortcuts: shortcuts({ skipSong: "F9" }),
    });

    expect(globalShortcut.isSuspended()).toBe(false);
    expect(h.replies(APP_EVENTS_RESPONSE.GET_SETTINGS)).toEqual([
      expect.objectContaining({ success: true }),
    ]);
    expect(h.replies(APP_EVENTS_RESPONSE.SET_SHORTCUTS)).toEqual([
      { success: true, taken: [] },
    ]);
    expect(h.notices).toEqual([]);

    expect(globalShortcut.press("F9")).toBe(true);
    await vi.waitFor(() =>
      expect(h.pushed(APP_EVENTS_RESPONSE.CONTROL)).toEqual([
        { success: true, action: "skipSong", done: true, paused: false },
      ]),
    );
    expect(musicService.skip).toHaveBeenCalledOnce();
  });

  it("warns once about the ones another app holds", async () => {
    const { h } = setupStore();
    globalShortcut.take("F9");
    const data = { shortcuts: shortcuts({ pause: "F9" }) };

    await h.invoke(controls, APP_EVENTS.SET_SHORTCUTS, data);
    await h.invoke(controls, APP_EVENTS.SET_SHORTCUTS, data);

    expect(h.replies(APP_EVENTS_RESPONSE.SET_SHORTCUTS)).toEqual([
      { success: true, taken: ["pause"] },
      { success: true, taken: ["pause"] },
    ]);
    expect(h.notices).toEqual([
      expect.objectContaining({
        level: "warning",
        code: FEEDBACK_CODES.SHORTCUT_TAKEN,
        message: expect.stringContaining("Pause everything"),
      }),
    ]);
  });

  it("reports a change the store couldn't write, after the settings main holds", async () => {
    const { h } = setupStore(false);

    await h.invoke(controls, APP_EVENTS.SET_SHORTCUTS, {
      shortcuts: shortcuts({ skipSong: "F9" }),
    });

    const failure = {
      code: FEEDBACK_CODES.SETTINGS_SAVE_FAILED,
      message: t("main.saveFailed", logsPlace()),
    };
    expect(globalShortcut.isRegistered("F9")).toBe(true);
    expect(h.replies(APP_EVENTS_RESPONSE.GET_SETTINGS)).toHaveLength(1);
    expect(h.replies(APP_EVENTS_RESPONSE.SET_SHORTCUTS)).toEqual([
      { success: false, error: failure, taken: [] },
    ]);
    expect(h.notices).toEqual([expect.objectContaining(failure)]);
  });

  it("refuses shortcuts the schema refuses, keeping the ones before", async () => {
    const { h } = setupStore();
    await h.invoke(controls, APP_EVENTS.SET_SHORTCUTS, {
      shortcuts: shortcuts({ skipSong: "F9" }),
    });

    await h.invoke(controls, APP_EVENTS.SET_SHORTCUTS, {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- what a bad caller could send
      shortcuts: { skipSong: 9 } as never,
    });

    const failure = {
      code: FEEDBACK_CODES.SETTINGS_SAVE_FAILED,
      message: "Unable to save the shortcuts.",
    };
    expect(h.replies(APP_EVENTS_RESPONSE.SET_SHORTCUTS).at(-1)).toEqual({
      success: false,
      error: failure,
      taken: [],
    });
    expect(h.notices).toEqual([expect.objectContaining(failure)]);
    expect(globalShortcut.isRegistered("F9")).toBe(true);
  });
});

describe("remote", () => {
  // The store's own parse, as updateRemote does
  const setupRemote = ({ saved = true, server = true } = {}) => {
    const settings = {
      remote: RemoteSettingsSchema.parse({}),
      server: { enabled: server },
    };
    const store = {
      getRemote: () => settings.remote,
      getSettings: () => settings,
      getProfiles: () => [],
      updateRemote: vi.fn(async (value: unknown) => {
        settings.remote = RemoteSettingsSchema.parse(value);
        return saved;
      }),
    };
    const h = createHandler(
      { storeManagerService: store },
      { stack: controls },
    );
    return { h, settings };
  };

  const setRemote = (h: ReturnType<typeof createHandler>, enabled: boolean) =>
    h.invoke(controls, APP_EVENTS.SET_REMOTE, { enabled });

  it("makes a key the first time it's on, and keeps it after", async () => {
    const { h, settings } = setupRemote();

    await setRemote(h, true);
    const { key } = settings.remote;
    expect(key).toMatch(/^[\w-]{24}$/);
    expect(h.replies(APP_EVENTS_RESPONSE.GET_SETTINGS)).toEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          settings: expect.objectContaining({
            remote: { enabled: true, key },
          }),
        }),
      }),
    ]);
    expect(h.replies(APP_EVENTS_RESPONSE.SET_REMOTE)).toEqual([
      { success: true },
    ]);

    await setRemote(h, false);
    await setRemote(h, true);

    expect(settings.remote).toEqual({ enabled: true, key });
    expect(h.notices).toEqual([
      expect.objectContaining({
        level: "success",
        code: FEEDBACK_CODES.REMOTE_ENABLED,
        message: t("main.remote.on"),
      }),
      expect.objectContaining({
        level: "info",
        code: FEEDBACK_CODES.REMOTE_DISABLED,
        message: t("main.remote.off"),
      }),
      expect.objectContaining({ code: FEEDBACK_CODES.REMOTE_ENABLED }),
    ]);
  });

  it("says it needs the overlay server when that's off", async () => {
    const { h } = setupRemote({ server: false });

    await setRemote(h, true);

    expect(h.notices).toEqual([
      expect.objectContaining({ message: t("main.remote.onServerOff") }),
    ]);
  });

  it("replaces the key, keeping the switch", async () => {
    const { h, settings } = setupRemote();
    await setRemote(h, true);
    const { key } = settings.remote;

    await h.invoke(controls, APP_EVENTS.NEW_REMOTE_KEY, undefined);

    expect(settings.remote.enabled).toBe(true);
    expect(settings.remote.key).toMatch(/^[\w-]{24}$/);
    expect(settings.remote.key).not.toBe(key);
    expect(h.replies(APP_EVENTS_RESPONSE.GET_SETTINGS)).toHaveLength(2);
    expect(h.replies(APP_EVENTS_RESPONSE.NEW_REMOTE_KEY)).toEqual([
      { success: true },
    ]);
    expect(h.notices.at(-1)).toEqual(
      expect.objectContaining({
        level: "success",
        code: FEEDBACK_CODES.REMOTE_KEY_RENEWED,
        message: t("main.remote.keyRenewed"),
      }),
    );
  });

  it.each([
    [APP_EVENTS.SET_REMOTE, APP_EVENTS_RESPONSE.SET_REMOTE],
    [APP_EVENTS.NEW_REMOTE_KEY, APP_EVENTS_RESPONSE.NEW_REMOTE_KEY],
  ] as const)(
    "%s reports a change the store couldn't write, after the settings main holds",
    async (event, response) => {
      const { h } = setupRemote({ saved: false });

      await h.invoke(controls, event, { enabled: true });

      const failure = {
        code: FEEDBACK_CODES.SETTINGS_SAVE_FAILED,
        message: t("main.saveFailed", logsPlace()),
      };
      expect(h.replies(APP_EVENTS_RESPONSE.GET_SETTINGS)).toHaveLength(1);
      expect(h.replies(response)).toEqual([{ success: false, error: failure }]);
      expect(h.notices).toEqual([expect.objectContaining(failure)]);
    },
  );

  it("never logs the key", async () => {
    const logs = [
      vi.spyOn(Logger, "debug"),
      vi.spyOn(Logger, "info"),
      vi.spyOn(Logger, "warn"),
      vi.spyOn(Logger, "error"),
    ];
    const { h, settings } = setupRemote({ saved: false });

    await setRemote(h, true);
    await h.invoke(controls, APP_EVENTS.NEW_REMOTE_KEY, undefined);

    const { key } = settings.remote;
    expect(key).not.toBe("");
    const logged = JSON.stringify(logs.flatMap((log) => log.mock.calls));
    expect(logged).not.toContain(key);
  });
});

describe("SUSPEND_SHORTCUTS", () => {
  it("suspends and resumes them", async () => {
    const { h } = setup();

    await h.invoke(controls, APP_EVENTS.SUSPEND_SHORTCUTS, { suspended: true });
    expect(globalShortcut.isSuspended()).toBe(true);

    await h.invoke(controls, APP_EVENTS.SUSPEND_SHORTCUTS, {
      suspended: false,
    });
    expect(globalShortcut.isSuspended()).toBe(false);
    expect(h.notices).toEqual([]);
  });
});
