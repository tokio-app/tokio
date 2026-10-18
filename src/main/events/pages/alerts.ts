import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  FEEDBACK_CODES,
} from "@/common/types";
import { createStack, replyFailure } from "@/helper/events";
import { LoggedError } from "@/helper/feedback";
import { AUDIO_EXTENSIONS } from "@/services/alerts";
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
    await storeManagerService.addSound(res.data);
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
      message: "Unable to download the sound.",
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
    await storeManagerService.addSound(res.data);
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
      message: "Unable to use the sound. Pick an mp3, wav or ogg file.",
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
  APP_EVENTS.TEST_ALERT,
  async ({ alertsService }, e, data) => {
    const res =
      "url" in data
        ? await alertsService.fetchSound(data.url)
        : await alertsService.readSound(data.file);
    if (!res.success) throw new LoggedError(res.error);

    e.reply(APP_EVENTS_RESPONSE.TEST_ALERT, {
      success: true,
      id: data.id,
      data: res.data,
      volume: data.volume,
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
    for (const path of diagRes.filePaths) {
      const res = await alertsService.importSound(path);
      if (res.data) await storeManagerService.addSound(res.data);
      else failed++;
    }

    const error =
      failed > 0
        ? {
            code: FEEDBACK_CODES.SOUND_IMPORT_FAILED,
            message: `Unable to upload ${failed} of the sounds. Use mp3, wav or ogg files.`,
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
    await storeManagerService.removeSound(file);
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
