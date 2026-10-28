import { APP_LANGUAGES } from "@/common/i18n";
import { ProfileSchema } from "@/common/schemas";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  FEEDBACK_CODES,
} from "@/common/types";
import { SERVER_PORT } from "@/common/util";
import { showOpenDialog, showSaveDialog } from "@/helper/dialog";
import { createStack, replyFailure } from "@/helper/events";
import { AppFailure, saveFailure } from "@/helper/feedback";
import { sendGamesOverlay } from "@/helper/games";
import { language, setLanguage } from "@/helper/i18n";
import { StoreManagerService } from "@/services/store";
import { TTSService } from "@/services/tts";
import { ReplyEvent } from "@/types";

const events = createStack("system");

const MIN_NAME = ProfileSchema.shape.name.minLength ?? 1;

// A shorter name would make the profile fail to load.
const assertNameLong = (name: string) => {
  if (name.length < MIN_NAME) {
    throw new AppFailure(
      FEEDBACK_CODES.PROFILE_NAME_INVALID,
      `A profile name needs at least ${MIN_NAME} characters.`,
      { level: "warning" },
    );
  }
};

// Two profiles can't share a name, whatever its case and surrounding spaces.
const assertNameFree = (store: StoreManagerService, name: string) => {
  const wanted = name.toLowerCase();
  if (store.getProfiles().some((p) => p.name.trim().toLowerCase() === wanted)) {
    throw new AppFailure(
      FEEDBACK_CODES.PROFILE_EXISTS,
      `A profile named "${name}" already exists.`,
      { level: "warning" },
    );
  }
};

// Changes to the settings also send the updated settings and profiles.
const replySettings = (e: ReplyEvent, store: StoreManagerService) => {
  e.reply(APP_EVENTS_RESPONSE.GET_SETTINGS, {
    data: {
      settings: store.getSettings(),
      profiles: store.getProfiles(),
    },
    success: true,
  });
};

events.push(
  APP_EVENTS.GET_SETTINGS,
  ({ storeManagerService }, e) => {
    replySettings(e, storeManagerService);
  },
  {
    failure: {
      code: FEEDBACK_CODES.SETTINGS_LOAD_FAILED,
      message: "Unable to load the settings.",
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
  write: (
    file: string,
    name: string,
  ) => ReturnType<StoreManagerService["createNewProfile"]>,
) => {
  const name = input.trim();
  assertNameLong(name);
  assertNameFree(store, name);
  const file = await store.profileFileFor(name);
  assertListed(
    e,
    store,
    await write(file, name),
    `Writing the profile ${file}`,
  );

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
      (file, name) => store.createNewProfile(file, name),
    );
    notifier.success(
      "system",
      FEEDBACK_CODES.PROFILE_CREATED,
      `Profile "${name}" created.`,
    );
  },
  {
    failure: {
      code: FEEDBACK_CODES.PROFILE_CREATE_FAILED,
      message: "Unable to create the profile.",
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
      (file, name) => store.cloneProfile(ref, file, name),
    );
    notifier.success(
      "system",
      FEEDBACK_CODES.PROFILE_CLONED,
      `Profile "${name}" created as a copy.`,
    );
  },
  {
    failure: {
      code: FEEDBACK_CODES.PROFILE_CLONE_FAILED,
      message: "Unable to clone the profile.",
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.CLONE_PROFILE),
  },
);

events.push(
  APP_EVENTS.SET_PROFILE,
  async (services, e, { file }) => {
    const { storeManagerService, connectorService, timerService, notifier } =
      services;
    // Picking the active profile again changes nothing, even during a LIVE
    if (file === storeManagerService.getSettings().activeProfile.file) return;
    if (connectorService.isConnected()) {
      throw new AppFailure(
        FEEDBACK_CODES.PROFILE_LOCKED,
        "Disconnect from the LIVE before switching profiles.",
        { level: "warning" },
      );
    }
    // Into the profile it came from, before it's replaced, so it's never lost
    if (!(await timerService.save())) throw saveFailure();
    const res = await storeManagerService.updateActiveProfile(file);
    if (res === "unsaved") throw saveFailure();
    if (res === "missing") {
      throw new AppFailure(
        FEEDBACK_CODES.PROFILE_LOAD_FAILED,
        "Unable to switch to that profile. Its file is missing or damaged.",
      );
    }
    const profile = await storeManagerService.getProfileData();
    const profiles = storeManagerService.getProfiles();
    if (!profile || !profiles) throw new Error(`Unable to load ${file}.`);
    timerService.load(profile.timer, file);
    services.gamesService.setGames(profile.games);

    e.reply(APP_EVENTS_RESPONSE.GET_PROFILE, {
      success: true,
      profile,
      profiles,
    });
    replySettings(e, storeManagerService);
    notifier.success(
      "system",
      FEEDBACK_CODES.PROFILE_SWITCHED,
      `Switched to the profile "${storeManagerService.getSettings().activeProfile.name}".`,
    );
    // The new profile's actions
    await sendGamesOverlay(services);
  },
  {
    failure: {
      code: FEEDBACK_CODES.PROFILE_LOAD_FAILED,
      message: "Unable to switch the profile.",
    },
  },
);

events.push(
  APP_EVENTS.EXPORT_ENTITY,
  async ({ storeManagerService, win, notifier }, e, { type, file }) => {
    const diagRes = await showSaveDialog(win, {
      title: `Export ${type}`,
      defaultPath: file,
      filters: [
        {
          extensions: ["json"],
          name: type,
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
      "Profile exported.",
    );
  },
  {
    failure: {
      code: FEEDBACK_CODES.PROFILE_EXPORT_FAILED,
      message: "Unable to export the profile.",
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
  APP_EVENTS.IMPORT_ENTITY,
  async ({ storeManagerService, win, notifier }, e, { type }) => {
    const diagRes = await showOpenDialog(win, {
      title: `Import ${type}`,
      properties: ["openFile"],
      filters: [
        {
          extensions: ["json"],
          name: type,
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
      "Profile imported.",
    );
  },
  {
    failure: {
      code: FEEDBACK_CODES.PROFILE_IMPORT_FAILED,
      message: "Unable to import the profile. Check that it's a Tokio profile.",
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
      message: "Unable to change the provider.",
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
      message: "Unable to load the voice keys.",
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
  },
  {
    failure: {
      code: FEEDBACK_CODES.PROVIDER_UPDATE_FAILED,
      message: "Unable to save the key.",
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

    if (!res) {
      throw new AppFailure(
        FEEDBACK_CODES.SERVER_START_FAILED,
        enabled
          ? `The overlay server couldn't start. Port ${SERVER_PORT} may be in use.`
          : "Unable to stop the overlay server.",
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
        "The overlay server is on.",
      );
    } else {
      notifier.info(
        "server",
        FEEDBACK_CODES.SERVER_STOPPED,
        "The overlay server is off.",
      );
    }
  },
  {
    source: "server",
    failure: {
      code: FEEDBACK_CODES.SERVER_START_FAILED,
      message: "Unable to change the overlay server.",
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
        "Tokio checks for updates automatically.",
      );
    } else {
      notifier.info(
        "system",
        FEEDBACK_CODES.UPDATES_DISABLED,
        "Automatic update checks are off. Check from About.",
      );
    }
  },
  {
    failure: {
      code: FEEDBACK_CODES.SETTINGS_SAVE_FAILED,
      message: "Unable to save the update setting.",
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.SET_AUTO_UPDATES),
  },
);

events.push(
  APP_EVENTS.SET_TRAY,
  async ({ storeManagerService, trayService, notifier }, e, { enabled }) => {
    const saved = await storeManagerService.updateTraySettings(enabled);
    trayService.setEnabled(enabled);
    replySettings(e, storeManagerService);
    if (!saved) throw saveFailure();
    e.reply(APP_EVENTS_RESPONSE.SET_TRAY, {
      success: true,
    });
    if (enabled) {
      notifier.success(
        "system",
        FEEDBACK_CODES.TRAY_ENABLED,
        "Tokio keeps running in the tray when you close it.",
      );
    } else {
      notifier.info(
        "system",
        FEEDBACK_CODES.TRAY_DISABLED,
        "Closing Tokio's window quits it.",
      );
    }
  },
  {
    failure: {
      code: FEEDBACK_CODES.SETTINGS_SAVE_FAILED,
      message: "Unable to save the tray setting.",
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.SET_TRAY),
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
      message: "Unable to save the language setting.",
    },
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
        "Unable to set up the overlay address. Accept the administrator prompt to add it.",
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
      message: "Unable to set up the overlay address.",
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

export default events;
