import type { MessageKey } from "@/common/i18n";
import { AlertSound, AlertTts, MediaFile } from "@/common/schemas";
import {
  AlertTrigger,
  AppError,
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  FEEDBACK_CODES,
  Platform,
} from "@/common/types";
import {
  AUDIO_EXTENSIONS,
  generateTriggerSample,
  MEDIA_EXTENSIONS,
} from "@/common/util";
import { showOpenDialog } from "@/helper/dialog";
import { createStack, replyFailure } from "@/helper/events";
import { AppFailure, LoggedError, saveFailure } from "@/helper/feedback";
import { t } from "@/helper/i18n";
import { upload } from "@/helper/library";
import { sendStudioOverlays } from "@/helper/studio";
import type { ServiceResult } from "@/services/shared";
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
      message: "main.failure.updateAlertsSettings",
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
      message: "main.failure.searchSounds",
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
  res: ServiceResult<AlertSound>,
) => {
  if (!res.success || !res.data) throw new LoggedError(res.error);
  const saved = await storeManagerService.addSound(res.data);
  // Main holds it even when the store file wasn't written.
  e.reply(APP_EVENTS_RESPONSE.SET_ALERT_SOUND, {
    success: true,
    id,
    request,
    sound: res.data,
  });
  if (!saved) throw saveFailure();
  notifier.success(
    "alerts",
    FEEDBACK_CODES.SOUND_ADDED,
    t("main.alerts.soundAdded", { name: res.data.name }),
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
      message: "main.failure.downloadSound",
    },
    onError: replySoundFailure,
  },
);

events.push(
  APP_EVENTS.IMPORT_SOUND,
  async (services, e, data) => {
    const diagRes = await showOpenDialog(services.win, {
      title: t("main.dialog.selectSound"),
      properties: ["openFile"],
      filters: [{ name: t("main.dialog.audio"), extensions: AUDIO_EXTENSIONS }],
    });
    if (diagRes.canceled || !diagRes.filePaths[0]) return;

    const res = await services.alertsService.importSound(diagRes.filePaths[0]);
    await addPickedSound(services, e, data, res);
  },
  {
    notify: false,
    failure: {
      code: FEEDBACK_CODES.SOUND_IMPORT_FAILED,
      message: "main.failure.importSound",
    },
    onError: replySoundFailure,
  },
);

// The picker stays open after a pick, so its list gets the new file too.
events.push(
  APP_EVENTS.IMPORT_MEDIA,
  async (
    { win, alertsService, storeManagerService, notifier },
    e,
    { id, request },
  ) => {
    const diagRes = await showOpenDialog(win, {
      title: t("main.dialog.selectMedia"),
      properties: ["openFile"],
      filters: [
        {
          name: t("main.dialog.imagesAndVideos"),
          extensions: MEDIA_EXTENSIONS,
        },
      ],
    });
    if (diagRes.canceled || !diagRes.filePaths[0]) return;

    const res = await alertsService.importMedia(diagRes.filePaths[0]);
    if (!res.success || !res.data) throw new LoggedError(res.error);
    const saved = await storeManagerService.addMedia(res.data);
    // Main holds it even when the store file wasn't written.
    e.reply(APP_EVENTS_RESPONSE.SET_ALERT_MEDIA, {
      success: true,
      id,
      request,
      media: res.data,
    });
    e.reply(APP_EVENTS_RESPONSE.GET_MEDIA, {
      success: true,
      data: storeManagerService.getMedia(),
    });
    if (!saved) throw saveFailure();
    notifier.success(
      "alerts",
      FEEDBACK_CODES.MEDIA_ADDED,
      t("main.alerts.mediaAdded", { name: res.data.name }),
    );
  },
  {
    notify: false,
    failure: {
      code: FEEDBACK_CODES.MEDIA_IMPORT_FAILED,
      message: "main.failure.importMedia",
    },
    onError: (e, error, { id, request }) =>
      e.reply(APP_EVENTS_RESPONSE.SET_ALERT_MEDIA, {
        success: false,
        id,
        request,
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

// A TTS test speaks the message filled with sample values for its trigger,
// as the platform would send them.
const speakTest = async (
  { alertsService, storeManagerService }: AppHandlerVariables,
  tts: AlertTts,
  trigger: AlertTrigger,
  platform?: Platform,
) => {
  const profile = await storeManagerService.getProfileData();
  if (!profile) throw new Error("The active profile is missing.");
  const res = await alertsService.speak(
    tts,
    generateTriggerSample(trigger, platform),
    profile.tts,
  );
  if (res.skipped) {
    throw new AppFailure(
      FEEDBACK_CODES.ALERT_TTS_FAILED,
      t("main.alerts.ttsSkipped"),
      { level: "warning" },
    );
  }
  if (!res.success) {
    throw new AppFailure(
      FEEDBACK_CODES.ALERT_TTS_FAILED,
      t("main.alerts.ttsFailed"),
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
    if ("tts" in data) {
      res = await speakTest(services, data.tts, data.trigger, data.platform);
    } else if ("url" in data) res = await alertsService.fetchSound(data.url);
    else res = await alertsService.readSound(data.file);
    if (!res.success) throw new LoggedError(res.error);

    e.reply(APP_EVENTS_RESPONSE.TEST_ALERT, {
      success: true,
      id: data.id,
      request: data.request,
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
      message: "main.failure.testAlert",
    },
    onError: (e, error, { id, request, volume }) =>
      e.reply(APP_EVENTS_RESPONSE.TEST_ALERT, {
        success: false,
        id,
        request,
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
      message: "main.failure.getSoundData",
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
      message: "main.failure.getCustomGifts",
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
      message: "main.failure.getSounds",
    },
    onError: (e, error) =>
      e.reply(APP_EVENTS_RESPONSE.GET_SOUNDS, {
        success: false,
        data: [],
        error,
      }),
  },
);

type Store = AppHandlerVariables["storeManagerService"];

// What the sound and the media library's handlers differ in
interface Library {
  field: "sound" | "media";
  // Replies the library as main holds it
  reply: (e: ReplyEvent, store: Store, error?: AppError) => void;
  list: (store: Store) => MediaFile[];
  add: (store: Store, files: MediaFile[]) => Promise<boolean>;
  remove: (store: Store, file: string) => Promise<boolean>;
  importFile: (
    services: AppHandlerVariables,
    path: string,
  ) => Promise<ServiceResult<MediaFile>>;
  deleteFile: (
    services: AppHandlerVariables,
    file: string,
  ) => Promise<ServiceResult<void>>;
  dialog: { title: MessageKey; filter: MessageKey; extensions: string[] };
  codes: {
    uploaded: FEEDBACK_CODES;
    uploadFailed: FEEDBACK_CODES;
    removed: FEEDBACK_CODES;
    removeFailed: FEEDBACK_CODES;
  };
  text: {
    uploaded: MessageKey;
    uploadFailed: MessageKey;
    removed: MessageKey;
    fileNotDeleted: MessageKey;
    failedUpload: MessageKey;
    failedRemove: MessageKey;
  };
}

const SOUNDS: Library = {
  field: "sound",
  reply: (e, store, error) =>
    e.reply(APP_EVENTS_RESPONSE.GET_SOUNDS, {
      success: !error,
      data: store.getSounds(),
      error,
    }),
  list: (store) => store.getSounds(),
  add: (store, files) => store.addSounds(files),
  remove: (store, file) => store.removeSound(file),
  importFile: ({ alertsService }, path) => alertsService.importSound(path),
  deleteFile: ({ alertsService }, file) => alertsService.deleteSound(file),
  dialog: {
    title: "main.dialog.uploadSounds",
    filter: "main.dialog.audio",
    extensions: AUDIO_EXTENSIONS,
  },
  codes: {
    uploaded: FEEDBACK_CODES.SOUNDS_UPLOADED,
    uploadFailed: FEEDBACK_CODES.SOUND_IMPORT_FAILED,
    removed: FEEDBACK_CODES.SOUND_REMOVED,
    removeFailed: FEEDBACK_CODES.SOUND_REMOVE_FAILED,
  },
  text: {
    uploaded: "main.alerts.soundsUploaded",
    uploadFailed: "main.alerts.soundsUploadFailed",
    removed: "main.alerts.soundRemoved",
    fileNotDeleted: "main.alerts.soundFileNotDeleted",
    failedUpload: "main.failure.uploadSounds",
    failedRemove: "main.failure.removeSound",
  },
};

const MEDIA: Library = {
  field: "media",
  reply: (e, store, error) =>
    e.reply(APP_EVENTS_RESPONSE.GET_MEDIA, {
      success: !error,
      data: store.getMedia(),
      error,
    }),
  list: (store) => store.getMedia(),
  add: (store, files) => store.addMediaFiles(files),
  remove: (store, file) => store.removeMedia(file),
  importFile: ({ alertsService }, path) => alertsService.importMedia(path),
  deleteFile: async (services, file) => {
    // Studio elements that show it stay, empty. Like the alerts, they keep
    // the file when the store can't be saved.
    const cleared = await services.storeManagerService.removeFromStudio(file);
    await sendStudioOverlays(services);
    if (!cleared) throw saveFailure();
    return services.alertsService.deleteMedia(file);
  },
  dialog: {
    title: "main.dialog.uploadMedia",
    filter: "main.dialog.imagesAndVideos",
    extensions: MEDIA_EXTENSIONS,
  },
  codes: {
    uploaded: FEEDBACK_CODES.MEDIA_UPLOADED,
    uploadFailed: FEEDBACK_CODES.MEDIA_IMPORT_FAILED,
    removed: FEEDBACK_CODES.MEDIA_REMOVED,
    removeFailed: FEEDBACK_CODES.MEDIA_REMOVE_FAILED,
  },
  text: {
    uploaded: "main.alerts.mediaUploaded",
    uploadFailed: "main.alerts.mediaUploadFailed",
    removed: "main.alerts.mediaRemoved",
    fileNotDeleted: "main.alerts.mediaFileNotDeleted",
    failedUpload: "main.failure.uploadMedia",
    failedRemove: "main.failure.removeMedia",
  },
};

// The library shows its failures itself.
function pushUpload(
  event: APP_EVENTS.UPLOAD_SOUNDS | APP_EVENTS.UPLOAD_MEDIA,
  library: Library,
) {
  const { codes, text, dialog } = library;
  events.push(
    event,
    async (services, e) => {
      const { win, storeManagerService: store, notifier } = services;
      const diagRes = await showOpenDialog(win, {
        title: t(dialog.title),
        properties: ["openFile", "multiSelections"],
        filters: [{ name: t(dialog.filter), extensions: dialog.extensions }],
      });
      if (diagRes.canceled) return;

      const { failed, added } = await upload(
        diagRes.filePaths,
        (path) => library.importFile(services, path),
        {
          list: () => library.list(store),
          add: (files) => library.add(store, files),
        },
      );
      const error =
        failed > 0
          ? {
              code: codes.uploadFailed,
              message: t(text.uploadFailed, { failed }),
            }
          : undefined;

      library.reply(e, store, error);
      if (added > 0) {
        notifier.success(
          "alerts",
          codes.uploaded,
          t(text.uploaded, { count: added }),
        );
      }
    },
    {
      notify: false,
      failure: { code: codes.uploadFailed, message: text.failedUpload },
      onError: (e, error, _, { storeManagerService }) =>
        library.reply(e, storeManagerService, error),
    },
  );
}

// A file taken out of its library leaves every alert that had it, in every
// profile, and the Alerts page drops it too. Then it's deleted, unless a
// profile couldn't be saved: its alerts still need the file. The service logs
// a failed delete. The library shows its failures itself.
function pushRemove(
  event: APP_EVENTS.REMOVE_SOUND | APP_EVENTS.REMOVE_MEDIA,
  library: Library,
) {
  const { field, codes, text } = library;
  events.push(
    event,
    async (services, e, { file }) => {
      const { storeManagerService: store, notifier } = services;
      if (!(await library.remove(store, file))) throw saveFailure();
      const cleared = await store.removeFromAlerts(field, file);
      e.reply(APP_EVENTS_RESPONSE.ALERT_FILE_REMOVED, { field, file });
      if (!cleared) throw saveFailure();
      const { success } = await library.deleteFile(services, file);

      library.reply(e, store);
      if (success) {
        notifier.success("alerts", codes.removed, t(text.removed));
      } else {
        notifier.warn("alerts", codes.removeFailed, t(text.fileNotDeleted));
      }
    },
    {
      notify: false,
      failure: { code: codes.removeFailed, message: text.failedRemove },
      onError: (e, error, _, { storeManagerService }) =>
        library.reply(e, storeManagerService, error),
    },
  );
}

pushUpload(APP_EVENTS.UPLOAD_SOUNDS, SOUNDS);
pushRemove(APP_EVENTS.REMOVE_SOUND, SOUNDS);
pushUpload(APP_EVENTS.UPLOAD_MEDIA, MEDIA);

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
      message: "main.failure.getMedia",
    },
    onError: (e, error) =>
      e.reply(APP_EVENTS_RESPONSE.GET_MEDIA, {
        success: false,
        data: [],
        error,
      }),
  },
);

pushRemove(APP_EVENTS.REMOVE_MEDIA, MEDIA);

export default events;
