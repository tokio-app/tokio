import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  FEEDBACK_CODES,
} from "@/common/types";
import { SERVER_PORT } from "@/common/util";
import { createStack, replyFailure } from "@/helper/events";
import { AppFailure } from "@/helper/feedback";
import { StoreManagerService } from "@/services/store";
import { TTSService } from "@/services/tts";
import { ReplyEvent } from "@/types";
import { dialog } from "electron";

const events = createStack("system");

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

events.push(
  APP_EVENTS.CREATE_PROFILE,
  async ({ storeManagerService, notifier }, e, { name: input }) => {
    const name = input.trim();
    assertNameFree(storeManagerService, name);
    const fileName = await storeManagerService.profileFileFor(name);
    const res = await storeManagerService.createNewProfile(fileName, name);
    if (!res) throw new Error(`The profile ${fileName} was not created.`);

    e.reply(APP_EVENTS_RESPONSE.CREATE_PROFILE, {
      success: true,
    });
    replySettings(e, storeManagerService);
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
  async ({ storeManagerService, notifier }, e, { name: input, ref }) => {
    const name = input.trim();
    assertNameFree(storeManagerService, name);
    const fileName = await storeManagerService.profileFileFor(name);
    const res = await storeManagerService.cloneProfile(ref, fileName, name);
    if (!res) throw new Error(`The profile ${ref} was not cloned.`);

    e.reply(APP_EVENTS_RESPONSE.CLONE_PROFILE, {
      success: true,
    });
    replySettings(e, storeManagerService);
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
  async ({ storeManagerService, connectorService, notifier }, e, { file }) => {
    if (connectorService.isConnected()) {
      throw new AppFailure(
        FEEDBACK_CODES.PROFILE_LOCKED,
        "Disconnect from the LIVE before switching profiles.",
        { level: "warning" },
      );
    }
    if (!(await storeManagerService.updateActiveProfile(file))) {
      throw new AppFailure(
        FEEDBACK_CODES.PROFILE_LOAD_FAILED,
        "Unable to switch to that profile. Its file is missing or damaged.",
      );
    }
    const profile = await storeManagerService.getProfileData();
    const profiles = storeManagerService.getProfiles();
    if (!profile || !profiles) throw new Error(`Unable to load ${file}.`);

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
    const diagRes = await dialog.showSaveDialog(win, {
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
    const diagRes = await dialog.showOpenDialog(win, {
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
      type === "profile" &&
      (await storeManagerService.importProfile(diagRes.filePaths[0]));
    if (!res) {
      throw new Error(`The ${type} ${diagRes.filePaths[0]} was not imported.`);
    }

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

events.push(
  APP_EVENTS.SET_PROVIDER,
  async ({ storeManagerService, notifier }, e, { name, key, type }) => {
    await storeManagerService.updateProvider(name, key);

    replySettings(e, storeManagerService);
    e.reply(APP_EVENTS_RESPONSE.SET_PROVIDER, {
      type,
      success: true,
    });
    notifier.success(
      "system",
      FEEDBACK_CODES.PROVIDER_UPDATED,
      `Connector provider set to ${name}.`,
    );
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

events.push(
  APP_EVENTS.SET_VOICE_KEY,
  async ({ storeManagerService, ttsService, notifier }, e, { engine, key }) => {
    const target = ttsService.getEngines().find((v) => v.id === engine);
    if (!target?.keyLabel) {
      throw new Error(`The voice engine ${engine} takes no key.`);
    }
    await storeManagerService.updateVoiceKey(engine, key);

    e.reply(APP_EVENTS_RESPONSE.SET_VOICE_KEY, {
      success: true,
    });
    replyVoiceKeys(e, ttsService, storeManagerService);
    notifier.success(
      "system",
      FEEDBACK_CODES.PROVIDER_UPDATED,
      key
        ? `${target.keyLabel} saved for the ${target.label} voices.`
        : `${target.keyLabel} removed from the ${target.label} voices.`,
    );
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
    await storeManagerService.updateServerSettings(enabled && res);
    replySettings(e, storeManagerService);

    if (!res) {
      throw new AppFailure(
        FEEDBACK_CODES.SERVER_START_FAILED,
        enabled
          ? `The overlay server couldn't start. Port ${SERVER_PORT} may be in use.`
          : "Unable to stop the overlay server.",
      );
    }
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
    await storeManagerService.updateUpdatesSettings(enabled);
    updaterService.setAuto(enabled);
    replySettings(e, storeManagerService);
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
  APP_EVENTS.REQ_FQDN,
  async ({ urlManagerService }, e) => {
    const res = await urlManagerService.installAppFQDN();
    // Also false when the administrator prompt is declined.
    if (!res) {
      throw new AppFailure(
        FEEDBACK_CODES.FQDN_INSTALL_FAILED,
        "Unable to set up the overlay address. Accept the administrator prompt to add it.",
        { level: "warning" },
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

export default events;
