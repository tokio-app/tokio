import { APP_LANGUAGES } from "@/common/i18n";
import { Profile, ProfileSchema } from "@/common/schemas";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  AppEventsResponseMap,
  FEEDBACK_CODES,
} from "@/common/types";
import { SERVER_PORT, TRANSLATION_LANGUAGES } from "@/common/util";
import { showOpenDialog, showSaveDialog } from "@/helper/dialog";
import { createStack, replyFailure } from "@/helper/events";
import { AppFailure, logsPlace, saveFailure } from "@/helper/feedback";
import { writeFileAtomic } from "@/helper/fs";
import { sendGamesOverlay } from "@/helper/games";
import { refreshTikTokGifts, usesTikTok } from "@/helper/gifts";
import { language, setLanguage, t } from "@/helper/i18n";
import { takenShortcuts } from "@/helper/shortcuts";
import Logger, { localTime } from "@/logger";
import { profileSlug, StoreManagerService } from "@/services/store";
import { chatCommands } from "@/services/translation/commands";
import { reasonKey, TranslationError } from "@/services/translation/common";
import { TTSService } from "@/services/tts";
import { AppHandlerVariables, ReplyEvent } from "@/types";

const events = createStack("system");

const MIN_NAME = ProfileSchema.shape.name.minLength ?? 1;

// What the file dialogs call each kind of entity
const ENTITY_NAMES = { profile: "main.settings.entity.profile" } as const;

// The name trimmed, for a new profile or the one in `own`'s file. A shorter
// name would make the profile fail to load, and two profiles can't share one,
// whatever its case and surrounding spaces.
const checkName = (store: StoreManagerService, input: string, own?: string) => {
  const name = input.trim();
  if (name.length < MIN_NAME) {
    throw new AppFailure(
      FEEDBACK_CODES.PROFILE_NAME_INVALID,
      t("main.settings.nameTooShort", { count: MIN_NAME }),
      { level: "warning" },
    );
  }
  const wanted = name.toLowerCase();
  const taken = store
    .getProfiles()
    .some((p) => p.file !== own && p.name.trim().toLowerCase() === wanted);
  if (taken) {
    throw new AppFailure(
      FEEDBACK_CODES.PROFILE_EXISTS,
      t("main.settings.nameTaken", { name }),
      { level: "warning" },
    );
  }
  return name;
};

// Changes to the settings also send the updated settings and profiles.
export const replySettings = (e: ReplyEvent, store: StoreManagerService) => {
  e.reply(APP_EVENTS_RESPONSE.GET_SETTINGS, {
    data: {
      settings: store.getSettings(),
      profiles: store.getProfiles(),
    },
    success: true,
  });
};

// GET_PROFILE's reply for the active profile, with its file: pages tell a
// switch from a rename by it
export const profileReply = (
  store: StoreManagerService,
  profile: Profile,
): AppEventsResponseMap[APP_EVENTS_RESPONSE.GET_PROFILE] => ({
  success: true,
  profile,
  profiles: store.getProfiles(),
  file: store.getSettings().activeProfile.file,
});

events.push(
  APP_EVENTS.GET_SETTINGS,
  ({ storeManagerService: store }, e) => {
    // Only its own reply carries them: the page keeps its mark otherwise
    e.reply(APP_EVENTS_RESPONSE.GET_SETTINGS, {
      data: { settings: store.getSettings(), profiles: store.getProfiles() },
      success: true,
      taken: takenShortcuts(),
    });
  },
  {
    failure: {
      code: FEEDBACK_CODES.SETTINGS_LOAD_FAILED,
      message: "main.failure.getSettings",
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.GET_SETTINGS),
  },
);

// A profile the store wrote but couldn't list: the page gets the profiles
// main still holds.
const assertListed = (
  e: ReplyEvent,
  store: StoreManagerService,
  res: Awaited<ReturnType<StoreManagerService["importProfile"]>>,
  what: string,
) => {
  if (res === "unsaved") {
    replySettings(e, store);
    throw saveFailure();
  }
  if (!res) throw new Error(`${what} failed.`);
};

// Creating and cloning differ only in what writes the new profile's file.
// Answers with the trimmed name.
const addProfile = async (
  e: ReplyEvent,
  store: StoreManagerService,
  input: string,
  response:
    APP_EVENTS_RESPONSE.CREATE_PROFILE | APP_EVENTS_RESPONSE.CLONE_PROFILE,
  write: (name: string) => ReturnType<StoreManagerService["createNewProfile"]>,
) => {
  const name = checkName(store, input);
  assertListed(e, store, await write(name), `Writing the profile "${name}"`);

  e.reply(response, {
    success: true,
  });
  replySettings(e, store);
  return name;
};

events.push(
  APP_EVENTS.CREATE_PROFILE,
  async ({ storeManagerService: store, notifier }, e, { name: input }) => {
    const name = await addProfile(
      e,
      store,
      input,
      APP_EVENTS_RESPONSE.CREATE_PROFILE,
      (name) => store.createNewProfile(name),
    );
    notifier.success(
      "system",
      FEEDBACK_CODES.PROFILE_CREATED,
      t("main.settings.profileCreated", { name }),
    );
  },
  {
    failure: {
      code: FEEDBACK_CODES.PROFILE_CREATE_FAILED,
      message: "main.failure.createProfile",
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.CREATE_PROFILE),
  },
);

events.push(
  APP_EVENTS.CLONE_PROFILE,
  async ({ storeManagerService: store, notifier }, e, { name: input, ref }) => {
    const name = await addProfile(
      e,
      store,
      input,
      APP_EVENTS_RESPONSE.CLONE_PROFILE,
      (name) => store.cloneProfile(ref, name),
    );
    notifier.success(
      "system",
      FEEDBACK_CODES.PROFILE_CLONED,
      t("main.settings.profileCloned", { name }),
    );
  },
  {
    failure: {
      code: FEEDBACK_CODES.PROFILE_CLONE_FAILED,
      message: "main.failure.cloneProfile",
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.CLONE_PROFILE),
  },
);

// Only the name users see: the file, and so its fans, history and timer, stay
events.push(
  APP_EVENTS.RENAME_PROFILE,
  async (
    { storeManagerService: store, notifier },
    e,
    { file, name: input },
  ) => {
    const name = checkName(store, input, file);
    // Nothing to save or tell
    const unchanged =
      store
        .getProfiles()
        .find((p) => p.file === file)
        ?.name.trim() === name;
    if (!unchanged) {
      const res = await store.renameProfile(file, name);
      if (res === "unsaved") {
        replySettings(e, store);
        throw saveFailure();
      }
      if (!res) throw new Error(`Renaming the profile ${file} failed.`);
    }

    e.reply(APP_EVENTS_RESPONSE.RENAME_PROFILE, { success: true, file });
    if (unchanged) return;
    replySettings(e, store);
    notifier.success(
      "system",
      FEEDBACK_CODES.PROFILE_RENAMED,
      t("main.settings.profileRenamed", { name }),
    );
  },
  {
    failure: {
      code: FEEDBACK_CODES.PROFILE_RENAME_FAILED,
      message: "main.failure.renameProfile",
    },
    onError: (e, error, { file }) =>
      e.reply(APP_EVENTS_RESPONSE.RENAME_PROFILE, {
        success: false,
        file,
        error,
      }),
  },
);

const assertDisconnected = (services: AppHandlerVariables) => {
  if (services.connectorService.isConnected()) {
    throw new AppFailure(
      FEEDBACK_CODES.PROFILE_LOCKED,
      t("main.settings.profileLocked"),
      { level: "warning" },
    );
  }
};

const switchProfile = async (
  services: AppHandlerVariables,
  e: ReplyEvent,
  file: string,
) => {
  const { storeManagerService, timerService, notifier } = services;
  // The switch before this one may have made it active
  if (file === storeManagerService.getSettings().activeProfile.file) return;
  // The timer, the fans and the LIVE history are saved where they came from
  // before the profile is replaced, so they're never lost
  if (!(await timerService.save())) throw saveFailure();
  if (!(await services.fansService.save())) throw saveFailure();
  if (!(await services.historyService.save())) throw saveFailure();
  // A LIVE may have connected while they saved
  assertDisconnected(services);
  const res = await storeManagerService.updateActiveProfile(file);
  if (res === "unsaved") throw saveFailure();
  if (res === "missing") {
    throw new AppFailure(
      FEEDBACK_CODES.PROFILE_LOAD_FAILED,
      t("main.settings.profileMissing"),
    );
  }
  const profile = await storeManagerService.getProfileData();
  if (!profile) throw new Error(`Unable to load ${file}.`);
  timerService.load(profile.timer, file, profile.platforms);
  // Overlays get the new profile's fans once they load
  if (!(await services.fansService.load(file))) {
    notifier.warn(
      "overlays",
      FEEDBACK_CODES.FANS_LOAD_FAILED,
      t("main.fans.loadFailed"),
    );
  }
  if (!(await services.historyService.load(file))) {
    notifier.warn(
      "system",
      FEEDBACK_CODES.HISTORY_LOAD_FAILED,
      t("main.lives.historyLoadFailed"),
    );
  }
  // A switch, so every backlog stops: clones keep the action ids
  services.gamesService.setGames(profile.games, true);
  // TikTok's gifts, the first time a profile with TikTok is picked. Switches
  // wait on each other, so this one doesn't wait for it.
  if (usesTikTok(profile.platforms)) void refreshTikTokGifts(services);

  e.reply(
    APP_EVENTS_RESPONSE.GET_PROFILE,
    profileReply(storeManagerService, profile),
  );
  replySettings(e, storeManagerService);
  notifier.success(
    "system",
    FEEDBACK_CODES.PROFILE_SWITCHED,
    t("main.settings.profileSwitched", {
      name: storeManagerService.getSettings().activeProfile.name,
    }),
  );
  // The new profile's actions
  await sendGamesOverlay(services);
};

// The last switch, so a second one starts once the first is done: both would
// save the old profile's timer, fans and history, then load their own.
let switching: Promise<unknown> = Promise.resolve();

events.push(
  APP_EVENTS.SET_PROFILE,
  async (services, e, { file }) => {
    // Picking the active profile again changes nothing, even during a LIVE
    if (file === services.storeManagerService.getSettings().activeProfile.file)
      return;
    assertDisconnected(services);
    const run = switching.then(() => switchProfile(services, e, file));
    // A failed switch still reaches runEvent, and doesn't hold the next one
    switching = run.catch(() => {});
    await run;
  },
  {
    failure: {
      code: FEEDBACK_CODES.PROFILE_LOAD_FAILED,
      message: "main.failure.setProfile",
    },
  },
);

const deleteProfile = async (
  { storeManagerService: store, notifier }: AppHandlerVariables,
  e: ReplyEvent,
  file: string,
) => {
  const listed = store.getProfiles().find((p) => p.file === file);
  if (!listed) throw new Error(`The profile ${file} isn't listed.`);
  // The only profile is always the active one
  if (file === store.getSettings().activeProfile.file) {
    throw new AppFailure(
      FEEDBACK_CODES.PROFILE_DELETE_FAILED,
      t("main.settings.deleteActive"),
      { level: "warning" },
    );
  }
  const res = await store.deleteProfile(file);
  if (res === "unsaved") {
    replySettings(e, store);
    throw saveFailure();
  }
  if (!res) throw new Error(`Deleting the profile ${file} failed.`);
  // Not thrown: it's unlisted, so the delete happened
  const leftovers = res === "leftovers";

  e.reply(APP_EVENTS_RESPONSE.DELETE_PROFILE, {
    success: true,
    file,
    ...(leftovers && { leftovers }),
  });
  replySettings(e, store);
  if (leftovers) {
    notifier.warn(
      "system",
      FEEDBACK_CODES.PROFILE_FILES_DELETE_FAILED,
      t("main.settings.profileFilesLeft", {
        name: listed.name,
        ...logsPlace(),
      }),
    );
    return;
  }
  notifier.success(
    "system",
    FEEDBACK_CODES.PROFILE_DELETED,
    t("main.settings.profileDeleted", { name: listed.name }),
  );
};

// On the switches' chain: a switch to it, or away from it with its timer,
// fans and history still saving there, ends before it's deleted
events.push(
  APP_EVENTS.DELETE_PROFILE,
  async (services, e, { file }) => {
    const run = switching.then(() => deleteProfile(services, e, file));
    switching = run.catch(() => {});
    await run;
  },
  {
    failure: {
      code: FEEDBACK_CODES.PROFILE_DELETE_FAILED,
      message: "main.failure.deleteProfile",
    },
    onError: (e, error, { file }) =>
      e.reply(APP_EVENTS_RESPONSE.DELETE_PROFILE, {
        success: false,
        file,
        error,
      }),
  },
);

events.push(
  APP_EVENTS.EXPORT_ENTITY,
  async ({ storeManagerService, win, notifier }, e, { type, file }) => {
    const name = t(ENTITY_NAMES[type]);
    // A renamed profile keeps its file's name, so the dialog proposes its own
    const listed = storeManagerService
      .getProfiles()
      .find((p) => p.file === file);
    const diagRes = await showSaveDialog(win, {
      title: t("main.dialog.export", { type: name }),
      defaultPath: listed ? `${profileSlug(listed.name)}.json` : file,
      filters: [
        {
          extensions: ["json"],
          name,
        },
      ],
    });
    if (diagRes.canceled) return;

    const res =
      type === "profile" &&
      (await storeManagerService.exportProfile(file, diagRes.filePath));
    if (!res) throw new Error(`The ${type} ${file} was not exported.`);

    e.reply(APP_EVENTS_RESPONSE.EXPORT_ENTITY, {
      success: true,
      type,
    });
    notifier.success(
      "system",
      FEEDBACK_CODES.PROFILE_EXPORTED,
      t("main.settings.profileExported"),
    );
  },
  {
    failure: {
      code: FEEDBACK_CODES.PROFILE_EXPORT_FAILED,
      message: "main.failure.exportEntity",
    },
    onError: (e, error, { type }) =>
      e.reply(APP_EVENTS_RESPONSE.EXPORT_ENTITY, {
        success: false,
        type,
        error,
      }),
  },
);

events.push(
  APP_EVENTS.EXPORT_LOGS,
  async ({ pathManagerService, win, notifier }) => {
    const res = await showSaveDialog(win, {
      title: t("main.logs.exportTitle"),
      defaultPath: `tokio-logs-${localTime().slice(0, 10)}.zip`,
      filters: [{ name: t("main.logs.zipFilter"), extensions: ["zip"] }],
    });
    if (res.canceled || !res.filePath) return;
    await writeFileAtomic(
      res.filePath,
      await Logger.zip(pathManagerService.folders.logsFolder),
    );
    notifier.success(
      "system",
      FEEDBACK_CODES.LOGS_EXPORTED,
      t("main.logs.exported"),
    );
  },
  {
    failure: {
      code: FEEDBACK_CODES.LOGS_EXPORT_FAILED,
      message: "main.failure.exportLogs",
    },
  },
);

events.push(
  APP_EVENTS.IMPORT_ENTITY,
  async ({ storeManagerService, win, notifier }, e, { type }) => {
    const name = t(ENTITY_NAMES[type]);
    const diagRes = await showOpenDialog(win, {
      title: t("main.dialog.import", { type: name }),
      properties: ["openFile"],
      filters: [
        {
          extensions: ["json"],
          name,
        },
      ],
    });
    if (diagRes.canceled) return;

    const res =
      type === "profile"
        ? await storeManagerService.importProfile(diagRes.filePaths[0])
        : null;
    assertListed(
      e,
      storeManagerService,
      res,
      `Importing the ${type} ${diagRes.filePaths[0]}`,
    );

    replySettings(e, storeManagerService);
    e.reply(APP_EVENTS_RESPONSE.IMPORT_ENTITY, {
      success: true,
      type,
    });
    notifier.success(
      "system",
      FEEDBACK_CODES.PROFILE_IMPORTED,
      t("main.settings.profileImported"),
    );
  },
  {
    failure: {
      code: FEEDBACK_CODES.PROFILE_IMPORT_FAILED,
      message: "main.failure.importEntity",
    },
    onError: (e, error, { type }) =>
      e.reply(APP_EVENTS_RESPONSE.IMPORT_ENTITY, {
        success: false,
        type,
        error,
      }),
  },
);

// Settings saves it as it's typed: no notice on success
events.push(
  APP_EVENTS.SET_PROVIDER,
  async ({ storeManagerService }, e, { name, key, type }) => {
    const saved = await storeManagerService.updateProvider(name, key);

    replySettings(e, storeManagerService);
    if (!saved) throw saveFailure();
    e.reply(APP_EVENTS_RESPONSE.SET_PROVIDER, {
      type,
      success: true,
    });
  },
  {
    failure: {
      code: FEEDBACK_CODES.PROVIDER_UPDATE_FAILED,
      message: "main.failure.setProvider",
    },
    onError: (e, error, { type }) =>
      e.reply(APP_EVENTS_RESPONSE.SET_PROVIDER, {
        type,
        success: false,
        error,
      }),
  },
);

const replyVoiceKeys = (
  e: ReplyEvent,
  tts: TTSService,
  store: StoreManagerService,
) => {
  e.reply(APP_EVENTS_RESPONSE.GET_VOICE_KEYS, {
    engines: tts
      .getEngines()
      .filter((engine) => engine.keyLabel)
      .map((engine) => ({ ...engine, key: store.getVoiceKey(engine.id) })),
    success: true,
  });
};

events.push(
  APP_EVENTS.GET_VOICE_KEYS,
  ({ storeManagerService, ttsService }, e) => {
    replyVoiceKeys(e, ttsService, storeManagerService);
  },
  {
    failure: {
      code: FEEDBACK_CODES.SETTINGS_LOAD_FAILED,
      message: "main.failure.getVoiceKeys",
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.GET_VOICE_KEYS),
  },
);

// Settings saves it as it's typed: no notice on success
events.push(
  APP_EVENTS.SET_VOICE_KEY,
  async ({ storeManagerService, ttsService }, e, { engine, key }) => {
    const target = ttsService.getEngines().find((v) => v.id === engine);
    if (!target?.keyLabel) {
      throw new Error(`The voice engine ${engine} takes no key.`);
    }
    if (!(await storeManagerService.updateVoiceKey(engine, key))) {
      replyVoiceKeys(e, ttsService, storeManagerService);
      throw saveFailure();
    }

    e.reply(APP_EVENTS_RESPONSE.SET_VOICE_KEY, {
      success: true,
    });
    replyVoiceKeys(e, ttsService, storeManagerService);

    // Its voices can't speak without it: every profile's go back to the
    // default voice, and a page open on the profile shows it
    if (key.trim() === "" && ttsService.voicesNeedKey(engine)) {
      const removed = await storeManagerService.removeVoices(engine);
      const profile = await storeManagerService.getProfileData({ fresh: true });
      if (profile) {
        e.reply(
          APP_EVENTS_RESPONSE.GET_PROFILE,
          profileReply(storeManagerService, profile),
        );
      }
      if (!removed) throw saveFailure();
    }
  },
  {
    failure: {
      code: FEEDBACK_CODES.PROVIDER_UPDATE_FAILED,
      message: "main.failure.setVoiceKey",
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.SET_VOICE_KEY),
  },
);

events.push(
  APP_EVENTS.SET_SERVER,
  async ({ storeManagerService, serverService, notifier }, e, { enabled }) => {
    // Save the state the server ended up in, so a taken port turns the toggle off.
    const res = await serverService.toggleServer(enabled);
    const saved = await storeManagerService.updateServerSettings(
      enabled && res,
    );
    replySettings(e, storeManagerService);

    // Only a start fails: stopping always works
    if (!res) {
      throw new AppFailure(
        FEEDBACK_CODES.SERVER_START_FAILED,
        t("main.settings.serverStartFailed", { port: String(SERVER_PORT) }),
      );
    }
    if (!saved) throw saveFailure();
    e.reply(APP_EVENTS_RESPONSE.SET_SERVER, {
      success: true,
    });
    if (enabled) {
      notifier.success(
        "server",
        FEEDBACK_CODES.SERVER_STARTED,
        t("main.settings.serverOn"),
      );
    } else {
      notifier.info(
        "server",
        FEEDBACK_CODES.SERVER_STOPPED,
        t("main.settings.serverOff"),
      );
    }
  },
  {
    source: "server",
    failure: {
      code: FEEDBACK_CODES.SERVER_START_FAILED,
      message: "main.failure.setServer",
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.SET_SERVER),
  },
);

events.push(
  APP_EVENTS.SET_AUTO_UPDATES,
  async ({ storeManagerService, updaterService, notifier }, e, { enabled }) => {
    const saved = await storeManagerService.updateUpdatesSettings(enabled);
    updaterService.setAuto(enabled);
    replySettings(e, storeManagerService);
    if (!saved) throw saveFailure();
    e.reply(APP_EVENTS_RESPONSE.SET_AUTO_UPDATES, {
      success: true,
    });
    if (enabled) {
      notifier.success(
        "system",
        FEEDBACK_CODES.UPDATES_ENABLED,
        t("main.settings.updatesOn"),
      );
    } else {
      notifier.info(
        "system",
        FEEDBACK_CODES.UPDATES_DISABLED,
        t("main.settings.updatesOff", { about: t("nav.about") }),
      );
    }
  },
  {
    failure: {
      code: FEEDBACK_CODES.SETTINGS_SAVE_FAILED,
      message: "main.failure.setAutoUpdates",
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.SET_AUTO_UPDATES),
  },
);

events.push(
  APP_EVENTS.SET_OVERLAY_UPDATES,
  async ({ storeManagerService, overlayService, notifier }, e, { enabled }) => {
    const saved =
      await storeManagerService.updateOverlayUpdatesSettings(enabled);
    overlayService.setAutoUpdate(enabled);
    replySettings(e, storeManagerService);
    if (!saved) throw saveFailure();
    e.reply(APP_EVENTS_RESPONSE.SET_OVERLAY_UPDATES, {
      success: true,
    });
    if (enabled) {
      notifier.success(
        "overlays",
        FEEDBACK_CODES.OVERLAY_UPDATES_ENABLED,
        t("main.settings.overlayUpdatesOn"),
      );
    } else {
      notifier.info(
        "overlays",
        FEEDBACK_CODES.OVERLAY_UPDATES_DISABLED,
        t("main.settings.overlayUpdatesOff", {
          official: t("overlays.official.title"),
        }),
      );
    }
  },
  {
    source: "overlays",
    failure: {
      code: FEEDBACK_CODES.SETTINGS_SAVE_FAILED,
      message: "main.failure.setOverlayUpdates",
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.SET_OVERLAY_UPDATES),
  },
);

events.push(
  APP_EVENTS.SET_TRAY,
  async (
    { storeManagerService, trayService, notifier, win },
    e,
    { enabled },
  ) => {
    const saved = await storeManagerService.updateTraySettings(enabled);
    trayService.setEnabled(enabled);
    // Hidden in the tray (an AI can turn it off), it would have no way back
    if (!enabled && !win.isVisible()) win.show();
    replySettings(e, storeManagerService);
    if (!saved) throw saveFailure();
    e.reply(APP_EVENTS_RESPONSE.SET_TRAY, {
      success: true,
    });
    if (enabled) {
      notifier.success(
        "system",
        FEEDBACK_CODES.TRAY_ENABLED,
        t("main.settings.trayOn"),
      );
    } else {
      notifier.info(
        "system",
        FEEDBACK_CODES.TRAY_DISABLED,
        t("main.settings.trayOff"),
      );
    }
  },
  {
    failure: {
      code: FEEDBACK_CODES.SETTINGS_SAVE_FAILED,
      message: "main.failure.setTray",
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.SET_TRAY),
  },
);

events.push(
  APP_EVENTS.SET_LOGS,
  async ({ storeManagerService, notifier }, e, { enabled }) => {
    const saved = await storeManagerService.updateLogsSettings(enabled);
    Logger.setDebug(enabled);
    replySettings(e, storeManagerService);
    if (!saved) throw saveFailure();
    e.reply(APP_EVENTS_RESPONSE.SET_LOGS, {
      success: true,
    });
    if (enabled) {
      notifier.success(
        "system",
        FEEDBACK_CODES.DEBUG_LOGS_ENABLED,
        t("main.settings.debugLogsOn"),
      );
    } else {
      notifier.info(
        "system",
        FEEDBACK_CODES.DEBUG_LOGS_DISABLED,
        t("main.settings.debugLogsOff"),
      );
    }
  },
  {
    failure: {
      code: FEEDBACK_CODES.SETTINGS_SAVE_FAILED,
      message: "main.failure.setLogs",
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.SET_LOGS),
  },
);

// Applies on pick, like the tray. Every window shows the change, so there's
// no success notice.
events.push(
  APP_EVENTS.SET_LANGUAGE,
  async ({ storeManagerService }, e, { language: setting }) => {
    if (
      setting !== "system" &&
      !APP_LANGUAGES.some(({ tag }) => tag === setting)
    ) {
      replySettings(e, storeManagerService);
      throw new Error(`Tokio has no language "${setting}".`);
    }
    const saved = await storeManagerService.updateLanguage(setting);
    setLanguage(setting);
    e.reply(APP_EVENTS_RESPONSE.LANGUAGE, language());
    replySettings(e, storeManagerService);
    if (!saved) throw saveFailure();
  },
  {
    failure: {
      code: FEEDBACK_CODES.SETTINGS_SAVE_FAILED,
      message: "main.failure.setLanguage",
    },
  },
);

// Applies on pick, and the section shows it: no success notice
events.push(
  APP_EVENTS.SET_TRANSLATION,
  async ({ storeManagerService }, e, { language }) => {
    if (
      language !== "" &&
      !TRANSLATION_LANGUAGES.some((code) => code === language)
    ) {
      replySettings(e, storeManagerService);
      throw new Error(`Chat translation has no language "${language}".`);
    }
    const saved = await storeManagerService.updateTranslationLanguage(language);
    replySettings(e, storeManagerService);
    if (!saved) throw saveFailure();
  },
  {
    failure: {
      code: FEEDBACK_CODES.SETTINGS_SAVE_FAILED,
      message: "main.failure.setTranslation",
    },
  },
);

// The section shows the result, the failure too
events.push(
  APP_EVENTS.TEST_TRANSLATION,
  async (services, e, { id, text }) => {
    const { translationService } = services;
    let data;
    try {
      data = await translationService.test(text, await chatCommands(services));
    } catch (error) {
      if (!(error instanceof TranslationError)) throw error;
      const reason = t(reasonKey(error));
      throw new AppFailure(
        FEEDBACK_CODES.TRANSLATION_TEST_FAILED,
        t("main.translation.testFailed", { reason }),
        { level: "warning", cause: error },
      );
    }
    e.reply(APP_EVENTS_RESPONSE.TEST_TRANSLATION, { id, success: true, data });
  },
  {
    source: "translation",
    notify: false,
    failure: {
      code: FEEDBACK_CODES.TRANSLATION_TEST_FAILED,
      message: "main.failure.testTranslation",
    },
    onError: (e, error, { id }) =>
      e.reply(APP_EVENTS_RESPONSE.TEST_TRANSLATION, {
        id,
        success: false,
        error,
      }),
  },
);

events.push(
  APP_EVENTS.REQ_FQDN,
  async ({ urlManagerService }, e) => {
    const res = await urlManagerService.installAppFQDN();
    // Also false when the administrator prompt is declined. The service
    // logged why.
    if (!res) {
      throw new AppFailure(
        FEEDBACK_CODES.FQDN_INSTALL_FAILED,
        t("main.settings.fqdnDeclined"),
        { level: "warning", logged: true },
      );
    }
    e.reply(APP_EVENTS_RESPONSE.REQ_FQDN, {
      success: true,
    });
  },
  {
    failure: {
      code: FEEDBACK_CODES.FQDN_INSTALL_FAILED,
      message: "main.failure.reqFqdn",
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.REQ_FQDN),
  },
);

events.push(
  APP_EVENTS.GET_NETWORK_ADDRESSES,
  ({ serverService }, e) => {
    e.reply(APP_EVENTS_RESPONSE.GET_NETWORK_ADDRESSES, {
      addresses: serverService.networkAddresses(),
    });
  },
  {
    // Settings shows that none was found.
    notify: false,
    onError: (e) =>
      e.reply(APP_EVENTS_RESPONSE.GET_NETWORK_ADDRESSES, { addresses: [] }),
  },
);

// The Twitch sign-in waiting for the streamer, which a newer one or a
// sign-out aborts. The attempt drops a reply that came after a newer one.
let twitchAttempt = 0;
let twitchSignIn: AbortController | null = null;

const cancelTwitchSignIn = () => {
  twitchAttempt++;
  twitchSignIn?.abort();
  twitchSignIn = null;
};

// The account itself is saved by the store, through onTwitchAccount
events.push(
  APP_EVENTS.TWITCH_SIGN_IN,
  async ({ connectorService, notifier, shell, win }, e) => {
    cancelTwitchSignIn();
    const current = twitchAttempt;
    const abort = new AbortController();
    twitchSignIn = abort;
    const account = await connectorService
      .signInTwitch((code) => {
        if (current !== twitchAttempt) return;
        if (!win.isDestroyed()) {
          win.webContents.send(APP_EVENTS_RESPONSE.TWITCH_CODE, code);
        }
        // Twitch's page with the code filled in
        void shell.openExternal(code.uri);
      }, abort.signal)
      // Canceled, by a newer sign-in or a sign-out: not a failure
      .catch((error: unknown) => {
        if (abort.signal.aborted) return null;
        throw error;
      });
    if (current !== twitchAttempt || !account) return;
    twitchSignIn = null;
    e.reply(APP_EVENTS_RESPONSE.TWITCH_ACCOUNT, {
      success: true,
      login: account.login,
    });
    notifier.success(
      "system",
      FEEDBACK_CODES.TWITCH_SIGNED_IN,
      t("main.settings.twitchSignedIn", { login: account.login }),
    );
  },
  {
    failure: {
      code: FEEDBACK_CODES.TWITCH_SIGN_IN_FAILED,
      message: "main.failure.twitchSignIn",
    },
    onError: (e, error, _data, { storeManagerService }) =>
      e.reply(APP_EVENTS_RESPONSE.TWITCH_ACCOUNT, {
        success: false,
        error,
        login: storeManagerService.getTwitchAccount().login,
      }),
  },
);

// Also cancels a sign-in that waits, which the window's Cancel sends
events.push(
  APP_EVENTS.TWITCH_SIGN_OUT,
  async ({ connectorService, storeManagerService, notifier }, e) => {
    cancelTwitchSignIn();
    if (connectorService.status().twitch) {
      throw new AppFailure(
        FEEDBACK_CODES.PROFILE_LOCKED,
        t("main.settings.twitchLocked"),
        { level: "warning" },
      );
    }
    const signedIn = storeManagerService.getTwitchAccount().login !== "";
    await connectorService.signOutTwitch();
    e.reply(APP_EVENTS_RESPONSE.TWITCH_ACCOUNT, { success: true, login: "" });
    // A canceled sign-in had nothing to sign out of
    if (!signedIn) return;
    notifier.success(
      "system",
      FEEDBACK_CODES.TWITCH_SIGNED_OUT,
      t("main.settings.twitchSignedOut"),
    );
  },
  {
    failure: {
      code: FEEDBACK_CODES.UNKNOWN,
      message: "main.failure.twitchSignOut",
    },
    onError: (e, error, _data, { storeManagerService }) =>
      e.reply(APP_EVENTS_RESPONSE.TWITCH_ACCOUNT, {
        success: false,
        error,
        login: storeManagerService.getTwitchAccount().login,
      }),
  },
);

export default events;
