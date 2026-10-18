import { Profile, ProfileSchema, StoreSchema } from "@/common/schemas";
import { TOKIO_EVENTS } from "@/common/types";
import { defaultProfile } from "@/common/util";
import { defaultStoreData } from "@/common/util/constants/store";
import { TikTokConnectorService } from "@/services/connector";
import { JSONManagerService } from "@/services/json";
import { PathManagerService } from "@/services/path";
import { TTSService } from "@/services/tts";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StoreManagerService } from "./index";

describe("StoreManagerService", () => {
  let home: string;
  let paths: PathManagerService;
  let json: JSONManagerService;
  let tts: TTSService;
  let connector: TikTokConnectorService;
  let storeFile: string;
  let defaultProfileFile: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "tokio-test-"));
    paths = new PathManagerService();
    await paths.initialize(home, ".tokio");
    json = new JSONManagerService();
    tts = new TTSService();
    connector = new TikTokConnectorService();
    storeFile = join(paths.folders.settingsFolder, "store.json");
    defaultProfileFile = join(paths.folders.profilesFolder, "default.json");
  });

  afterEach(async () => {
    tts.dispose();
    await rm(home, { recursive: true, force: true });
  });

  const init = async () => {
    const store = new StoreManagerService();
    await store.initialize("store", { tts, connector }, json, paths);
    return store;
  };

  const readJSON = async (file: string) =>
    JSON.parse(await readFile(file, "utf-8"));

  it("refuses to work before initialize", () => {
    expect(() => new StoreManagerService().getSettings()).toThrow(
      "not initialized",
    );
  });

  describe("initialize", () => {
    it("writes the defaults on first run", async () => {
      const store = await init();

      expect(await readJSON(storeFile)).toEqual(defaultStoreData);
      expect(await readJSON(defaultProfileFile)).toEqual(defaultProfile);
      expect(await store.getProfileData()).toEqual(defaultProfile);
    });

    it("backs up a corrupted store and starts over", async () => {
      await writeFile(storeFile, "{ oops");

      await init();

      expect(
        await readFile(storeFile.replace(".json", ".corrupted.json"), "utf-8"),
      ).toBe("{ oops");
      expect(await readJSON(storeFile)).toEqual(defaultStoreData);
    });

    it("keeps the Default profile when the store is rebuilt", async () => {
      const custom = { ...defaultProfile, name: "My setup" };
      await writeFile(defaultProfileFile, JSON.stringify(custom));
      await writeFile(storeFile, "{ oops");

      await init();

      expect(await readJSON(defaultProfileFile)).toEqual(custom);
    });

    it("replaces a Default profile that can't be loaded", async () => {
      await writeFile(defaultProfileFile, "{ oops");

      await init();

      expect(await readJSON(defaultProfileFile)).toEqual(defaultProfile);
    });

    it("lists the profiles still on disk when the store is rebuilt", async () => {
      const profile = (name: string) =>
        JSON.stringify({ ...defaultProfile, name });
      const folder = paths.folders.profilesFolder;
      await writeFile(join(folder, "a-stream.json"), profile("Stream"));
      await writeFile(join(folder, "broken.json"), "{ oops");
      await writeFile(join(folder, "notes.txt"), profile("Not a profile"));
      await writeFile(storeFile, "{ oops");

      const store = await init();

      expect(store.getProfiles()).toEqual([
        defaultStoreData.profiles[0],
        { file: "a-stream.json", name: "Stream" },
      ]);
      expect((await readJSON(storeFile)).profiles).toEqual(store.getProfiles());
    });

    it("recovers the sound library when the store is rebuilt", async () => {
      const folder = paths.folders.soundsFolder;
      for (const file of ["used.mp3", "shared.wav", "unused.ogg", "z.mp3"]) {
        await writeFile(join(folder, file), "audio");
      }
      await writeFile(join(folder, "notes.txt"), "not audio");
      const alert = (id: string, sound: { name: string; file: string }) => ({
        id,
        enabled: true,
        trigger: { type: TOKIO_EVENTS.FOLLOW, gifts: [] },
        sound,
        volume: 100,
      });
      const withAlerts = (name: string, items: ReturnType<typeof alert>[]) =>
        JSON.stringify({
          ...defaultProfile,
          name,
          alerts: { ...defaultProfile.alerts, items },
        });
      await writeFile(
        defaultProfileFile,
        withAlerts("Default", [
          alert("a", { name: "Ding", file: "used.mp3" }),
          alert("b", { name: "Gone", file: "deleted.mp3" }),
        ]),
      );
      await writeFile(
        join(paths.folders.profilesFolder, "stream.json"),
        withAlerts("Stream", [
          alert("c", { name: "Pop", file: "shared.wav" }),
          alert("d", { name: "Ding again", file: "used.mp3" }),
        ]),
      );
      await writeFile(storeFile, "{ oops");

      const store = await init();

      expect(store.wasRebuilt()).toBe(true);
      expect(store.getSounds()).toEqual([
        { name: "Ding", file: "used.mp3" },
        { name: "Pop", file: "shared.wav" },
        { name: "Recovered sound 1", file: "unused.ogg" },
        { name: "Recovered sound 2", file: "z.mp3" },
      ]);
    });

    it("is not rebuilt when the store loads", async () => {
      await init();

      expect((await init()).wasRebuilt()).toBe(false);
    });

    it("loads data saved before newer fields existed", async () => {
      const old: Partial<StoreSchema["settings"]> = structuredClone(
        defaultStoreData.settings,
      );
      delete old.sounds;
      delete old.testOverlays;
      const oldProfile: Partial<Profile> = structuredClone(defaultProfile);
      delete oldProfile.alerts;
      await writeFile(
        storeFile,
        JSON.stringify({ ...defaultStoreData, settings: old }),
      );
      await writeFile(defaultProfileFile, JSON.stringify(oldProfile));

      const store = await init();

      expect(store.getSounds()).toEqual([]);
      expect(store.getSettings().testOverlays).toEqual([]);
      expect((await store.getProfileData())?.alerts).toEqual(
        defaultProfile.alerts,
      );
    });

    it("restores the saved voice keys decrypted", async () => {
      const first = await init();
      await first.updateVoiceKey("Default", "secret");
      expect(await readFile(storeFile, "utf-8")).not.toContain("secret");

      const setEngineKey = vi.spyOn(tts, "setEngineKey");
      await init();

      expect(setEngineKey).toHaveBeenCalledExactlyOnceWith("Default", "secret");
    });

    it("speaks old voices with the TTS provider selected before", async () => {
      const data = structuredClone(defaultStoreData);
      data.settings.activeTTSProvider = {
        name: "Edge",
        key: "",
        active: true,
      };
      await writeFile(storeFile, JSON.stringify(data));

      const setProvider = vi.spyOn(tts, "setProvider");
      await init();

      expect(setProvider).toHaveBeenCalledWith("Edge");
    });

    it("loads voices saved without an engine", async () => {
      await init();
      const oldProfile = structuredClone(defaultProfile);
      const { engine: _engine, ...voice } = oldProfile.tts.voice;
      await writeFile(
        defaultProfileFile,
        JSON.stringify({ ...oldProfile, tts: { ...oldProfile.tts, voice } }),
      );

      const store = await init();

      expect((await store.getProfileData())?.tts.voice).toEqual({
        ...voice,
        engine: "",
      });
    });
  });

  describe("voice keys", () => {
    it("saves a key for its engine and hands it over", async () => {
      const store = await init();
      const setEngineKey = vi.spyOn(tts, "setEngineKey");

      await store.updateVoiceKey("Default", "session");

      expect(setEngineKey).toHaveBeenCalledExactlyOnceWith(
        "Default",
        "session",
      );
      expect(store.getVoiceKey("Default")).toBe("session");
      expect(store.getVoiceKey("Edge")).toBe("");
      expect(store.getSettings().providers.tts).toContainEqual({
        name: "Default",
        key: "session",
        active: true,
      });
    });
  });

  describe("getSettings", () => {
    it("decrypts keys and lists registered providers that were never saved", async () => {
      const store = await init();
      await store.updateProvider("Default", "session");

      const settings = store.getSettings();

      expect(settings.activeConnProvider.key).toBe("session");
      expect(settings.providers.connector).toEqual([
        { name: "Default", key: "session", active: true },
      ]);
      expect(settings.providers.tts).toContainEqual({
        name: "Edge",
        key: "",
        active: false,
      });
    });
  });

  describe("updates", () => {
    it("turns automatic checks on for stores saved before the setting", async () => {
      const { updates: _updates, ...settings } = defaultStoreData.settings;
      await writeFile(
        storeFile,
        JSON.stringify({ ...defaultStoreData, settings }),
      );

      const store = await init();

      expect(store.getSettings().updates).toEqual({ auto: true });
    });

    it("saves the setting", async () => {
      const store = await init();

      await store.updateUpdatesSettings(false);

      expect((await readJSON(storeFile)).settings.updates).toEqual({
        auto: false,
      });
      expect((await init()).getSettings().updates).toEqual({ auto: false });
    });
  });

  describe("live state", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    it("reads the active features without a copy", async () => {
      const store = await init();

      store.updateActiveFeatures({ tts: true });

      expect(store.getActiveFeatures()).toEqual({
        tts: true,
        music: false,
        alerts: false,
      });
    });

    it("keeps live stats in memory only", async () => {
      const store = await init();
      vi.useFakeTimers();

      store.updateLiveStats({ likes: 5, viewers: 2 });
      await vi.advanceTimersByTimeAsync(1000);

      expect(store.getSettings().liveStats).toEqual({
        likes: 5,
        viewers: 2,
        views: 0,
      });
      expect((await readJSON(storeFile)).settings.liveStats.likes).toBe(0);
    });
  });

  describe("profiles", () => {
    it("creates a profile once", async () => {
      const store = await init();

      const created = await store.createNewProfile("stream.json", "Stream");
      await store.addProfile({ file: "stream.json", name: "Stream" });

      expect(created).toEqual({ file: "stream.json", name: "Stream" });
      expect(store.getProfiles()).toHaveLength(2);
      const saved = await json.loadFile(
        join(paths.folders.profilesFolder, "stream.json"),
        ProfileSchema,
      );
      expect(saved?.name).toBe("Stream");
    });

    it("clones a profile under a new name", async () => {
      const store = await init();
      await store.updateProfileData({ connector: { username: "streamer" } });

      await store.cloneProfile("default.json", "copy.json", "Copy");

      const copy = await json.loadFile(
        join(paths.folders.profilesFolder, "copy.json"),
        ProfileSchema,
      );
      expect(copy?.name).toBe("Copy");
      expect(copy?.connector.username).toBe("streamer");
    });

    it("falls back to the default profile for an unknown file", async () => {
      const store = await init();

      await store.updateActiveProfile("missing.json");

      expect(store.getSettings().activeProfile).toEqual(
        defaultStoreData.profiles[0],
      );
    });

    it("switches the profile that updates go to", async () => {
      const store = await init();
      await store.createNewProfile("stream.json", "Stream");

      await store.updateActiveProfile("stream.json");
      await store.updateProfileData({ connector: { username: "streamer" } });

      expect((await store.getProfileData())?.name).toBe("Stream");
      expect(
        (await readJSON(join(paths.folders.profilesFolder, "stream.json")))
          .connector.username,
      ).toBe("streamer");
      expect((await readJSON(defaultProfileFile)).connector.username).toBe("");
    });

    it("loads profiles saved before emotes and alert filters", async () => {
      const old: Partial<Profile> = structuredClone(defaultProfile);
      delete old.emotes;
      const item = (id: string, type: TOKIO_EVENTS) => ({
        id,
        enabled: true,
        trigger: { type, gifts: [] },
        sound: null,
        volume: 100,
      });
      const items = [item("chat", TOKIO_EVENTS.CHAT)];
      await writeFile(
        defaultProfileFile,
        JSON.stringify({ ...old, alerts: { ...old.alerts, items } }),
      );

      const profile = await (await init()).getProfileData();

      expect(profile?.emotes).toEqual([]);
      expect(profile?.alerts.items.map((a) => a.trigger)).toEqual([
        {
          type: TOKIO_EVENTS.CHAT,
          gifts: [],
          emotes: [],
          keyword: "",
          user: "",
        },
      ]);
    });
  });

  describe("emotes", () => {
    const emote = (
      emoteID: string,
      image = `https://example.com/${emoteID}.webp`,
    ) => ({ emoteID, index: 0, images: [image] });

    const saved = (id: string) => ({
      id,
      image: `https://example.com/${id}.webp`,
    });

    it("saves new emotes to the profile in the order they appear", async () => {
      const store = await init();

      const res = await store.recordEmotes([
        emote("e1"),
        emote("e2"),
        emote("e1"),
      ]);

      expect(res).toEqual({ success: true, data: [saved("e1"), saved("e2")] });
      expect((await readJSON(defaultProfileFile)).emotes).toEqual(res.data);
    });

    it("only returns the list when it changed", async () => {
      const store = await init();
      await store.recordEmotes([emote("e1")]);

      const res = await store.recordEmotes([
        emote("e1"),
        emote(""),
        { emoteID: "e3", index: 0, images: [] },
      ]);

      expect(res).toEqual({ success: true });
      expect((await store.getProfileData())?.emotes).toEqual([saved("e1")]);
    });

    it("keeps the emotes of chats saved at the same time", async () => {
      const store = await init();

      await Promise.all([
        store.recordEmotes([emote("e1")]),
        store.recordEmotes([emote("e2")]),
      ]);

      expect((await readJSON(defaultProfileFile)).emotes).toEqual([
        saved("e1"),
        saved("e2"),
      ]);
    });

    it("updates a saved emote's image once per run", async () => {
      await writeFile(
        defaultProfileFile,
        JSON.stringify({
          ...defaultProfile,
          emotes: [{ id: "e1", image: "old" }],
        }),
      );
      const store = await init();

      const res = await store.recordEmotes([emote("e1", "new")]);
      const again = await store.recordEmotes([emote("e1", "newer")]);

      expect(res.data).toEqual([{ id: "e1", image: "new" }]);
      expect(again).toEqual({ success: true });
    });
  });

  describe("sounds", () => {
    const sound = { name: "Ding", file: "ding.mp3" };

    it("adds a sound file once and removes it", async () => {
      const store = await init();

      await store.addSound(sound);
      await store.addSound({ ...sound, name: "Other name" });
      expect(store.getSounds()).toEqual([sound]);

      await store.removeSound("ding.mp3");
      expect(store.getSounds()).toEqual([]);
    });

    it("knows when an alert in any profile uses a sound", async () => {
      const store = await init();
      await store.createNewProfile("stream.json", "Stream");
      await store.updateActiveProfile("stream.json");
      await store.updateProfileData({
        alerts: {
          ...defaultProfile.alerts,
          items: [
            {
              id: "a",
              enabled: false,
              trigger: {
                type: TOKIO_EVENTS.FOLLOW,
                gifts: [],
                emotes: [],
                keyword: "",
                user: "",
              },
              sound,
              volume: 100,
            },
          ],
        },
      });

      expect(await store.isSoundInUse("ding.mp3")).toBe(true);
      expect(await store.isSoundInUse("other.mp3")).toBe(false);
    });
  });

  describe("test overlays", () => {
    it("saves and removes test overlays", async () => {
      const store = await init();
      const overlay = { id: "a", name: "Dev" };

      await store.addTestOverlay(overlay);
      expect((await init()).getSettings().testOverlays).toEqual([overlay]);

      await store.removeTestOverlay("a");
      expect((await init()).getSettings().testOverlays).toEqual([]);
    });
  });
});
