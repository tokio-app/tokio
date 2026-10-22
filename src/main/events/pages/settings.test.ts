import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  AppEventsMap,
  FEEDBACK_CODES,
} from "@/common/types";
import { SERVER_PORT } from "@/common/util";
import { TikTokConnectorService } from "@/services/connector";
import { JSONManagerService } from "@/services/json";
import { PathManagerService } from "@/services/path";
import { ServerService } from "@/services/server";
import { StoreManagerService } from "@/services/store";
import { TTSService } from "@/services/tts";
import { dialog } from "@test/electron";
import { createHandler } from "@test/handler";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import settings from "./settings";

// Runs a handler and returns everything it sent, in order
async function run<E extends APP_EVENTS>(
  h: ReturnType<typeof createHandler>,
  event: E,
  data: AppEventsMap[E],
) {
  await h.invoke(settings, event, data);
  return h.sent();
}

const notice = (fields: object) => ["notice", expect.objectContaining(fields)];

const defaultProfile = { name: "Default", file: "default.json" };
const streamProfile = { name: "Stream", file: "stream.json" };
const appSettings = { activeProfile: defaultProfile };

// A store with the Default and Stream profiles. The profiles it creates or
// clones join the list, unless it's told to answer `fail`: null when it
// can't write the profile, "unsaved" when it can't save the list.
function profileStore({ fail }: { fail?: null | "unsaved" } = {}) {
  const profiles = [defaultProfile, streamProfile];
  const add = (file: string, name: string) => {
    if (fail !== undefined) return fail;
    const profile = { file, name };
    profiles.push(profile);
    return profile;
  };
  return {
    getSettings: () => appSettings,
    getProfiles: () => [...profiles],
    profileFileFor: vi.fn(
      async (name: string) => `${name.toLowerCase().replace(/ /g, "-")}.json`,
    ),
    createNewProfile: vi.fn(async (file: string, name: string) =>
      add(file, name),
    ),
    cloneProfile: vi.fn(async (_ref: string, file: string, name: string) =>
      add(file, name),
    ),
  };
}

describe("settings events", () => {
  describe("GET_SETTINGS", () => {
    it("replies the settings and the profiles", async () => {
      const h = createHandler({ storeManagerService: profileStore() });

      await h.invoke(settings, APP_EVENTS.GET_SETTINGS);

      expect(h.replies(APP_EVENTS_RESPONSE.GET_SETTINGS)).toEqual([
        {
          success: true,
          data: {
            settings: appSettings,
            profiles: [defaultProfile, streamProfile],
          },
        },
      ]);
      expect(h.notices).toEqual([]);
    });

    it("replies and notifies when the settings can't be read", async () => {
      const h = createHandler({
        storeManagerService: {
          getSettings: () => {
            throw new Error("not initialized");
          },
        },
      });

      await h.invoke(settings, APP_EVENTS.GET_SETTINGS);

      const failure = {
        code: FEEDBACK_CODES.SETTINGS_LOAD_FAILED,
        message: "Unable to load the settings.",
      };
      expect(h.replies(APP_EVENTS_RESPONSE.GET_SETTINGS)).toEqual([
        { success: false, error: failure },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({ level: "error", ...failure }),
      ]);
    });
  });

  describe("CREATE_PROFILE", () => {
    it("creates the profile, then sends the new settings and a notice", async () => {
      const store = profileStore();
      const h = createHandler({ storeManagerService: store });

      const log = await run(h, APP_EVENTS.CREATE_PROFILE, {
        name: "Chill Stream",
      });

      expect(store.createNewProfile).toHaveBeenCalledExactlyOnceWith(
        "chill-stream.json",
        "Chill Stream",
      );
      expect(log).toEqual([
        [APP_EVENTS_RESPONSE.CREATE_PROFILE, { success: true }],
        [
          APP_EVENTS_RESPONSE.GET_SETTINGS,
          {
            success: true,
            data: {
              settings: appSettings,
              profiles: [
                defaultProfile,
                streamProfile,
                expect.objectContaining({ name: "Chill Stream" }),
              ],
            },
          },
        ],
        notice({
          level: "success",
          code: FEEDBACK_CODES.PROFILE_CREATED,
          message: 'Profile "Chill Stream" created.',
        }),
      ]);
    });

    it("replies and notifies when the store doesn't create it", async () => {
      const h = createHandler({
        storeManagerService: profileStore({ fail: null }),
      });

      await h.invoke(settings, APP_EVENTS.CREATE_PROFILE, { name: "Chill" });

      const failure = {
        code: FEEDBACK_CODES.PROFILE_CREATE_FAILED,
        message: "Unable to create the profile.",
      };
      expect(h.replies(APP_EVENTS_RESPONSE.CREATE_PROFILE)).toEqual([
        { success: false, error: failure },
      ]);
      expect(h.replies(APP_EVENTS_RESPONSE.GET_SETTINGS)).toEqual([]);
      expect(h.notices).toEqual([
        expect.objectContaining({ level: "error", ...failure }),
      ]);
    });

    it.each(["stream", "Default", "  Stream  "])(
      'refuses "%s", a name another profile has',
      async (name) => {
        const store = profileStore();
        const h = createHandler({ storeManagerService: store });

        await h.invoke(settings, APP_EVENTS.CREATE_PROFILE, { name });

        const message = `A profile named "${name.trim()}" already exists.`;
        expect(store.createNewProfile).not.toHaveBeenCalled();
        expect(h.replies(APP_EVENTS_RESPONSE.CREATE_PROFILE)).toEqual([
          { success: false, error: expect.objectContaining({ message }) },
        ]);
        expect(h.notices).toEqual([
          expect.objectContaining({ level: "warning", message }),
        ]);
      },
    );

    it.each(["ab", "  a  "])('refuses "%s", a name too short', async (name) => {
      const store = profileStore();
      const h = createHandler({ storeManagerService: store });

      await h.invoke(settings, APP_EVENTS.CREATE_PROFILE, { name });

      const message = "A profile name needs at least 3 characters.";
      expect(store.createNewProfile).not.toHaveBeenCalled();
      expect(h.replies(APP_EVENTS_RESPONSE.CREATE_PROFILE)).toEqual([
        {
          success: false,
          error: { code: FEEDBACK_CODES.PROFILE_NAME_INVALID, message },
        },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({ level: "warning", message }),
      ]);
    });
  });

  describe.each([
    {
      event: APP_EVENTS.CREATE_PROFILE,
      response: APP_EVENTS_RESPONSE.CREATE_PROFILE,
    },
    {
      event: APP_EVENTS.CLONE_PROFILE,
      response: APP_EVENTS_RESPONSE.CLONE_PROFILE,
    },
  ] as const)("$event", ({ event, response }) => {
    it("sends the profiles main holds when the list can't be saved", async () => {
      const h = createHandler({
        storeManagerService: profileStore({ fail: "unsaved" }),
      });

      await h.invoke(settings, event, { name: "Chill", ref: "stream.json" });

      expect(h.replies(APP_EVENTS_RESPONSE.GET_SETTINGS)).toEqual([
        {
          success: true,
          data: {
            settings: appSettings,
            profiles: [defaultProfile, streamProfile],
          },
        },
      ]);
      expect(h.replies(response)).toEqual([
        expect.objectContaining({ success: false }),
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "error",
          code: FEEDBACK_CODES.SETTINGS_SAVE_FAILED,
        }),
      ]);
    });
  });

  describe("CLONE_PROFILE", () => {
    it("clones the profile, then sends the new settings and a notice", async () => {
      const store = profileStore();
      const h = createHandler({ storeManagerService: store });

      const log = await run(h, APP_EVENTS.CLONE_PROFILE, {
        name: "Chill Stream",
        ref: "stream.json",
      });

      expect(store.cloneProfile).toHaveBeenCalledExactlyOnceWith(
        "stream.json",
        "chill-stream.json",
        "Chill Stream",
      );
      expect(log).toEqual([
        [APP_EVENTS_RESPONSE.CLONE_PROFILE, { success: true }],
        [
          APP_EVENTS_RESPONSE.GET_SETTINGS,
          {
            success: true,
            data: {
              settings: appSettings,
              profiles: [
                defaultProfile,
                streamProfile,
                expect.objectContaining({ name: "Chill Stream" }),
              ],
            },
          },
        ],
        notice({
          level: "success",
          code: FEEDBACK_CODES.PROFILE_CLONED,
          message: 'Profile "Chill Stream" created as a copy.',
        }),
      ]);
    });

    it("replies and notifies when the store doesn't clone it", async () => {
      const h = createHandler({
        storeManagerService: profileStore({ fail: null }),
      });

      await h.invoke(settings, APP_EVENTS.CLONE_PROFILE, {
        name: "Chill",
        ref: "missing.json",
      });

      const failure = {
        code: FEEDBACK_CODES.PROFILE_CLONE_FAILED,
        message: "Unable to clone the profile.",
      };
      expect(h.replies(APP_EVENTS_RESPONSE.CLONE_PROFILE)).toEqual([
        { success: false, error: failure },
      ]);
      expect(h.replies(APP_EVENTS_RESPONSE.GET_SETTINGS)).toEqual([]);
      expect(h.notices).toEqual([
        expect.objectContaining({ level: "error", ...failure }),
      ]);
    });

    it.each(["stream", "Default", "  Stream  "])(
      'refuses "%s", a name another profile has',
      async (name) => {
        const store = profileStore();
        const h = createHandler({ storeManagerService: store });

        await h.invoke(settings, APP_EVENTS.CLONE_PROFILE, {
          name,
          ref: "default.json",
        });

        const message = `A profile named "${name.trim()}" already exists.`;
        expect(store.cloneProfile).not.toHaveBeenCalled();
        expect(h.replies(APP_EVENTS_RESPONSE.CLONE_PROFILE)).toEqual([
          { success: false, error: expect.objectContaining({ message }) },
        ]);
        expect(h.notices).toEqual([
          expect.objectContaining({ level: "warning", message }),
        ]);
      },
    );

    it.each(["ab", "  a  "])('refuses "%s", a name too short', async (name) => {
      const store = profileStore();
      const h = createHandler({ storeManagerService: store });

      await h.invoke(settings, APP_EVENTS.CLONE_PROFILE, {
        name,
        ref: "default.json",
      });

      const message = "A profile name needs at least 3 characters.";
      expect(store.cloneProfile).not.toHaveBeenCalled();
      expect(h.replies(APP_EVENTS_RESPONSE.CLONE_PROFILE)).toEqual([
        {
          success: false,
          error: { code: FEEDBACK_CODES.PROFILE_NAME_INVALID, message },
        },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({ level: "warning", message }),
      ]);
    });
  });

  describe("SET_PROFILE", () => {
    const setup = ({
      connected = false,
      missing = false,
      unsaved = false,
    } = {}) => {
      const profiles = [defaultProfile, streamProfile];
      let active = defaultProfile;
      const storeManagerService = {
        updateActiveProfile: vi.fn(async (file: string) => {
          if (unsaved) return "unsaved";
          const profile = profiles.find((p) => p.file === file);
          if (profile) active = profile;
          return profile ? "switched" : "missing";
        }),
        getProfileData: vi.fn(async () =>
          missing ? null : { name: active.name },
        ),
        getProfiles: () => profiles,
        getSettings: () => ({ activeProfile: active }),
      };
      const h = createHandler({
        storeManagerService,
        connectorService: { isConnected: () => connected },
      });
      return { h, storeManagerService };
    };

    it("refuses to switch while a LIVE is connected", async () => {
      const { h, storeManagerService } = setup({ connected: true });

      await h.invoke(settings, APP_EVENTS.SET_PROFILE, { file: "stream.json" });

      expect(storeManagerService.updateActiveProfile).not.toHaveBeenCalled();
      expect(h.replies(APP_EVENTS_RESPONSE.GET_PROFILE)).toEqual([]);
      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "warning",
          code: FEEDBACK_CODES.PROFILE_LOCKED,
          message: "Disconnect from the LIVE before switching profiles.",
        }),
      ]);
    });

    it("switches the profile, then sends it, the settings and a notice", async () => {
      const { h, storeManagerService } = setup();

      const log = await run(h, APP_EVENTS.SET_PROFILE, {
        file: "stream.json",
      });

      expect(storeManagerService.updateActiveProfile).toHaveBeenCalledWith(
        "stream.json",
      );
      expect(log).toEqual([
        [
          APP_EVENTS_RESPONSE.GET_PROFILE,
          {
            success: true,
            profile: { name: "Stream" },
            profiles: [defaultProfile, streamProfile],
          },
        ],
        [
          APP_EVENTS_RESPONSE.GET_SETTINGS,
          {
            success: true,
            data: {
              settings: { activeProfile: streamProfile },
              profiles: [defaultProfile, streamProfile],
            },
          },
        ],
        notice({
          level: "success",
          code: FEEDBACK_CODES.PROFILE_SWITCHED,
          message: 'Switched to the profile "Stream".',
        }),
      ]);
    });

    it("keeps the active profile when the store can't switch to it", async () => {
      const { h } = setup();

      await h.invoke(settings, APP_EVENTS.SET_PROFILE, { file: "gone.json" });

      expect(h.replies(APP_EVENTS_RESPONSE.GET_PROFILE)).toEqual([]);
      expect(h.replies(APP_EVENTS_RESPONSE.GET_SETTINGS)).toEqual([]);
      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "error",
          code: FEEDBACK_CODES.PROFILE_LOAD_FAILED,
          message:
            "Unable to switch to that profile. Its file is missing or damaged.",
        }),
      ]);
    });

    it("says so when the switch can't be saved", async () => {
      const { h } = setup({ unsaved: true });

      await h.invoke(settings, APP_EVENTS.SET_PROFILE, { file: "stream.json" });

      expect(h.replies(APP_EVENTS_RESPONSE.GET_PROFILE)).toEqual([]);
      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "error",
          code: FEEDBACK_CODES.SETTINGS_SAVE_FAILED,
          message:
            "Tokio couldn't save the change. Check the logs folder for details.",
        }),
      ]);
    });

    it("notifies without a reply when the profile can't be read after", async () => {
      const { h } = setup({ missing: true });

      await h.invoke(settings, APP_EVENTS.SET_PROFILE, { file: "stream.json" });

      expect(h.replies(APP_EVENTS_RESPONSE.GET_PROFILE)).toEqual([]);
      expect(h.replies(APP_EVENTS_RESPONSE.GET_SETTINGS)).toEqual([]);
      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "error",
          code: FEEDBACK_CODES.PROFILE_LOAD_FAILED,
          message: "Unable to switch the profile.",
        }),
      ]);
    });
  });

  describe("EXPORT_ENTITY", () => {
    const filePath = join(tmpdir(), "exports", "stream.json");

    it("does nothing when the dialog is canceled", async () => {
      const exportProfile = vi.fn(async () => true);
      const h = createHandler({ storeManagerService: { exportProfile } });

      await h.invoke(settings, APP_EVENTS.EXPORT_ENTITY, {
        type: "profile",
        file: "stream.json",
      });

      expect(dialog.showSaveDialog).toHaveBeenCalledWith(
        h.win,
        expect.objectContaining({ defaultPath: "stream.json" }),
      );
      expect(exportProfile).not.toHaveBeenCalled();
      expect(h.replies(APP_EVENTS_RESPONSE.EXPORT_ENTITY)).toEqual([]);
      expect(h.notices).toEqual([]);
    });

    it("exports the profile where the user chose and notifies", async () => {
      dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath });
      const exportProfile = vi.fn(async () => true);
      const h = createHandler({ storeManagerService: { exportProfile } });

      await h.invoke(settings, APP_EVENTS.EXPORT_ENTITY, {
        type: "profile",
        file: "stream.json",
      });

      expect(exportProfile).toHaveBeenCalledWith("stream.json", filePath);
      expect(h.replies(APP_EVENTS_RESPONSE.EXPORT_ENTITY)).toEqual([
        { success: true, type: "profile" },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "success",
          code: FEEDBACK_CODES.PROFILE_EXPORTED,
          message: "Profile exported.",
        }),
      ]);
    });

    it("replies the type with the failure", async () => {
      dialog.showSaveDialog.mockResolvedValue({ canceled: false, filePath });
      const h = createHandler({
        storeManagerService: { exportProfile: async () => false },
      });

      await h.invoke(settings, APP_EVENTS.EXPORT_ENTITY, {
        type: "profile",
        file: "stream.json",
      });

      const failure = {
        code: FEEDBACK_CODES.PROFILE_EXPORT_FAILED,
        message: "Unable to export the profile.",
      };
      expect(h.replies(APP_EVENTS_RESPONSE.EXPORT_ENTITY)).toEqual([
        { success: false, type: "profile", error: failure },
      ]);
      expect(h.notices).toEqual([expect.objectContaining(failure)]);
    });
  });

  describe("IMPORT_ENTITY", () => {
    const filePath = join(tmpdir(), "downloads", "stream.json");

    it("does nothing when the dialog is canceled", async () => {
      const importProfile = vi.fn(async () => streamProfile);
      const h = createHandler({ storeManagerService: { importProfile } });

      await h.invoke(settings, APP_EVENTS.IMPORT_ENTITY, { type: "profile" });

      expect(dialog.showOpenDialog).toHaveBeenCalledOnce();
      expect(importProfile).not.toHaveBeenCalled();
      expect(h.replies(APP_EVENTS_RESPONSE.IMPORT_ENTITY)).toEqual([]);
      expect(h.notices).toEqual([]);
    });

    it("imports the chosen file, sends the settings and notifies", async () => {
      dialog.showOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: [filePath],
      });
      const importProfile = vi.fn(async () => streamProfile);
      const h = createHandler({
        storeManagerService: { ...profileStore(), importProfile },
      });

      await h.invoke(settings, APP_EVENTS.IMPORT_ENTITY, { type: "profile" });

      expect(importProfile).toHaveBeenCalledWith(filePath);
      expect(h.replies(APP_EVENTS_RESPONSE.GET_SETTINGS)).toEqual([
        expect.objectContaining({ success: true }),
      ]);
      expect(h.replies(APP_EVENTS_RESPONSE.IMPORT_ENTITY)).toEqual([
        { success: true, type: "profile" },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "success",
          code: FEEDBACK_CODES.PROFILE_IMPORTED,
          message: "Profile imported.",
        }),
      ]);
    });

    it("replies the type with the failure", async () => {
      dialog.showOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: [filePath],
      });
      const h = createHandler({
        storeManagerService: { importProfile: async () => null },
      });

      await h.invoke(settings, APP_EVENTS.IMPORT_ENTITY, { type: "profile" });

      const failure = {
        code: FEEDBACK_CODES.PROFILE_IMPORT_FAILED,
        message:
          "Unable to import the profile. Check that it's a Tokio profile.",
      };
      expect(h.replies(APP_EVENTS_RESPONSE.IMPORT_ENTITY)).toEqual([
        { success: false, type: "profile", error: failure },
      ]);
      expect(h.notices).toEqual([expect.objectContaining(failure)]);
    });

    it("sends the profiles main holds when the list can't be saved", async () => {
      dialog.showOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: [filePath],
      });
      const h = createHandler({
        storeManagerService: {
          ...profileStore(),
          importProfile: async () => "unsaved" as const,
        },
      });

      await h.invoke(settings, APP_EVENTS.IMPORT_ENTITY, { type: "profile" });

      expect(h.replies(APP_EVENTS_RESPONSE.GET_SETTINGS)).toEqual([
        expect.objectContaining({ success: true }),
      ]);
      expect(h.replies(APP_EVENTS_RESPONSE.IMPORT_ENTITY)).toEqual([
        expect.objectContaining({ success: false, type: "profile" }),
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({ code: FEEDBACK_CODES.SETTINGS_SAVE_FAILED }),
      ]);
    });
  });

  describe("SET_PROVIDER", () => {
    // Settings saves it as it's typed, so a success sends no notice
    it("saves the provider, then sends the settings and the reply", async () => {
      const updateProvider = vi.fn(async () => true);
      const h = createHandler({
        storeManagerService: { ...profileStore(), updateProvider },
      });

      const log = await run(h, APP_EVENTS.SET_PROVIDER, {
        name: "Default",
        key: "secret",
        type: "connector",
      });

      expect(updateProvider).toHaveBeenCalledWith("Default", "secret");
      expect(log).toEqual([
        [
          APP_EVENTS_RESPONSE.GET_SETTINGS,
          expect.objectContaining({ success: true }),
        ],
        [
          APP_EVENTS_RESPONSE.SET_PROVIDER,
          { type: "connector", success: true },
        ],
      ]);
    });

    // The page puts the key main still holds back in the field
    it("sends the settings main holds when the key can't be saved", async () => {
      const h = createHandler({
        storeManagerService: {
          ...profileStore(),
          updateProvider: vi.fn(async () => false),
        },
      });

      await h.invoke(settings, APP_EVENTS.SET_PROVIDER, {
        name: "Default",
        key: "secret",
        type: "connector",
      });

      expect(h.replies(APP_EVENTS_RESPONSE.GET_SETTINGS)).toEqual([
        expect.objectContaining({ success: true }),
      ]);
      expect(h.replies(APP_EVENTS_RESPONSE.SET_PROVIDER)).toEqual([
        expect.objectContaining({ type: "connector", success: false }),
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "error",
          code: FEEDBACK_CODES.SETTINGS_SAVE_FAILED,
        }),
      ]);
    });

    it("replies the type with the failure", async () => {
      const h = createHandler({
        storeManagerService: {
          updateProvider: async () => {
            throw new Error("unknown provider");
          },
        },
      });

      await h.invoke(settings, APP_EVENTS.SET_PROVIDER, {
        name: "Other",
        key: "",
        type: "connector",
      });

      const failure = {
        code: FEEDBACK_CODES.PROVIDER_UPDATE_FAILED,
        message: "Unable to change the provider.",
      };
      expect(h.replies(APP_EVENTS_RESPONSE.SET_PROVIDER)).toEqual([
        { type: "connector", success: false, error: failure },
      ]);
      expect(h.notices).toEqual([expect.objectContaining(failure)]);
    });
  });

  describe("voice keys", () => {
    const engines = [
      { id: "Default", label: "TikTok", keyLabel: "Session ID" },
      { id: "Windows", label: "Windows" },
      { id: "Edge", label: "Edge" },
    ];
    const keys: Record<string, string> = { Default: "session" };

    const setup = () => {
      const storeManagerService = {
        getVoiceKey: vi.fn((engine: string) => keys[engine] ?? ""),
        updateVoiceKey: vi.fn(async () => true),
      };
      const h = createHandler({
        storeManagerService,
        ttsService: { getEngines: () => engines },
      });
      return { h, storeManagerService };
    };

    const keyed = {
      success: true,
      engines: [
        {
          id: "Default",
          label: "TikTok",
          keyLabel: "Session ID",
          key: "session",
        },
      ],
    };

    it("lists only the engines that take a key, with their keys", async () => {
      const { h, storeManagerService } = setup();

      await h.invoke(settings, APP_EVENTS.GET_VOICE_KEYS);

      expect(h.replies(APP_EVENTS_RESPONSE.GET_VOICE_KEYS)).toEqual([keyed]);
      expect(storeManagerService.getVoiceKey).toHaveBeenCalledExactlyOnceWith(
        "Default",
      );
    });

    it("replies and notifies when the keys can't be listed", async () => {
      const h = createHandler({
        ttsService: {
          getEngines: () => {
            throw new Error("no engines");
          },
        },
      });

      await h.invoke(settings, APP_EVENTS.GET_VOICE_KEYS);

      const failure = {
        code: FEEDBACK_CODES.SETTINGS_LOAD_FAILED,
        message: "Unable to load the voice keys.",
      };
      expect(h.replies(APP_EVENTS_RESPONSE.GET_VOICE_KEYS)).toEqual([
        { success: false, error: failure },
      ]);
      expect(h.notices).toEqual([expect.objectContaining(failure)]);
    });

    it.each(["Missing", "Windows"])(
      "refuses a key for the %s engine, which takes none",
      async (engine) => {
        const { h, storeManagerService } = setup();

        await h.invoke(settings, APP_EVENTS.SET_VOICE_KEY, {
          engine,
          key: "abc",
        });

        const failure = {
          code: FEEDBACK_CODES.PROVIDER_UPDATE_FAILED,
          message: "Unable to save the key.",
        };
        expect(storeManagerService.updateVoiceKey).not.toHaveBeenCalled();
        expect(h.replies(APP_EVENTS_RESPONSE.SET_VOICE_KEY)).toEqual([
          { success: false, error: failure },
        ]);
        expect(h.replies(APP_EVENTS_RESPONSE.GET_VOICE_KEYS)).toEqual([]);
        expect(h.notices).toEqual([
          expect.objectContaining({ level: "error", ...failure }),
        ]);
      },
    );

    // Settings saves it as it's typed, so a success sends no notice
    it("saves a key, then sends the reply and the keys", async () => {
      const { h, storeManagerService } = setup();

      const log = await run(h, APP_EVENTS.SET_VOICE_KEY, {
        engine: "Default",
        key: "session",
      });

      expect(storeManagerService.updateVoiceKey).toHaveBeenCalledWith(
        "Default",
        "session",
      );
      expect(log).toEqual([
        [APP_EVENTS_RESPONSE.SET_VOICE_KEY, { success: true }],
        [APP_EVENTS_RESPONSE.GET_VOICE_KEYS, keyed],
      ]);
    });

    // The page puts the key main still holds back in the field
    it("sends the keys main holds when a key can't be saved", async () => {
      const { h, storeManagerService } = setup();
      storeManagerService.updateVoiceKey.mockResolvedValue(false);

      await h.invoke(settings, APP_EVENTS.SET_VOICE_KEY, {
        engine: "Default",
        key: "new-session",
      });

      expect(h.replies(APP_EVENTS_RESPONSE.GET_VOICE_KEYS)).toEqual([keyed]);
      expect(h.replies(APP_EVENTS_RESPONSE.SET_VOICE_KEY)).toEqual([
        expect.objectContaining({ success: false }),
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "error",
          code: FEEDBACK_CODES.SETTINGS_SAVE_FAILED,
        }),
      ]);
    });

    it("removes the key when it's empty", async () => {
      const { h, storeManagerService } = setup();

      await h.invoke(settings, APP_EVENTS.SET_VOICE_KEY, {
        engine: "Default",
        key: "",
      });

      expect(storeManagerService.updateVoiceKey).toHaveBeenCalledWith(
        "Default",
        "",
      );
      expect(h.replies(APP_EVENTS_RESPONSE.SET_VOICE_KEY)).toEqual([
        { success: true },
      ]);
      expect(h.notices).toEqual([]);
    });
  });

  describe("SET_SERVER", () => {
    // toggleServer answers whether the server ended up as asked
    const setup = (result: boolean) => {
      const toggleServer = vi.fn(async () => result);
      const updateServerSettings = vi.fn(async () => true);
      const h = createHandler({
        serverService: { toggleServer },
        storeManagerService: { ...profileStore(), updateServerSettings },
      });
      return { h, toggleServer, updateServerSettings };
    };

    it("turns the server on, saves it and notifies", async () => {
      const { h, toggleServer, updateServerSettings } = setup(true);

      await h.invoke(settings, APP_EVENTS.SET_SERVER, { enabled: true });

      expect(toggleServer).toHaveBeenCalledWith(true);
      expect(updateServerSettings).toHaveBeenCalledWith(true);
      expect(h.replies(APP_EVENTS_RESPONSE.GET_SETTINGS)).toHaveLength(1);
      expect(h.replies(APP_EVENTS_RESPONSE.SET_SERVER)).toEqual([
        { success: true },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "success",
          source: "server",
          code: FEEDBACK_CODES.SERVER_STARTED,
          message: "The overlay server is on.",
        }),
      ]);
    });

    it("turns the server off, saves it and tells the user", async () => {
      const { h, toggleServer, updateServerSettings } = setup(true);

      await h.invoke(settings, APP_EVENTS.SET_SERVER, { enabled: false });

      expect(toggleServer).toHaveBeenCalledWith(false);
      expect(updateServerSettings).toHaveBeenCalledWith(false);
      expect(h.replies(APP_EVENTS_RESPONSE.GET_SETTINGS)).toHaveLength(1);
      expect(h.replies(APP_EVENTS_RESPONSE.SET_SERVER)).toEqual([
        { success: true },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "info",
          source: "server",
          code: FEEDBACK_CODES.SERVER_STOPPED,
          message: "The overlay server is off.",
        }),
      ]);
    });

    it("keeps a running server on and saves it on", async () => {
      const serverService = new ServerService(0);
      const updateServerSettings = vi.fn(async () => true);
      const h = createHandler({
        serverService,
        storeManagerService: { ...profileStore(), updateServerSettings },
      });
      try {
        await serverService.start();

        await h.invoke(settings, APP_EVENTS.SET_SERVER, { enabled: true });

        expect(updateServerSettings).toHaveBeenCalledWith(true);
        expect(h.replies(APP_EVENTS_RESPONSE.SET_SERVER)).toEqual([
          { success: true },
        ]);
      } finally {
        serverService.stop();
      }
    });

    it.each([
      {
        enabled: true,
        message: `The overlay server couldn't start. Port ${SERVER_PORT} may be in use.`,
      },
      { enabled: false, message: "Unable to stop the overlay server." },
    ])(
      "saves it off and reports it when enabled: $enabled fails",
      async ({ enabled, message }) => {
        const { h, updateServerSettings } = setup(false);

        await h.invoke(settings, APP_EVENTS.SET_SERVER, { enabled });

        const failure = { code: FEEDBACK_CODES.SERVER_START_FAILED, message };
        expect(updateServerSettings).toHaveBeenCalledWith(false);
        expect(h.replies(APP_EVENTS_RESPONSE.GET_SETTINGS)).toHaveLength(1);
        expect(h.replies(APP_EVENTS_RESPONSE.SET_SERVER)).toEqual([
          { success: false, error: failure },
        ]);
        expect(h.notices).toEqual([
          expect.objectContaining({
            level: "error",
            source: "server",
            ...failure,
          }),
        ]);
      },
    );
  });

  describe("SET_AUTO_UPDATES", () => {
    const setup = () => {
      const updateUpdatesSettings = vi.fn(async () => true);
      const setAuto = vi.fn();
      const h = createHandler({
        storeManagerService: { ...profileStore(), updateUpdatesSettings },
        updaterService: { setAuto },
      });
      return { h, updateUpdatesSettings, setAuto };
    };

    it.each([
      {
        enabled: true,
        level: "success",
        code: FEEDBACK_CODES.UPDATES_ENABLED,
        message: "Tokio checks for updates automatically.",
      },
      {
        enabled: false,
        level: "info",
        code: FEEDBACK_CODES.UPDATES_DISABLED,
        message: "Automatic update checks are off. Check from About.",
      },
    ])(
      "saves enabled: $enabled, tells the updater and notifies",
      async ({ enabled, ...expected }) => {
        const { h, updateUpdatesSettings, setAuto } = setup();

        await h.invoke(settings, APP_EVENTS.SET_AUTO_UPDATES, { enabled });

        expect(updateUpdatesSettings).toHaveBeenCalledWith(enabled);
        expect(setAuto).toHaveBeenCalledWith(enabled);
        expect(h.replies(APP_EVENTS_RESPONSE.GET_SETTINGS)).toHaveLength(1);
        expect(h.replies(APP_EVENTS_RESPONSE.SET_AUTO_UPDATES)).toEqual([
          { success: true },
        ]);
        expect(h.notices).toEqual([expect.objectContaining(expected)]);
      },
    );

    it("replies and notifies when the setting can't be saved", async () => {
      const setAuto = vi.fn();
      const h = createHandler({
        storeManagerService: {
          updateUpdatesSettings: async () => {
            throw new Error("disk full");
          },
        },
        updaterService: { setAuto },
      });

      await h.invoke(settings, APP_EVENTS.SET_AUTO_UPDATES, { enabled: true });

      const failure = {
        code: FEEDBACK_CODES.SETTINGS_SAVE_FAILED,
        message: "Unable to save the update setting.",
      };
      expect(setAuto).not.toHaveBeenCalled();
      expect(h.replies(APP_EVENTS_RESPONSE.SET_AUTO_UPDATES)).toEqual([
        { success: false, error: failure },
      ]);
      expect(h.notices).toEqual([expect.objectContaining(failure)]);
    });

    it("reports a change the store couldn't write, without a success notice", async () => {
      const home = await mkdtemp(join(tmpdir(), "tokio-test-"));
      const tts = new TTSService();
      try {
        const paths = new PathManagerService();
        await paths.initialize(home, ".tokio");
        const store = new StoreManagerService();
        await store.initialize(
          "store",
          { tts, connector: new TikTokConnectorService() },
          new JSONManagerService(),
          paths,
        );
        // A folder where the store writes its temporary file
        await mkdir(join(paths.folders.settingsFolder, "store.json.tmp"));
        const h = createHandler({
          storeManagerService: store,
          updaterService: { setAuto: vi.fn() },
        });

        await h.invoke(settings, APP_EVENTS.SET_AUTO_UPDATES, {
          enabled: false,
        });

        const failure = {
          code: FEEDBACK_CODES.SETTINGS_SAVE_FAILED,
          message:
            "Tokio couldn't save the change. Check the logs folder for details.",
        };
        expect(h.replies(APP_EVENTS_RESPONSE.SET_AUTO_UPDATES)).toEqual([
          { success: false, error: failure },
        ]);
        expect(h.notices).toEqual([
          expect.objectContaining({ level: "error", ...failure }),
        ]);
      } finally {
        tts.dispose();
        await rm(home, { recursive: true, force: true });
      }
    });
  });

  describe("REQ_FQDN", () => {
    it("replies once the overlay address is set up", async () => {
      const h = createHandler({
        urlManagerService: { installAppFQDN: async () => true },
      });

      await h.invoke(settings, APP_EVENTS.REQ_FQDN);

      expect(h.replies(APP_EVENTS_RESPONSE.REQ_FQDN)).toEqual([
        { success: true },
      ]);
      expect(h.notices).toEqual([]);
    });

    it("warns when the address isn't set up, as when the prompt is declined", async () => {
      const h = createHandler({
        urlManagerService: { installAppFQDN: async () => false },
      });

      await h.invoke(settings, APP_EVENTS.REQ_FQDN);

      const failure = {
        code: FEEDBACK_CODES.FQDN_INSTALL_FAILED,
        message:
          "Unable to set up the overlay address. Accept the administrator prompt to add it.",
      };
      expect(h.replies(APP_EVENTS_RESPONSE.REQ_FQDN)).toEqual([
        { success: false, error: failure },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({ level: "warning", ...failure }),
      ]);
    });
  });
});
