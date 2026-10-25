import { AlertSound, AlertTts, MediaFile } from "@/common/schemas";
import {
  AlertTrigger,
  AppError,
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  EMOTE_TRIGGER,
  FEEDBACK_CODES,
  TOKIO_EVENTS,
} from "@/common/types";
import {
  AUDIO_EXTENSIONS,
  generateTikTokEventSample,
  MEDIA_EXTENSIONS,
} from "@/common/util";
import { showOpenDialog } from "@/helper/dialog";
import { createStack, replyFailure } from "@/helper/events";
import { AppFailure, LoggedError, saveFailure } from "@/helper/feedback";
import { AlertsResult } from "@/services/alerts";
import { AppHandlerVariables, ReplyEvent } from "@/types";

const events = createStack("alerts");

events.push(
  APP_EVENTS.UPDATE_ALERTS_SETTINGS,
  async ({ storeManagerService }, e, { settings }) => {
    const res = await storeManagerService.updateProfileData({
      alerts: settings,
    });
    if (!res) throw new LoggedError("The alerts settings were not saved.");
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

// Downloaded and uploaded sounds also go to the sound library.
const addPickedSound = async (
  { storeManagerService, notifier }: AppHandlerVariables,
  e: ReplyEvent,
  { id, request }: { id: string; request: number },
  res: AlertsResult<AlertSound>,
) => {
  if (!res.success || !res.data) throw new LoggedError(res.error);
  if (!(await storeManagerService.addSound(res.data))) throw saveFailure();
  e.reply(APP_EVENTS_RESPONSE.SET_ALERT_SOUND, {
    success: true,
    id,
    request,
    sound: res.data,
  });
  notifier.success(
    "alerts",
    FEEDBACK_CODES.SOUND_ADDED,
    `Sound "${res.data.name}" added.`,
  );
};

const replySoundFailure = (
  e: ReplyEvent,
  error: AppError,
  { id, request }: { id: string; request: number },
) =>
  e.reply(APP_EVENTS_RESPONSE.SET_ALERT_SOUND, {
    success: false,
    id,
    request,
    error,
  });

events.push(
  APP_EVENTS.DOWNLOAD_SOUND,
  async (services, e, { id, request, url, name }) => {
    const res = await services.alertsService.downloadSound(url, name);
    await addPickedSound(services, e, { id, request }, res);
  },
  {
    notify: false,
    failure: {
      code: FEEDBACK_CODES.SOUND_DOWNLOAD_FAILED,
      message: "Unable to download the sound. Sounds can be up to 8 MB.",
    },
    onError: replySoundFailure,
  },
);

events.push(
  APP_EVENTS.IMPORT_SOUND,
  async (services, e, data) => {
    const diagRes = await showOpenDialog(services.win, {
      title: "Select a sound",
      properties: ["openFile"],
      filters: [{ name: "Audio", extensions: AUDIO_EXTENSIONS }],
    });
    if (diagRes.canceled || !diagRes.filePaths[0]) return;

    const res = await services.alertsService.importSound(diagRes.filePaths[0]);
    await addPickedSound(services, e, data, res);
  },
  {
    notify: false,
    failure: {
      code: FEEDBACK_CODES.SOUND_IMPORT_FAILED,
      message:
        "Unable to use the sound. Pick an mp3, wav or ogg file up to 8 MB.",
    },
    onError: replySoundFailure,
  },
);

// The picker stays open after a pick, so its list gets the new file too.
events.push(
  APP_EVENTS.IMPORT_MEDIA,
  async ({ win, alertsService, storeManagerService, notifier }, e, { id }) => {
    const diagRes = await showOpenDialog(win, {
      title: "Select an image or video",
      properties: ["openFile"],
      filters: [{ name: "Images and videos", extensions: MEDIA_EXTENSIONS }],
    });
    if (diagRes.canceled || !diagRes.filePaths[0]) return;

    const res = await alertsService.importMedia(diagRes.filePaths[0]);
    if (!res.success || !res.data) throw new LoggedError(res.error);
    if (!(await storeManagerService.addMedia(res.data))) throw saveFailure();
    e.reply(APP_EVENTS_RESPONSE.SET_ALERT_MEDIA, {
      success: true,
      id,
      media: res.data,
    });
    e.reply(APP_EVENTS_RESPONSE.GET_MEDIA, {
      success: true,
      data: storeManagerService.getMedia(),
    });
    notifier.success(
      "alerts",
      FEEDBACK_CODES.MEDIA_ADDED,
      `Media "${res.data.name}" added.`,
    );
  },
  {
    notify: false,
    failure: {
      code: FEEDBACK_CODES.MEDIA_IMPORT_FAILED,
      message:
        "Unable to use the file. Pick a png, jpg, gif, webp, mp4 or webm file up to 50 MB.",
    },
    onError: (e, error, { id }) =>
      e.reply(APP_EVENTS_RESPONSE.SET_ALERT_MEDIA, {
        success: false,
        id,
        error,
      }),
  },
);

// The window's queue reached an alert with media: main shows it on time.
events.push(
  APP_EVENTS.SHOW_ALERT_MEDIA,
  ({ alertsService }, _, data) => {
    alertsService.showMedia(data);
  },
  { notify: false },
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

events.push(
  APP_EVENTS.GET_SOUND_DATA,
  async ({ alertsService }, e, { file }) => {
    const res = await alertsService.readSound(file);
    if (!res.success) throw new LoggedError(res.error);
    e.reply(APP_EVENTS_RESPONSE.SOUND_DATA, {
      success: true,
      file,
      data: res.data,
    });
  },
  {
    // The editor says it couldn't read the sound
    notify: false,
    failure: {
      code: FEEDBACK_CODES.SOUND_READ_FAILED,
      message: "Unable to read the sound.",
    },
    onError: (e, error, { file }) =>
      e.reply(APP_EVENTS_RESPONSE.SOUND_DATA, { success: false, file, error }),
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

// Copies the files into a library. One bad file doesn't stop the others,
// the service logs each failure. Throws when the library couldn't be saved.
const upload = async (
  paths: string[],
  importFile: (path: string) => Promise<AlertsResult<MediaFile>>,
  library: {
    list: () => MediaFile[];
    add: (file: MediaFile) => Promise<boolean>;
  },
) => {
  let failed = 0;
  let added = 0;
  let saved = true;
  for (const path of paths) {
    const entry = (await importFile(path)).data;
    if (!entry) {
      failed++;
      continue;
    }
    // Files are named by content: one in the library, or picked twice, isn't new.
    if (library.list().some((f) => f.file === entry.file)) continue;
    if (await library.add(entry)) added++;
    else saved = false;
  }
  if (!saved) throw saveFailure();
  return { failed, added };
};

// The sound library shows its failures itself.
events.push(
  APP_EVENTS.UPLOAD_SOUNDS,
  async ({ win, alertsService, storeManagerService, notifier }, e) => {
    const diagRes = await showOpenDialog(win, {
      title: "Upload sounds",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Audio", extensions: AUDIO_EXTENSIONS }],
    });
    if (diagRes.canceled) return;

    const { failed, added } = await upload(
      diagRes.filePaths,
      (path) => alertsService.importSound(path),
      {
        list: () => storeManagerService.getSounds(),
        add: (sound) => storeManagerService.addSound(sound),
      },
    );

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

// A file taken out of its library leaves every alert that had it, in every
// profile, and the Alerts page drops it too. Then it's deleted, unless a
// profile couldn't be saved: its alerts still need the file. The service logs
// a failed delete.
const deleteFile = async (
  { storeManagerService }: AppHandlerVariables,
  e: ReplyEvent,
  field: "sound" | "media",
  file: string,
  remove: (file: string) => Promise<AlertsResult<void>>,
) => {
  const cleared = await storeManagerService.removeFromAlerts(field, file);
  e.reply(APP_EVENTS_RESPONSE.ALERT_FILE_REMOVED, { field, file });
  if (!cleared) throw saveFailure();
  return (await remove(file)).success;
};

events.push(
  APP_EVENTS.REMOVE_SOUND,
  async (services, e, { file }) => {
    const { alertsService, storeManagerService, notifier } = services;
    if (!(await storeManagerService.removeSound(file))) throw saveFailure();
    const deleted = await deleteFile(services, e, "sound", file, (f) =>
      alertsService.deleteSound(f),
    );

    e.reply(APP_EVENTS_RESPONSE.GET_SOUNDS, {
      success: true,
      data: storeManagerService.getSounds(),
    });
    if (deleted) {
      notifier.success(
        "alerts",
        FEEDBACK_CODES.SOUND_REMOVED,
        "Sound removed.",
      );
    } else {
      notifier.warn(
        "alerts",
        FEEDBACK_CODES.SOUND_REMOVE_FAILED,
        "Sound removed from the library, but its file couldn't be deleted.",
      );
    }
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

// The media library shows its failures itself.
events.push(
  APP_EVENTS.UPLOAD_MEDIA,
  async ({ win, alertsService, storeManagerService, notifier }, e) => {
    const diagRes = await showOpenDialog(win, {
      title: "Upload images and videos",
      properties: ["openFile", "multiSelections"],
      filters: [{ name: "Images and videos", extensions: MEDIA_EXTENSIONS }],
    });
    if (diagRes.canceled) return;

    const { failed, added } = await upload(
      diagRes.filePaths,
      (path) => alertsService.importMedia(path),
      {
        list: () => storeManagerService.getMedia(),
        add: (media) => storeManagerService.addMedia(media),
      },
    );
    const error =
      failed > 0
        ? {
            code: FEEDBACK_CODES.MEDIA_IMPORT_FAILED,
            message: `Unable to upload ${failed} of the files. Use png, jpg, gif, webp, mp4 or webm files up to 50 MB.`,
          }
        : undefined;

    e.reply(APP_EVENTS_RESPONSE.GET_MEDIA, {
      success: !error,
      data: storeManagerService.getMedia(),
      error,
    });
    if (added > 0) {
      notifier.success(
        "alerts",
        FEEDBACK_CODES.MEDIA_UPLOADED,
        added === 1
          ? "1 file added to the media library."
          : `${added} files added to the media library.`,
      );
    }
  },
  {
    notify: false,
    failure: {
      code: FEEDBACK_CODES.MEDIA_IMPORT_FAILED,
      message: "Unable to upload the files.",
    },
    onError: (e, error, _, { storeManagerService }) =>
      e.reply(APP_EVENTS_RESPONSE.GET_MEDIA, {
        success: false,
        data: storeManagerService.getMedia(),
        error,
      }),
  },
);

events.push(
  APP_EVENTS.GET_MEDIA,
  ({ storeManagerService }, e) => {
    e.reply(APP_EVENTS_RESPONSE.GET_MEDIA, {
      success: true,
      data: storeManagerService.getMedia(),
    });
  },
  {
    failure: {
      code: FEEDBACK_CODES.MEDIA_LOAD_FAILED,
      message: "Unable to load the media library.",
    },
    onError: (e, error) =>
      e.reply(APP_EVENTS_RESPONSE.GET_MEDIA, {
        success: false,
        data: [],
        error,
      }),
  },
);

// The media picker shows its failures itself.
events.push(
  APP_EVENTS.REMOVE_MEDIA,
  async (services, e, { file }) => {
    const { alertsService, storeManagerService, notifier } = services;
    if (!(await storeManagerService.removeMedia(file))) throw saveFailure();
    const deleted = await deleteFile(services, e, "media", file, (f) =>
      alertsService.deleteMedia(f),
    );

    e.reply(APP_EVENTS_RESPONSE.GET_MEDIA, {
      success: true,
      data: storeManagerService.getMedia(),
    });
    if (deleted) {
      notifier.success(
        "alerts",
        FEEDBACK_CODES.MEDIA_REMOVED,
        "Media removed.",
      );
    } else {
      notifier.warn(
        "alerts",
        FEEDBACK_CODES.MEDIA_REMOVE_FAILED,
        "Media removed from the library, but its file couldn't be deleted.",
      );
    }
  },
  {
    notify: false,
    failure: {
      code: FEEDBACK_CODES.MEDIA_REMOVE_FAILED,
      message: "Unable to remove the media.",
    },
    onError: (e, error, _, { storeManagerService }) =>
      e.reply(APP_EVENTS_RESPONSE.GET_MEDIA, {
        success: false,
        data: storeManagerService.getMedia(),
        error,
      }),
  },
);

export default events;
