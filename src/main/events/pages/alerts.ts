import { AlertTts } from "@/common/schemas";
import {
  AlertTrigger,
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  EMOTE_TRIGGER,
  FEEDBACK_CODES,
  TOKIO_EVENTS,
} from "@/common/types";
import { generateTikTokEventSample } from "@/common/util";
import { createStack, replyFailure } from "@/helper/events";
import { AppFailure, LoggedError, saveFailure } from "@/helper/feedback";
import { AUDIO_EXTENSIONS } from "@/services/alerts";
import { AppHandlerVariables } from "@/types";
import { dialog } from "electron";

const events = createStack("alerts");

events.push(
  APP_EVENTS.UPDATE_ALERTS_SETTINGS,
  async ({ storeManagerService }, e, { settings }) => {
    const res = await storeManagerService.updateProfileData({
      alerts: settings,
    });
    if (!res) throw new Error("The alerts settings were not saved.");
    e.reply(APP_EVENTS_RESPONSE.UPDATE_ALERTS_SETTINGS, { success: true });
  },
  {
    source: "system",
    failure: {
      code: FEEDBACK_CODES.PROFILE_SAVE_FAILED,
      message: "Unable to save the alerts.",
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.UPDATE_ALERTS_SETTINGS),
  },
);

// The sound picker shows these failures itself.
events.push(
  APP_EVENTS.SEARCH_SOUNDS,
  async ({ alertsService }, e, { query, page }) => {
    const res = query?.trim()
      ? await alertsService.search(query.trim(), page)
      : await alertsService.getTrending(page);
    if (!res.success) throw new LoggedError(res.error);

    e.reply(APP_EVENTS_RESPONSE.SEARCH_SOUNDS, {
      success: true,
      query: query ?? "",
      page,
      data: res.data?.sounds ?? [],
      hasNextPage: res.data?.hasNextPage ?? false,
    });
  },
  {
    notify: false,
    failure: {
      code: FEEDBACK_CODES.SOUND_SEARCH_FAILED,
      message: "Unable to reach MyInstants. Try again in a few minutes.",
    },
    onError: (e, error, { query, page }) =>
      e.reply(APP_EVENTS_RESPONSE.SEARCH_SOUNDS, {
        success: false,
        query: query ?? "",
        page,
        data: [],
        hasNextPage: false,
        error,
      }),
  },
);

events.push(
  APP_EVENTS.DOWNLOAD_SOUND,
  async (
    { alertsService, storeManagerService, notifier },
    e,
    { id, url, name },
  ) => {
    const res = await alertsService.downloadSound(url, name);
    if (!res.success || !res.data) throw new LoggedError(res.error);
    // Downloads also go to the sound library.
    if (!(await storeManagerService.addSound(res.data))) throw saveFailure();
    e.reply(APP_EVENTS_RESPONSE.SET_ALERT_SOUND, {
      success: true,
      id,
      sound: res.data,
    });
    notifier.success(
      "alerts",
      FEEDBACK_CODES.SOUND_ADDED,
      `Sound "${name}" added.`,
    );
  },
  {
    notify: false,
    failure: {
      code: FEEDBACK_CODES.SOUND_DOWNLOAD_FAILED,
      message: "Unable to download the sound. Sounds can be up to 8 MB.",
    },
    onError: (e, error, { id }) =>
      e.reply(APP_EVENTS_RESPONSE.SET_ALERT_SOUND, {
        success: false,
        id,
        error,
      }),
  },
);

events.push(
  APP_EVENTS.IMPORT_SOUND,
  async ({ win, alertsService, storeManagerService, notifier }, e, { id }) => {
    const diagRes = await dialog.showOpenDialog(win, {
      title: "Select a sound",
      properties: ["openFile"],
      filters: [{ name: "Audio", extensions: AUDIO_EXTENSIONS }],
    });
    if (diagRes.canceled || !diagRes.filePaths[0]) return;

    const res = await alertsService.importSound(diagRes.filePaths[0]);
    if (!res.success || !res.data) throw new LoggedError(res.error);
    // Uploads also go to the sound library.
    if (!(await storeManagerService.addSound(res.data))) throw saveFailure();
    e.reply(APP_EVENTS_RESPONSE.SET_ALERT_SOUND, {
      success: true,
      id,
      sound: res.data,
    });
    notifier.success(
      "alerts",
      FEEDBACK_CODES.SOUND_ADDED,
      `Sound "${res.data.name}" added.`,
    );
  },
  {
    notify: false,
    failure: {
      code: FEEDBACK_CODES.SOUND_IMPORT_FAILED,
      message:
        "Unable to use the sound. Pick an mp3, wav or ogg file up to 8 MB.",
    },
    onError: (e, error, { id }) =>
      e.reply(APP_EVENTS_RESPONSE.SET_ALERT_SOUND, {
        success: false,
        id,
        error,
      }),
  },
);

// A TTS test speaks the message filled with sample values for its trigger.
const speakTest = async (
  { alertsService, storeManagerService }: AppHandlerVariables,
  tts: AlertTts,
  trigger: AlertTrigger,
) => {
  const profile = await storeManagerService.getProfileData();
  if (!profile) throw new Error("The active profile is missing.");
  const event = trigger === EMOTE_TRIGGER ? TOKIO_EVENTS.CHAT : trigger;
  const res = await alertsService.speak(
    tts,
    generateTikTokEventSample(event).data,
    profile.tts,
  );
  if (res.skipped) {
    throw new AppFailure(
      FEEDBACK_CODES.ALERT_TTS_FAILED,
      "The message is empty or has a banned word.",
      { level: "warning" },
    );
  }
  if (!res.success) {
    throw new AppFailure(
      FEEDBACK_CODES.ALERT_TTS_FAILED,
      "Unable to speak the message. Try another voice.",
      { logged: true },
    );
  }
  return res;
};

events.push(
  APP_EVENTS.TEST_ALERT,
  async (services, e, data) => {
    const { alertsService } = services;
    let res;
    if ("tts" in data) res = await speakTest(services, data.tts, data.trigger);
    else if ("url" in data) res = await alertsService.fetchSound(data.url);
    else res = await alertsService.readSound(data.file);
    if (!res.success) throw new LoggedError(res.error);

    e.reply(APP_EVENTS_RESPONSE.TEST_ALERT, {
      success: true,
      id: data.id,
      data: res.data,
      volume: data.volume,
      filters:
        "tts" in data
          ? { speed: data.tts.speed, pitch: data.tts.pitch }
          : undefined,
    });
  },
  {
    failure: {
      code: FEEDBACK_CODES.SOUND_READ_FAILED,
      message: "Unable to play the sound.",
    },
    onError: (e, error, { id, volume }) =>
      e.reply(APP_EVENTS_RESPONSE.TEST_ALERT, {
        success: false,
        id,
        volume,
        error,
      }),
  },
);

// The ones that follow are pushed with CUSTOM_GIFTS.
events.push(
  APP_EVENTS.GET_CUSTOM_GIFTS,
  async ({ overlayService }, e) => {
    e.reply(APP_EVENTS_RESPONSE.CUSTOM_GIFTS, {
      data: await overlayService.getCustomGifts(),
    });
  },
  {
    failure: {
      code: FEEDBACK_CODES.GIFTS_FETCH_FAILED,
      message: "Unable to load the gifts saved from your LIVEs.",
    },
    onError: (e) => e.reply(APP_EVENTS_RESPONSE.CUSTOM_GIFTS, { data: [] }),
  },
);

events.push(
  APP_EVENTS.GET_SOUNDS,
  ({ storeManagerService }, e) => {
    e.reply(APP_EVENTS_RESPONSE.GET_SOUNDS, {
      success: true,
      data: storeManagerService.getSounds(),
    });
  },
  {
    failure: {
      code: FEEDBACK_CODES.SOUNDS_LOAD_FAILED,
      message: "Unable to load the sound library.",
    },
    onError: (e, error) =>
      e.reply(APP_EVENTS_RESPONSE.GET_SOUNDS, {
        success: false,
        data: [],
        error,
      }),
  },
);

// The sound library shows its failures itself.
events.push(
  APP_EVENTS.UPLOAD_SOUNDS,
  async ({ win, alertsService, storeManagerService, notifier }, e) => {
    const diagRes = await dialog.showOpenDialog(win, {
      title: "Upload sounds",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Audio", extensions: AUDIO_EXTENSIONS }],
    });
    if (diagRes.canceled) return;

    // One bad file doesn't stop the others. The service logs each failure.
    let failed = 0;
    let saved = true;
    for (const path of diagRes.filePaths) {
      const res = await alertsService.importSound(path);
      if (!res.data) failed++;
      else if (!(await storeManagerService.addSound(res.data))) saved = false;
    }
    if (!saved) throw saveFailure();

    const error =
      failed > 0
        ? {
            code: FEEDBACK_CODES.SOUND_IMPORT_FAILED,
            message: `Unable to upload ${failed} of the sounds. Use mp3, wav or ogg files up to 8 MB.`,
          }
        : undefined;

    e.reply(APP_EVENTS_RESPONSE.GET_SOUNDS, {
      success: !error,
      data: storeManagerService.getSounds(),
      error,
    });
    const added = diagRes.filePaths.length - failed;
    if (added > 0) {
      notifier.success(
        "alerts",
        FEEDBACK_CODES.SOUNDS_UPLOADED,
        added === 1
          ? "1 sound added to the library."
          : `${added} sounds added to the library.`,
      );
    }
  },
  {
    notify: false,
    failure: {
      code: FEEDBACK_CODES.SOUND_IMPORT_FAILED,
      message: "Unable to upload the sounds.",
    },
    onError: (e, error, _, { storeManagerService }) =>
      e.reply(APP_EVENTS_RESPONSE.GET_SOUNDS, {
        success: false,
        data: storeManagerService.getSounds(),
        error,
      }),
  },
);

events.push(
  APP_EVENTS.REMOVE_SOUND,
  async ({ alertsService, storeManagerService, notifier }, e, { file }) => {
    if (!(await storeManagerService.removeSound(file))) throw saveFailure();
    // Alerts that already use the sound keep working.
    if (!(await storeManagerService.isSoundInUse(file))) {
      const res = await alertsService.deleteSound(file);
      if (!res.success) throw new LoggedError(res.error);
    }

    e.reply(APP_EVENTS_RESPONSE.GET_SOUNDS, {
      success: true,
      data: storeManagerService.getSounds(),
    });
    notifier.success("alerts", FEEDBACK_CODES.SOUND_REMOVED, "Sound removed.");
  },
  {
    notify: false,
    failure: {
      code: FEEDBACK_CODES.SOUND_REMOVE_FAILED,
      message: "Unable to remove the sound.",
    },
    onError: (e, error, _, { storeManagerService }) =>
      e.reply(APP_EVENTS_RESPONSE.GET_SOUNDS, {
        success: false,
        data: storeManagerService.getSounds(),
        error,
      }),
  },
);

export default events;
