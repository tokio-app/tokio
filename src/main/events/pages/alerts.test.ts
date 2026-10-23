import { AlertSound, AlertTts, MediaFile, Profile } from "@/common/schemas";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  EMOTE_TRIGGER,
  FEEDBACK_CODES,
  MyInstantsSound,
  TOKIO_EVENTS,
} from "@/common/types";
import { defaultProfile, MEDIA_EXTENSIONS } from "@/common/util";
import Logger from "@/logger";
import {
  AUDIO_EXTENSIONS,
  type AlertsResult,
  type AlertsService,
} from "@/services/alerts";
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
import alerts from "./alerts";

type SpeakResult = Awaited<ReturnType<AlertsService["speak"]>>;

const profile: Profile = { ...defaultProfile, name: "Stream" };
const audio = new Uint8Array([1, 2, 3]);
const airhornUrl = "https://www.myinstants.com/media/sounds/airhorn.mp3";
const airhorn: AlertSound = { name: "Airhorn", file: "5f2b9c.mp3" };
const ding: AlertSound = { name: "ding", file: "a71e04.mp3" };
const library: AlertSound[] = [airhorn, ding];
const party: MediaFile = { name: "party", file: "c0ffee.gif" };

const speech: AlertTts = {
  voice: { engine: "edge", name: "Aria", lang: "en-US" },
  message: "Thanks {user}!",
  speed: 1.5,
  pitch: 0.8,
};

const found: MyInstantsSound[] = [
  { name: "Airhorn", url: airhornUrl, file: airhorn.file },
];

const pickFiles = (...filePaths: string[]) => {
  dialog.showOpenDialog.mockResolvedValue({ canceled: false, filePaths });
};

describe("alerts events", () => {
  let logError: MockInstance<typeof Logger.error>;
  let logWarn: MockInstance<typeof Logger.warn>;

  beforeEach(() => {
    logError = vi.spyOn(Logger, "error").mockImplementation(() => {});
    logWarn = vi.spyOn(Logger, "warn").mockImplementation(() => {});
  });

  describe("UPDATE_ALERTS_SETTINGS", () => {
    const settings = { simultaneous: false, queue_length: 5, items: [] };

    it("saves the alerts without a notice, since it's an autosave", async () => {
      const updateProfileData = vi.fn(async (_data: Partial<Profile>) => true);
      const h = createHandler({ storeManagerService: { updateProfileData } });

      await h.invoke(alerts, APP_EVENTS.UPDATE_ALERTS_SETTINGS, { settings });

      expect(updateProfileData).toHaveBeenCalledExactlyOnceWith({
        alerts: settings,
      });
      expect(h.replies(APP_EVENTS_RESPONSE.UPDATE_ALERTS_SETTINGS)).toEqual([
        { success: true },
      ]);
      expect(h.notices).toEqual([]);
    });

    it("reports a failed save as the system's", async () => {
      const h = createHandler({
        storeManagerService: { updateProfileData: async () => false },
      });

      await h.invoke(alerts, APP_EVENTS.UPDATE_ALERTS_SETTINGS, { settings });

      const failure = {
        code: FEEDBACK_CODES.PROFILE_SAVE_FAILED,
        message: "Unable to save the alerts.",
      };
      expect(h.replies(APP_EVENTS_RESPONSE.UPDATE_ALERTS_SETTINGS)).toEqual([
        { success: false, error: failure },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({ source: "system", ...failure }),
      ]);
      // The store logged why
      expect(logError).not.toHaveBeenCalled();
    });
  });

  describe("SEARCH_SOUNDS", () => {
    const setup = (
      res: AlertsResult<{ sounds: MyInstantsSound[]; hasNextPage: boolean }>,
    ) => {
      const alertsService = {
        search: vi.fn(async (_query: string, _page?: number) => res),
        getTrending: vi.fn(async (_page?: number) => res),
      };
      return { h: createHandler({ alertsService }), alertsService };
    };
    const page = { success: true, data: { sounds: found, hasNextPage: true } };

    it("searches for the trimmed query and echoes the request", async () => {
      const { h, alertsService } = setup(page);

      await h.invoke(alerts, APP_EVENTS.SEARCH_SOUNDS, {
        query: "  airhorn ",
        page: 2,
      });

      expect(alertsService.search).toHaveBeenCalledExactlyOnceWith(
        "airhorn",
        2,
      );
      expect(alertsService.getTrending).not.toHaveBeenCalled();
      expect(h.replies(APP_EVENTS_RESPONSE.SEARCH_SOUNDS)).toEqual([
        {
          success: true,
          query: "  airhorn ",
          page: 2,
          data: found,
          hasNextPage: true,
        },
      ]);
    });

    it.each([undefined, "", "   "])(
      "lists the trending sounds for the query %o",
      async (query) => {
        const { h, alertsService } = setup(page);

        await h.invoke(alerts, APP_EVENTS.SEARCH_SOUNDS, { query, page: 3 });

        expect(alertsService.getTrending).toHaveBeenCalledExactlyOnceWith(3);
        expect(alertsService.search).not.toHaveBeenCalled();
        expect(h.replies(APP_EVENTS_RESPONSE.SEARCH_SOUNDS)).toEqual([
          {
            success: true,
            query: query ?? "",
            page: 3,
            data: found,
            hasNextPage: true,
          },
        ]);
      },
    );

    it("replies an empty page when the result has no data", async () => {
      const { h } = setup({ success: true });

      await h.invoke(alerts, APP_EVENTS.SEARCH_SOUNDS, { page: 1 });

      expect(h.replies(APP_EVENTS_RESPONSE.SEARCH_SOUNDS)).toEqual([
        { success: true, query: "", page: 1, data: [], hasNextPage: false },
      ]);
    });

    it("replies the failure in the same shape, without a notice", async () => {
      const { h } = setup({ success: false, error: "HTTP 503" });

      await h.invoke(alerts, APP_EVENTS.SEARCH_SOUNDS, {
        query: "airhorn",
        page: 2,
      });

      expect(h.replies(APP_EVENTS_RESPONSE.SEARCH_SOUNDS)).toEqual([
        {
          success: false,
          query: "airhorn",
          page: 2,
          data: [],
          hasNextPage: false,
          error: {
            code: FEEDBACK_CODES.SOUND_SEARCH_FAILED,
            message: "Unable to reach MyInstants. Try again in a few minutes.",
          },
        },
      ]);
      expect(h.notices).toEqual([]);
      expect(logError).not.toHaveBeenCalled();
    });
  });

  describe("DOWNLOAD_SOUND", () => {
    const request = {
      id: "alert-1",
      request: 3,
      url: airhornUrl,
      name: "Airhorn",
    };

    const setup = (res: AlertsResult<AlertSound>) => {
      const alertsService = {
        downloadSound: vi.fn(async (_url: string, _name: string) => res),
      };
      const storeManagerService = {
        addSound: vi.fn(async (_sound: AlertSound) => true),
      };
      const h = createHandler({ alertsService, storeManagerService });
      return { h, alertsService, storeManagerService };
    };

    it("downloads the sound into the library and gives it to the alert", async () => {
      const { h, alertsService, storeManagerService } = setup({
        success: true,
        data: airhorn,
      });

      await h.invoke(alerts, APP_EVENTS.DOWNLOAD_SOUND, request);

      expect(alertsService.downloadSound).toHaveBeenCalledExactlyOnceWith(
        airhornUrl,
        "Airhorn",
      );
      expect(storeManagerService.addSound).toHaveBeenCalledExactlyOnceWith(
        airhorn,
      );
      expect(h.replies(APP_EVENTS_RESPONSE.SET_ALERT_SOUND)).toEqual([
        { success: true, id: "alert-1", request: 3, sound: airhorn },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "success",
          source: "alerts",
          code: FEEDBACK_CODES.SOUND_ADDED,
          message: 'Sound "Airhorn" added.',
        }),
      ]);
    });

    it.each([{ success: false, error: "HTTP 404" }, { success: true }])(
      "replies the alert's id without a notice when it fails (%o)",
      async (res) => {
        const { h, storeManagerService } = setup(res);

        await h.invoke(alerts, APP_EVENTS.DOWNLOAD_SOUND, request);

        expect(h.replies(APP_EVENTS_RESPONSE.SET_ALERT_SOUND)).toEqual([
          {
            success: false,
            id: "alert-1",
            request: 3,
            error: {
              code: FEEDBACK_CODES.SOUND_DOWNLOAD_FAILED,
              message:
                "Unable to download the sound. Sounds can be up to 8 MB.",
            },
          },
        ]);
        expect(storeManagerService.addSound).not.toHaveBeenCalled();
        expect(h.notices).toEqual([]);
        expect(logError).not.toHaveBeenCalled();
      },
    );
  });

  describe("IMPORT_SOUND", () => {
    const setup = (
      res: AlertsResult<AlertSound> = { success: true, data: ding },
    ) => {
      const alertsService = {
        importSound: vi.fn(async (_path: string) => res),
      };
      const storeManagerService = {
        addSound: vi.fn(async (_sound: AlertSound) => true),
      };
      const h = createHandler({ alertsService, storeManagerService });
      return { h, alertsService, storeManagerService };
    };

    it.each([
      { canceled: true, filePaths: [] },
      { canceled: false, filePaths: [] },
    ])("does nothing when no file is picked (%o)", async (result) => {
      const { h, alertsService } = setup();
      dialog.showOpenDialog.mockResolvedValue(result);

      await h.invoke(alerts, APP_EVENTS.IMPORT_SOUND, {
        id: "alert-1",
        request: 3,
      });

      expect(alertsService.importSound).not.toHaveBeenCalled();
      expect(h.replies(APP_EVENTS_RESPONSE.SET_ALERT_SOUND)).toEqual([]);
      expect(h.notices).toEqual([]);
    });

    it("imports the file into the library and gives it to the alert", async () => {
      const { h, alertsService, storeManagerService } = setup();
      pickFiles("/music/ding.wav");

      await h.invoke(alerts, APP_EVENTS.IMPORT_SOUND, {
        id: "alert-1",
        request: 3,
      });

      expect(dialog.showOpenDialog.mock.calls[0][0]).toBe(h.win);
      expect(dialog.showOpenDialog.mock.calls[0][1]).toMatchObject({
        properties: ["openFile"],
        filters: [{ name: "Audio", extensions: AUDIO_EXTENSIONS }],
      });
      expect(alertsService.importSound).toHaveBeenCalledExactlyOnceWith(
        "/music/ding.wav",
      );
      expect(storeManagerService.addSound).toHaveBeenCalledExactlyOnceWith(
        ding,
      );
      expect(h.replies(APP_EVENTS_RESPONSE.SET_ALERT_SOUND)).toEqual([
        { success: true, id: "alert-1", request: 3, sound: ding },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "success",
          code: FEEDBACK_CODES.SOUND_ADDED,
          message: 'Sound "ding" added.',
        }),
      ]);
    });

    it("replies the alert's id without a notice when the file can't be used", async () => {
      const { h, storeManagerService } = setup({
        success: false,
        error: "Unsupported audio format: flac",
      });
      pickFiles("/music/ding.flac");

      await h.invoke(alerts, APP_EVENTS.IMPORT_SOUND, {
        id: "alert-1",
        request: 3,
      });

      expect(h.replies(APP_EVENTS_RESPONSE.SET_ALERT_SOUND)).toEqual([
        {
          success: false,
          id: "alert-1",
          request: 3,
          error: {
            code: FEEDBACK_CODES.SOUND_IMPORT_FAILED,
            message:
              "Unable to use the sound. Pick an mp3, wav or ogg file up to 8 MB.",
          },
        },
      ]);
      expect(storeManagerService.addSound).not.toHaveBeenCalled();
      expect(h.notices).toEqual([]);
      expect(logError).not.toHaveBeenCalled();
    });
  });

  describe("TEST_ALERT", () => {
    const setup = (spoken: SpeakResult = { success: true, data: audio }) => {
      const alertsService = {
        readSound: vi.fn(
          async (_file: string): Promise<AlertsResult<Uint8Array>> => ({
            success: true,
            data: audio,
          }),
        ),
        fetchSound: vi.fn(async (_url: string) => ({
          success: true,
          data: audio,
        })),
        speak: vi.fn(
          async (..._args: Parameters<AlertsService["speak"]>) => spoken,
        ),
      };
      const storeManagerService = { getProfileData: async () => profile };
      const h = createHandler({ alertsService, storeManagerService });
      return { h, alertsService };
    };

    it("plays a sound file", async () => {
      const { h, alertsService } = setup();

      await h.invoke(alerts, APP_EVENTS.TEST_ALERT, {
        file: ding.file,
        volume: 80,
        id: "alert-1",
      });

      expect(alertsService.readSound).toHaveBeenCalledExactlyOnceWith(
        ding.file,
      );
      expect(h.replies(APP_EVENTS_RESPONSE.TEST_ALERT)).toEqual([
        {
          success: true,
          id: "alert-1",
          data: audio,
          volume: 80,
          filters: undefined,
        },
      ]);
      expect(h.notices).toEqual([]);
    });

    it("plays a MyInstants sound from its URL", async () => {
      const { h, alertsService } = setup();

      await h.invoke(alerts, APP_EVENTS.TEST_ALERT, {
        url: airhornUrl,
        volume: 100,
        id: airhornUrl,
      });

      expect(alertsService.fetchSound).toHaveBeenCalledExactlyOnceWith(
        airhornUrl,
      );
      expect(alertsService.readSound).not.toHaveBeenCalled();
      expect(h.replies(APP_EVENTS_RESPONSE.TEST_ALERT)).toEqual([
        { success: true, id: airhornUrl, data: audio, volume: 100 },
      ]);
    });

    it("speaks a TTS alert with a sample of its trigger and its speed and pitch", async () => {
      const { h, alertsService } = setup();

      await h.invoke(alerts, APP_EVENTS.TEST_ALERT, {
        tts: speech,
        trigger: TOKIO_EVENTS.FOLLOW,
        volume: 70,
        id: "alert-2",
      });

      expect(alertsService.speak).toHaveBeenCalledExactlyOnceWith(
        speech,
        { user: expect.objectContaining({ username: expect.any(String) }) },
        profile.tts,
      );
      expect(h.replies(APP_EVENTS_RESPONSE.TEST_ALERT)).toEqual([
        {
          success: true,
          id: "alert-2",
          data: audio,
          volume: 70,
          filters: { speed: 1.5, pitch: 0.8 },
        },
      ]);
    });

    it("speaks an Emote alert with a chat sample", async () => {
      const { h, alertsService } = setup();

      await h.invoke(alerts, APP_EVENTS.TEST_ALERT, {
        tts: speech,
        trigger: EMOTE_TRIGGER,
        volume: 70,
        id: "alert-3",
      });

      expect(alertsService.speak.mock.calls[0][1]).toMatchObject({
        user: expect.any(Object),
        comment: { content: expect.any(String), emotes: expect.any(Array) },
      });
    });

    it("warns when the message is empty or has a banned word", async () => {
      const { h } = setup({ success: false, skipped: true });

      await h.invoke(alerts, APP_EVENTS.TEST_ALERT, {
        tts: speech,
        trigger: TOKIO_EVENTS.SHARE,
        volume: 70,
        id: "alert-2",
      });

      const failure = {
        code: FEEDBACK_CODES.ALERT_TTS_FAILED,
        message: "The message is empty or has a banned word.",
      };
      expect(h.replies(APP_EVENTS_RESPONSE.TEST_ALERT)).toEqual([
        { success: false, id: "alert-2", volume: 70, error: failure },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({ level: "warning", ...failure }),
      ]);
      expect(logWarn).toHaveBeenCalledOnce();
    });

    it("asks for another voice when the message can't be spoken", async () => {
      const { h } = setup({ success: false, error: "voice unavailable" });

      await h.invoke(alerts, APP_EVENTS.TEST_ALERT, {
        tts: speech,
        trigger: TOKIO_EVENTS.SHARE,
        volume: 70,
        id: "alert-2",
      });

      const failure = {
        code: FEEDBACK_CODES.ALERT_TTS_FAILED,
        message: "Unable to speak the message. Try another voice.",
      };
      expect(h.replies(APP_EVENTS_RESPONSE.TEST_ALERT)).toEqual([
        { success: false, id: "alert-2", volume: 70, error: failure },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({ level: "error", ...failure }),
      ]);
      // The speaker logged it
      expect(logError).not.toHaveBeenCalled();
    });

    it("replies the test's id and volume when the sound can't be read", async () => {
      const { h, alertsService } = setup();
      alertsService.readSound.mockResolvedValue({
        success: false,
        error: "ENOENT",
      });

      await h.invoke(alerts, APP_EVENTS.TEST_ALERT, {
        file: "gone.mp3",
        volume: 40,
        id: "alert-4",
      });

      const failure = {
        code: FEEDBACK_CODES.SOUND_READ_FAILED,
        message: "Unable to play the sound.",
      };
      expect(h.replies(APP_EVENTS_RESPONSE.TEST_ALERT)).toEqual([
        { success: false, id: "alert-4", volume: 40, error: failure },
      ]);
      expect(h.notices).toEqual([expect.objectContaining(failure)]);
      expect(logError).not.toHaveBeenCalled();
    });
  });

  describe("GET_CUSTOM_GIFTS", () => {
    const galaxy = { value: 9, label: "Galaxy", img: "galaxy.png", coins: 1 };

    it("answers with the gifts saved from LIVEs", async () => {
      const h = createHandler({
        overlayService: { getCustomGifts: async () => [galaxy] },
      });

      await h.invoke(alerts, APP_EVENTS.GET_CUSTOM_GIFTS);

      expect(h.replies(APP_EVENTS_RESPONSE.CUSTOM_GIFTS)).toEqual([
        { data: [galaxy] },
      ]);
    });

    it("answers with no gifts when they can't be read", async () => {
      const h = createHandler({
        overlayService: {
          getCustomGifts: async () => {
            throw new Error("EACCES");
          },
        },
      });

      await h.invoke(alerts, APP_EVENTS.GET_CUSTOM_GIFTS);

      expect(h.replies(APP_EVENTS_RESPONSE.CUSTOM_GIFTS)).toEqual([
        { data: [] },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({
          code: FEEDBACK_CODES.GIFTS_FETCH_FAILED,
          message: "Unable to load the gifts saved from your LIVEs.",
        }),
      ]);
    });
  });

  describe("GET_SOUNDS", () => {
    it("answers with the sound library", async () => {
      const h = createHandler({
        storeManagerService: { getSounds: () => library },
      });

      await h.invoke(alerts, APP_EVENTS.GET_SOUNDS);

      expect(h.replies(APP_EVENTS_RESPONSE.GET_SOUNDS)).toEqual([
        { success: true, data: library },
      ]);
    });

    it("answers with an empty library when it can't be read", async () => {
      const h = createHandler({
        storeManagerService: {
          getSounds: () => {
            throw new Error("Store not initialized");
          },
        },
      });

      await h.invoke(alerts, APP_EVENTS.GET_SOUNDS);

      const failure = {
        code: FEEDBACK_CODES.SOUNDS_LOAD_FAILED,
        message: "Unable to load the sound library.",
      };
      expect(h.replies(APP_EVENTS_RESPONSE.GET_SOUNDS)).toEqual([
        { success: false, data: [], error: failure },
      ]);
      expect(h.notices).toEqual([expect.objectContaining(failure)]);
    });
  });

  describe("UPLOAD_SOUNDS", () => {
    // Imports the mp3 files, refuses the rest
    const setup = () => {
      const alertsService = {
        importSound: vi.fn(
          async (path: string): Promise<AlertsResult<AlertSound>> =>
            path.endsWith(".mp3")
              ? { success: true, data: { name: path, file: `${path}.hash` } }
              : { success: false, error: "Unsupported audio format" },
        ),
      };
      const storeManagerService = {
        addSound: vi.fn(async (_sound: AlertSound) => true),
        getSounds: () => library,
      };
      const h = createHandler({ alertsService, storeManagerService });
      return { h, alertsService, storeManagerService };
    };

    it("does nothing when the dialog is canceled", async () => {
      const { h, alertsService } = setup();

      await h.invoke(alerts, APP_EVENTS.UPLOAD_SOUNDS);

      expect(dialog.showOpenDialog.mock.calls[0][1]).toMatchObject({
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "Audio", extensions: AUDIO_EXTENSIONS }],
      });
      expect(alertsService.importSound).not.toHaveBeenCalled();
      expect(h.replies(APP_EVENTS_RESPONSE.GET_SOUNDS)).toEqual([]);
      expect(h.notices).toEqual([]);
    });

    it.each([
      [["a.mp3"], "1 sound added to the library."],
      [["a.mp3", "b.mp3", "c.mp3"], "3 sounds added to the library."],
    ])("adds every file %o to the library", async (paths, message) => {
      const { h, storeManagerService } = setup();
      pickFiles(...paths);

      await h.invoke(alerts, APP_EVENTS.UPLOAD_SOUNDS);

      expect(storeManagerService.addSound.mock.calls).toEqual(
        paths.map((path) => [{ name: path, file: `${path}.hash` }]),
      );
      expect(h.replies(APP_EVENTS_RESPONSE.GET_SOUNDS)).toEqual([
        { success: true, data: library, error: undefined },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "success",
          source: "alerts",
          code: FEEDBACK_CODES.SOUNDS_UPLOADED,
          message,
        }),
      ]);
    });

    it("adds the good files and counts the ones it couldn't use", async () => {
      const { h, alertsService, storeManagerService } = setup();
      pickFiles("a.flac", "b.mp3", "c.txt");

      await h.invoke(alerts, APP_EVENTS.UPLOAD_SOUNDS);

      expect(alertsService.importSound).toHaveBeenCalledTimes(3);
      expect(storeManagerService.addSound).toHaveBeenCalledExactlyOnceWith({
        name: "b.mp3",
        file: "b.mp3.hash",
      });
      expect(h.replies(APP_EVENTS_RESPONSE.GET_SOUNDS)).toEqual([
        {
          success: false,
          data: library,
          error: {
            code: FEEDBACK_CODES.SOUND_IMPORT_FAILED,
            message:
              "Unable to upload 2 of the sounds. Use mp3, wav or ogg files up to 8 MB.",
          },
        },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "success",
          message: "1 sound added to the library.",
        }),
      ]);
    });

    it("counts only the sounds new to the library", async () => {
      const { h, storeManagerService } = setup();
      const sounds = [{ name: "old", file: "old.mp3.hash" }];
      storeManagerService.getSounds = () => sounds;
      storeManagerService.addSound.mockImplementation(async (sound) => {
        sounds.push(sound);
        return true;
      });
      pickFiles("old.mp3", "a.mp3", "a.mp3");

      await h.invoke(alerts, APP_EVENTS.UPLOAD_SOUNDS);

      expect(storeManagerService.addSound.mock.calls).toEqual([
        [{ name: "a.mp3", file: "a.mp3.hash" }],
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({ message: "1 sound added to the library." }),
      ]);
    });

    it("sends no notice when nothing was added", async () => {
      const { h, storeManagerService } = setup();
      pickFiles("a.flac");

      await h.invoke(alerts, APP_EVENTS.UPLOAD_SOUNDS);

      expect(storeManagerService.addSound).not.toHaveBeenCalled();
      expect(h.replies(APP_EVENTS_RESPONSE.GET_SOUNDS)).toEqual([
        expect.objectContaining({
          success: false,
          error: expect.objectContaining({
            message:
              "Unable to upload 1 of the sounds. Use mp3, wav or ogg files up to 8 MB.",
          }),
        }),
      ]);
      expect(h.notices).toEqual([]);
    });
  });

  describe.each([
    {
      event: APP_EVENTS.REMOVE_SOUND,
      field: "sound",
      file: airhorn.file,
      list: APP_EVENTS_RESPONSE.GET_SOUNDS,
      removed: FEEDBACK_CODES.SOUND_REMOVED,
      failed: FEEDBACK_CODES.SOUND_REMOVE_FAILED,
      notice: "Sound removed.",
      warning:
        "Sound removed from the library, but its file couldn't be deleted.",
    },
    {
      event: APP_EVENTS.REMOVE_MEDIA,
      field: "media",
      file: party.file,
      list: APP_EVENTS_RESPONSE.GET_MEDIA,
      removed: FEEDBACK_CODES.MEDIA_REMOVED,
      failed: FEEDBACK_CODES.MEDIA_REMOVE_FAILED,
      notice: "Media removed.",
      warning:
        "Media removed from the library, but its file couldn't be deleted.",
    },
  ] as const)("$event", (c) => {
    const setup = (
      cleared = true,
      deleted: AlertsResult<void> = { success: true },
    ) => {
      const remove = vi.fn(async (_file: string) => deleted);
      const alertsService = { deleteSound: remove, deleteMedia: remove };
      const storeManagerService = {
        removeSound: vi.fn(async (_file: string) => true),
        removeMedia: vi.fn(async (_file: string) => true),
        removeFromAlerts: vi.fn(
          async (_field: "sound" | "media", _file: string) => cleared,
        ),
        getSounds: () => [ding],
        getMedia: () => [],
      };
      const h = createHandler({ alertsService, storeManagerService });
      return { h, remove, storeManagerService };
    };
    const left = (s: ReturnType<typeof setup>["storeManagerService"]) =>
      c.field === "sound" ? s.getSounds() : s.getMedia();
    const library = (s: ReturnType<typeof setup>["storeManagerService"]) =>
      c.field === "sound" ? s.removeSound : s.removeMedia;

    it("takes the file off every alert, then deletes it", async () => {
      const { h, remove, storeManagerService } = setup();

      await h.invoke(alerts, c.event, { file: c.file });

      expect(library(storeManagerService)).toHaveBeenCalledExactlyOnceWith(
        c.file,
      );
      expect(
        storeManagerService.removeFromAlerts,
      ).toHaveBeenCalledExactlyOnceWith(c.field, c.file);
      expect(remove).toHaveBeenCalledExactlyOnceWith(c.file);
      // The Alerts page takes it off the alerts it shows
      expect(h.replies(APP_EVENTS_RESPONSE.ALERT_FILE_REMOVED)).toEqual([
        { field: c.field, file: c.file },
      ]);
      expect(h.replies(c.list)).toEqual([
        { success: true, data: left(storeManagerService) },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "success",
          code: c.removed,
          message: c.notice,
        }),
      ]);
    });

    // The library and the alerts are without it, only its file is left over.
    it("warns when the file can't be deleted", async () => {
      const { h } = setup(true, { success: false, error: "EBUSY" });

      await h.invoke(alerts, c.event, { file: c.file });

      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "warning",
          code: c.failed,
          message: c.warning,
        }),
      ]);
      expect(logError).not.toHaveBeenCalled();
    });

    it("keeps the file while a profile that has it couldn't be saved", async () => {
      const { h, remove, storeManagerService } = setup(false);

      await h.invoke(alerts, c.event, { file: c.file });

      expect(remove).not.toHaveBeenCalled();
      expect(h.replies(APP_EVENTS_RESPONSE.ALERT_FILE_REMOVED)).toHaveLength(1);
      expect(h.replies(c.list)).toEqual([
        {
          success: false,
          data: left(storeManagerService),
          error: expect.objectContaining({
            code: FEEDBACK_CODES.SETTINGS_SAVE_FAILED,
          }),
        },
      ]);
    });

    it("changes nothing when the library can't be saved", async () => {
      const { h, remove, storeManagerService } = setup();
      library(storeManagerService).mockResolvedValue(false);

      await h.invoke(alerts, c.event, { file: c.file });

      expect(storeManagerService.removeFromAlerts).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
      expect(h.replies(c.list)).toEqual([
        {
          success: false,
          data: left(storeManagerService),
          error: expect.objectContaining({
            code: FEEDBACK_CODES.SETTINGS_SAVE_FAILED,
          }),
        },
      ]);
    });
  });

  describe("IMPORT_MEDIA", () => {
    const setup = (
      res: AlertsResult<MediaFile> = { success: true, data: party },
    ) => {
      const alertsService = {
        importMedia: vi.fn(async (_path: string) => res),
      };
      const storeManagerService = {
        addMedia: vi.fn(async (_media: MediaFile) => true),
        getMedia: () => [party],
      };
      const h = createHandler({ alertsService, storeManagerService });
      return { h, alertsService, storeManagerService };
    };

    it("does nothing when no file is picked", async () => {
      const { h, alertsService } = setup();
      dialog.showOpenDialog.mockResolvedValue({
        canceled: true,
        filePaths: [],
      });

      await h.invoke(alerts, APP_EVENTS.IMPORT_MEDIA, { id: "alert-1" });

      expect(alertsService.importMedia).not.toHaveBeenCalled();
      expect(h.sent()).toEqual([]);
    });

    it("imports the file into the library and gives it to the alert", async () => {
      const { h, alertsService, storeManagerService } = setup();
      pickFiles("/pictures/party.gif");

      await h.invoke(alerts, APP_EVENTS.IMPORT_MEDIA, { id: "alert-1" });

      expect(dialog.showOpenDialog.mock.calls[0][1]).toMatchObject({
        properties: ["openFile"],
        filters: [{ name: "Images and videos", extensions: MEDIA_EXTENSIONS }],
      });
      expect(alertsService.importMedia).toHaveBeenCalledExactlyOnceWith(
        "/pictures/party.gif",
      );
      expect(storeManagerService.addMedia).toHaveBeenCalledExactlyOnceWith(
        party,
      );
      expect(h.replies(APP_EVENTS_RESPONSE.SET_ALERT_MEDIA)).toEqual([
        { success: true, id: "alert-1", media: party },
      ]);
      // The picker stays open, its list gets the file too.
      expect(h.replies(APP_EVENTS_RESPONSE.GET_MEDIA)).toEqual([
        { success: true, data: [party] },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "success",
          code: FEEDBACK_CODES.MEDIA_ADDED,
          message: 'Media "party" added.',
        }),
      ]);
    });

    it("replies the alert's id without a notice when the file can't be used", async () => {
      const { h, storeManagerService } = setup({
        success: false,
        error: "Unsupported format: svg",
      });
      pickFiles("/pictures/icon.svg");

      await h.invoke(alerts, APP_EVENTS.IMPORT_MEDIA, { id: "alert-1" });

      expect(h.replies(APP_EVENTS_RESPONSE.SET_ALERT_MEDIA)).toEqual([
        {
          success: false,
          id: "alert-1",
          error: {
            code: FEEDBACK_CODES.MEDIA_IMPORT_FAILED,
            message:
              "Unable to use the file. Pick a png, jpg, gif, webp, mp4 or webm file up to 50 MB.",
          },
        },
      ]);
      expect(storeManagerService.addMedia).not.toHaveBeenCalled();
      expect(h.notices).toEqual([]);
      expect(logError).not.toHaveBeenCalled();
    });

    it("gives the alert nothing when the library can't be saved", async () => {
      const { h, storeManagerService } = setup();
      storeManagerService.addMedia.mockResolvedValue(false);
      pickFiles("/pictures/party.gif");

      await h.invoke(alerts, APP_EVENTS.IMPORT_MEDIA, { id: "alert-1" });

      expect(h.replies(APP_EVENTS_RESPONSE.SET_ALERT_MEDIA)).toEqual([
        {
          success: false,
          id: "alert-1",
          error: expect.objectContaining({
            code: FEEDBACK_CODES.SETTINGS_SAVE_FAILED,
          }),
        },
      ]);
      expect(h.replies(APP_EVENTS_RESPONSE.GET_MEDIA)).toEqual([]);
    });
  });

  describe("SHOW_ALERT_MEDIA", () => {
    it("has the service show the media on time, with no reply", async () => {
      const showMedia = vi.fn();
      const h = createHandler({ alertsService: { showMedia } });
      const show = {
        id: "alert-1",
        file: party.file,
        delay: 0.1,
        duration: 5,
        volume: 80,
      };

      await h.invoke(alerts, APP_EVENTS.SHOW_ALERT_MEDIA, show);

      expect(showMedia).toHaveBeenCalledExactlyOnceWith(show);
      expect(h.sent()).toEqual([]);
    });
  });

  describe("UPLOAD_MEDIA", () => {
    // Imports the png files, refuses the rest
    const setup = (media: MediaFile[] = []) => {
      const alertsService = {
        importMedia: vi.fn(
          async (path: string): Promise<AlertsResult<MediaFile>> =>
            path.endsWith(".png")
              ? { success: true, data: { name: path, file: `${path}.hash` } }
              : { success: false, error: "Unsupported format" },
        ),
      };
      const storeManagerService = {
        addMedia: vi.fn(async (file: MediaFile) => {
          media.push(file);
          return true;
        }),
        getMedia: () => media,
      };
      const h = createHandler({ alertsService, storeManagerService });
      return { h, alertsService, storeManagerService };
    };

    it("does nothing when the dialog is canceled", async () => {
      const { h, alertsService } = setup();

      await h.invoke(alerts, APP_EVENTS.UPLOAD_MEDIA);

      expect(dialog.showOpenDialog.mock.calls[0][1]).toMatchObject({
        properties: ["openFile", "multiSelections"],
        filters: [{ name: "Images and videos", extensions: MEDIA_EXTENSIONS }],
      });
      expect(alertsService.importMedia).not.toHaveBeenCalled();
      expect(h.sent()).toEqual([]);
    });

    it("adds the new files and counts the ones it couldn't use", async () => {
      const { h, storeManagerService } = setup([
        { name: "old", file: "old.png.hash" },
      ]);
      pickFiles("old.png", "a.png", "b.png", "a.png", "c.svg");

      await h.invoke(alerts, APP_EVENTS.UPLOAD_MEDIA);

      expect(storeManagerService.addMedia.mock.calls).toEqual([
        [{ name: "a.png", file: "a.png.hash" }],
        [{ name: "b.png", file: "b.png.hash" }],
      ]);
      expect(h.replies(APP_EVENTS_RESPONSE.GET_MEDIA)).toEqual([
        {
          success: false,
          data: storeManagerService.getMedia(),
          error: {
            code: FEEDBACK_CODES.MEDIA_IMPORT_FAILED,
            message:
              "Unable to upload 1 of the files. Use png, jpg, gif, webp, mp4 or webm files up to 50 MB.",
          },
        },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "success",
          code: FEEDBACK_CODES.MEDIA_UPLOADED,
          message: "2 files added to the media library.",
        }),
      ]);
    });

    it("says when the library couldn't be saved", async () => {
      const { h, storeManagerService } = setup();
      storeManagerService.addMedia.mockResolvedValue(false);
      pickFiles("a.png");

      await h.invoke(alerts, APP_EVENTS.UPLOAD_MEDIA);

      expect(h.replies(APP_EVENTS_RESPONSE.GET_MEDIA)).toEqual([
        {
          success: false,
          data: [],
          error: expect.objectContaining({
            code: FEEDBACK_CODES.SETTINGS_SAVE_FAILED,
          }),
        },
      ]);
      expect(h.notices).toEqual([]);
    });
  });

  describe("GET_MEDIA", () => {
    it("answers with the media library", async () => {
      const h = createHandler({
        storeManagerService: { getMedia: () => [party] },
      });

      await h.invoke(alerts, APP_EVENTS.GET_MEDIA);

      expect(h.replies(APP_EVENTS_RESPONSE.GET_MEDIA)).toEqual([
        { success: true, data: [party] },
      ]);
    });

    it("answers with an empty library when it can't be read", async () => {
      const h = createHandler({
        storeManagerService: {
          getMedia: () => {
            throw new Error("Store not initialized");
          },
        },
      });

      await h.invoke(alerts, APP_EVENTS.GET_MEDIA);

      const failure = {
        code: FEEDBACK_CODES.MEDIA_LOAD_FAILED,
        message: "Unable to load the media library.",
      };
      expect(h.replies(APP_EVENTS_RESPONSE.GET_MEDIA)).toEqual([
        { success: false, data: [], error: failure },
      ]);
      expect(h.notices).toEqual([expect.objectContaining(failure)]);
    });
  });
});
