import {
  ActivityFeed,
  AlertSound,
  AppProvider,
  AppSettings,
  EntityMetadata,
  MediaFile,
  OverlayMetadata,
  Profile,
  ProfileSchema,
  SavedEmote,
  StoreSchema,
  StoreZodSchema,
  TestOverlay,
} from "@/common/schemas";
import { Emotes } from "@/common/types";
import { defaultProfile, formatError, MEDIA_EXTENSIONS } from "@/common/util";
import { defaultStoreData } from "@/common/util/constants/store";
import { cleanText } from "@/helper/chat";
import { isInside } from "@/helper/path";
import { track } from "@/helper/quit";
import Logger from "@/logger";
import { AUDIO_EXTENSIONS } from "@/services/alerts";
import { TikTokConnectorService } from "@/services/connector";
import { JSONManagerService } from "@/services/json";
import { PathManagerService } from "@/services/path";
import { TTSService } from "@/services/tts";
import { safeStorage } from "electron";
import { access, copyFile, readdir, readFile, unlink } from "fs/promises";
import { randomUUID } from "node:crypto";
import { basename, extname, join, resolve } from "path";
import { Service } from "../shared";

type Providers = {
  tts: TTSService;
  connector: TikTokConnectorService;
};

// safeStorage output starts with "v" and two digits: v10 and v11 so far, and a
// newer key provider adds its own. Anything else was saved while encryption
// was unavailable, as plain text.
const isEncrypted = (key: string) =>
  /^v\d\d$/.test(Buffer.from(key, "base64").subarray(0, 3).toString("latin1"));

export class StoreManagerService extends Service {
  private _jsonManagerService!: JSONManagerService;
  private _pathManagerService!: PathManagerService;
  private _providers!: Providers;
  private _storeFilePath!: string;
  private _storeData: StoreSchema | null = null;
  private _memoryProfile: Profile | null = null;
  private _rebuilt = false;
  // Emote saves run one after another, so one doesn't drop another's emotes.
  private _emoteSave: Promise<unknown> = Promise.resolve();
  // The store's own saves, chained by _queueSave. saveFile never rejects.
  private _saving: Promise<boolean> = Promise.resolve(true);
  // Emotes whose image was already compared since the app started
  private _checkedEmotes = new Set<string>();
  // Saved key (encrypted, in base64) → the key. Filled at startup and as keys
  // change, so reads don't wait for safeStorage's async calls.
  private _keys = new Map<string, string>();

  public setLogFile(logFile: string) {
    this._logFile = logFile;
  }

  public async getProfileData() {
    if (this._memoryProfile !== null) return this._memoryProfile;
    this._memoryProfile = await this._getProfileData();
    return this._memoryProfile;
  }

  public async initialize(
    storeName: string,
    providers: Providers,
    jsonManagerService: JSONManagerService,
    pathManagerService: PathManagerService,
  ): Promise<void> {
    if (this._storeData) return;

    this._pathManagerService = pathManagerService;
    this._jsonManagerService = jsonManagerService;
    this._providers = providers;
    this._storeFilePath = join(
      this._pathManagerService.folders.settingsFolder,
      `${storeName}.json`,
    );

    let data: StoreSchema | null = null;
    let storeFileExists = true;

    try {
      await access(this._storeFilePath);
    } catch {
      storeFileExists = false;
    }

    try {
      if (storeFileExists) {
        data = await this._jsonManagerService.loadFile(
          this._storeFilePath,
          StoreZodSchema,
        );
        if (!data) await this._backupCorruptedStore();
      }

      if (!data) {
        await this._generatePhysicalDefaults();
        data = structuredClone(defaultStoreData);
        const profiles = await this._findProfiles();
        data.profiles = profiles.map(({ file, profile }) => ({
          file,
          name: profile.name,
        }));
        const { soundsFolder, mediaFolder } = this._pathManagerService.folders;
        const alerts = profiles.flatMap(({ profile }) => profile.alerts.items);
        data.settings.sounds = await this._findFiles(
          soundsFolder,
          AUDIO_EXTENSIONS,
          alerts.map((alert) => alert.sound),
          "Recovered sound",
        );
        data.settings.media = await this._findFiles(
          mediaFolder,
          MEDIA_EXTENSIONS,
          alerts.map((alert) => alert.media),
          "Recovered media",
        );
        this._rebuilt = true;
        await this._jsonManagerService.saveFile(
          this._storeFilePath,
          StoreZodSchema,
          data,
        );
      } else {
        await this._decryptKeys(data.settings);
        const conn_p = this._withKey(data.settings.activeConnProvider);
        this._providers.connector.setProvider(conn_p.name, conn_p.key);
        // Speaks the voices saved before the engines were combined.
        this._providers.tts.setProvider(data.settings.activeTTSProvider.name);
        for (const saved of data.settings.providers.tts) {
          const { name, key } = this._withKey(saved);
          if (key) this._providers.tts.setEngineKey(name, key);
        }
      }
      this._storeData = data;
      Logger.success(`<System> JSON Store initialized cleanly`, this._logFile);
    } catch (error) {
      Logger.error(
        `<System> Fatal: Unable to initialize JSON store -- ${formatError(error)}`,
        this._logFile,
        error,
      );
      throw new Error("Unable to initialize store.", { cause: error });
    }
  }

  private _activeProfileFile() {
    return this._storeData?.settings.activeProfile.file || "default.json";
  }

  private async _getProfileData() {
    return await this._jsonManagerService.loadFile(
      join(
        this._pathManagerService.folders.profilesFolder,
        this._activeProfileFile(),
      ),
      ProfileSchema,
    );
  }

  private async _generatePhysicalDefaults(): Promise<void> {
    const defaultProfilePath = join(
      this._pathManagerService.folders.profilesFolder,
      "default.json",
    );

    // The store can be rebuilt (missing or corrupted) while the user's Default
    // profile is fine, so only write it when it can't be loaded.
    const existing = await this._jsonManagerService.loadFile(
      defaultProfilePath,
      ProfileSchema,
    );
    if (existing) return;

    await this._jsonManagerService.saveFile(
      defaultProfilePath,
      ProfileSchema,
      defaultProfile,
    );
  }

  /**
   * Whether initialize started from the defaults (first run, or a missing or
   * corrupted store). Things only the store knew, like overlays, are then
   * recovered by the caller.
   */
  public wasRebuilt(): boolean {
    return this._rebuilt;
  }

  // Profile files outlive a rebuilt store, so list the ones that still load.
  private async _findProfiles(): Promise<{ file: string; profile: Profile }[]> {
    const folder = this._pathManagerService.folders.profilesFolder;
    const files = (await readdir(folder))
      .filter((file) => extname(file) === ".json")
      .sort();

    const profiles: { file: string; profile: Profile }[] = [];
    for (const file of files) {
      const profile = await this._jsonManagerService.loadFile(
        join(folder, file),
        ProfileSchema,
      );
      if (profile) profiles.push({ file, profile });
    }

    // Default first, like a fresh store.
    const isDefault = (p: { file: string }) =>
      p.file === defaultStoreData.profiles[0].file;
    return [
      ...profiles.filter(isDefault),
      ...profiles.filter((p) => !isDefault(p)),
    ];
  }

  // Alerts keep the names of the sounds and media they use. Files no alert
  // uses lost their name, they're listed anyway so they can be deleted.
  private async _findFiles(
    folder: string,
    extensions: string[],
    used: (AlertSound | null)[],
    label: string,
  ): Promise<AlertSound[]> {
    const files = new Set(
      (await readdir(folder).catch(() => []))
        .filter((file) => extensions.includes(extname(file).slice(1)))
        .sort(),
    );

    const found = new Map<string, AlertSound>();
    for (const entry of used) {
      if (entry && files.has(entry.file) && !found.has(entry.file)) {
        // Without the duration media alerts also keep
        found.set(entry.file, { name: entry.name, file: entry.file });
      }
    }

    let unnamed = 0;
    for (const file of files) {
      if (!found.has(file)) {
        found.set(file, { name: `${label} ${++unnamed}`, file });
      }
    }

    return [...found.values()];
  }

  public getSettings(): AppSettings {
    this._ensureInitialized();

    const clonedSettings = structuredClone(this._storeData!.settings);

    clonedSettings.providers = {
      connector: this._withRegisteredProviders(
        clonedSettings.providers.connector.map((p) => this._withKey(p)),
        this._providers.connector,
      ),
      tts: this._withRegisteredProviders(
        clonedSettings.providers.tts.map((p) => this._withKey(p)),
        this._providers.tts,
      ),
    };

    clonedSettings.activeConnProvider = this._withKey(
      clonedSettings.activeConnProvider,
    );
    clonedSettings.activeTTSProvider = this._withKey(
      clonedSettings.activeTTSProvider,
    );

    return clonedSettings;
  }

  // Registered providers that were never saved still need to be selectable.
  private _withRegisteredProviders(
    saved: AppProvider[],
    service: { providerNames(): string[] },
  ): AppProvider[] {
    const missing = service
      .providerNames()
      .filter((name) => !saved.some((p) => p.name === name))
      .map((name) => ({ name, key: "", active: false }));
    return [...saved, ...missing];
  }

  /**
   * The features turned on, read on every live event. Unlike getSettings it
   * neither clones nor decrypts, so don't change the object it returns.
   */
  public getActiveFeatures(): Readonly<AppSettings["activeFeatures"]> {
    this._ensureInitialized();
    return this._storeData!.settings.activeFeatures;
  }

  public getProfiles(): EntityMetadata[] {
    this._ensureInitialized();
    return this._storeData!.profiles;
  }

  public async updateServerSettings(enabled: boolean): Promise<boolean> {
    this._ensureInitialized();
    this._storeData!.settings.server = { enabled };
    return this._queueSave();
  }

  public async updateUpdatesSettings(auto: boolean): Promise<boolean> {
    this._ensureInitialized();
    this._storeData!.settings.updates = { auto };
    return this._queueSave();
  }

  public async updateTraySettings(enabled: boolean): Promise<boolean> {
    this._ensureInitialized();
    this._storeData!.settings.tray = { enabled };
    return this._queueSave();
  }

  public async updateActivityFeed(feed: ActivityFeed): Promise<boolean> {
    this._ensureInitialized();
    this._storeData!.settings.activityFeed = { ...feed };
    return this._queueSave();
  }

  public async addOverlayInfo(
    info: OverlayMetadata & { id: string },
  ): Promise<boolean> {
    this._ensureInitialized();
    this._storeData!.settings.overlays.push(info);
    return this._queueSave();
  }
  // Replaces the stored overlay with the same id, keeping its place.
  public async updateOverlayInfo(
    info: OverlayMetadata & { id: string },
  ): Promise<boolean> {
    this._ensureInitialized();
    this._storeData!.settings.overlays = this._storeData!.settings.overlays.map(
      (o) => (o.id === info.id ? info : o),
    );
    return this._queueSave();
  }

  public async removeOverlayInfo(id: string): Promise<boolean> {
    this._ensureInitialized();
    this._storeData!.settings.overlays =
      this._storeData!.settings.overlays.filter((o) => o.id !== id);
    return this._queueSave();
  }

  public async addTestOverlay(overlay: TestOverlay): Promise<boolean> {
    this._ensureInitialized();
    this._storeData!.settings.testOverlays.push(overlay);
    return this._queueSave();
  }

  public async removeTestOverlay(id: string): Promise<boolean> {
    this._ensureInitialized();
    this._storeData!.settings.testOverlays =
      this._storeData!.settings.testOverlays.filter((o) => o.id !== id);
    return this._queueSave();
  }

  public getSounds(): AlertSound[] {
    this._ensureInitialized();
    return this._storeData!.settings.sounds;
  }

  public addSound(sound: AlertSound): Promise<boolean> {
    return this._addFile("sounds", sound);
  }

  public removeSound(file: string): Promise<boolean> {
    return this._removeFile("sounds", file);
  }

  public getMedia(): MediaFile[] {
    this._ensureInitialized();
    return this._storeData!.settings.media;
  }

  public addMedia(media: MediaFile): Promise<boolean> {
    return this._addFile("media", media);
  }

  public removeMedia(file: string): Promise<boolean> {
    return this._removeFile("media", file);
  }

  /**
   * Takes a deleted sound or media file off every alert that has it, in
   * every profile. False when a profile that had it couldn't be saved.
   */
  public async removeFromAlerts(
    field: "sound" | "media",
    file: string,
  ): Promise<boolean> {
    this._ensureInitialized();
    let saved = true;
    for (const { file: profileFile } of this.getProfiles()) {
      const active = profileFile === this._activeProfileFile();
      const path = join(
        this._pathManagerService.folders.profilesFolder,
        profileFile,
      );
      const profile = active
        ? await this.getProfileData()
        : await this._jsonManagerService.loadFile(path, ProfileSchema);
      if (!profile?.alerts.items.some((a) => a[field]?.file === file)) {
        continue;
      }

      const items = profile.alerts.items.map((a) =>
        a[field]?.file === file ? { ...a, [field]: null } : a,
      );
      const alerts = { ...profile.alerts, items };
      // The active one through updateProfileData, which keeps it in memory
      const done = active
        ? await this.updateProfileData({ alerts })
        : (
            await this._jsonManagerService.updateFile(path, ProfileSchema, {
              alerts,
            })
          ).success;
      saved &&= done;
    }
    return saved;
  }

  private async _addFile(
    library: "sounds" | "media",
    entry: AlertSound,
  ): Promise<boolean> {
    this._ensureInitialized();
    const files = this._storeData!.settings[library];
    // Files are named by content, so the same file means the same entry.
    if (files.some((f) => f.file === entry.file)) return true;
    files.push(entry);
    return this._queueSave();
  }

  private async _removeFile(
    library: "sounds" | "media",
    file: string,
  ): Promise<boolean> {
    this._ensureInitialized();
    const settings = this._storeData!.settings;
    settings[library] = settings[library].filter((f) => f.file !== file);
    return this._queueSave();
  }

  /**
   * Adds a chat's new emotes to the active profile. data is the new list,
   * only set when it changed.
   */
  public recordEmotes(
    emotes: Emotes[],
  ): Promise<{ success: boolean; data?: SavedEmote[] }> {
    const save = this._emoteSave.then(() => this._recordEmotes(emotes));
    this._emoteSave = save.catch(() => {});
    return save;
  }

  private async _recordEmotes(
    emotes: Emotes[],
  ): Promise<{ success: boolean; data?: SavedEmote[] }> {
    const profile = await this.getProfileData();
    if (!profile) return { success: false };

    const saved = [...profile.emotes];
    let changed = false;
    for (const { emoteID: id, images } of emotes) {
      const image = images[0];
      if (!id || !image) continue;

      const index = saved.findIndex((e) => e.id === id);
      if (index === -1) {
        saved.push({ id, image });
        changed = true;
      } else if (!this._checkedEmotes.has(id) && saved[index].image !== image) {
        // Once per run, in case TikTok moves the image.
        saved[index] = { id, image };
        changed = true;
      }
      this._checkedEmotes.add(id);
    }

    if (!changed) return { success: true };
    if (!(await this.updateProfileData({ emotes: saved }))) {
      return { success: false };
    }
    return { success: true, data: saved };
  }

  // Kept in memory only, they're reset when the app loads.
  public updateLiveStats(data: {
    likes?: number;
    viewers?: number;
    views?: number;
  }) {
    this._ensureInitialized();
    this._storeData!.settings.liveStats = {
      ...this._storeData!.settings.liveStats,
      ...data,
    };
  }

  public async updateActiveFeatures(data: {
    tts?: boolean;
    music?: boolean;
    alerts?: boolean;
  }): Promise<boolean> {
    this._ensureInitialized();
    this._storeData!.settings.activeFeatures = {
      ...this._storeData!.settings.activeFeatures,
      ...data,
    };
    return this._queueSave();
  }

  /**
   * Makes a profile of the list the active one. Nothing changes when it isn't
   * listed or its file can't be loaded ("missing"), or the switch can't be
   * saved ("unsaved").
   */
  public async updateActiveProfile(
    file: string,
  ): Promise<"switched" | "missing" | "unsaved"> {
    this._ensureInitialized();
    const entity = this._storeData!.profiles.find((p) => p.file === file);
    if (!entity) return "missing";
    const profile = await this._jsonManagerService.loadFile(
      join(this._pathManagerService.folders.profilesFolder, file),
      ProfileSchema,
    );
    if (!profile) return "missing";

    const previous = this._storeData!.settings.activeProfile;
    this._storeData!.settings.activeProfile = entity;
    if (!(await this._queueSave())) {
      this._storeData!.settings.activeProfile = previous;
      return "unsaved";
    }
    this._memoryProfile = profile;
    return "switched";
  }

  // The connector provider. TTS engines aren't picked, every voice names one.
  public async updateProvider(name: string, key?: string): Promise<boolean> {
    this._ensureInitialized();
    if (!name) return false;

    const provider = await this._encryptProviderKey({
      name,
      key: key || "",
      active: true,
    });

    const settings = this._storeData!.settings;
    const targetList = settings.providers.connector;

    const existingIndex = targetList.findIndex((p) => p.name === name);
    if (existingIndex !== -1) {
      targetList[existingIndex] = provider;
    } else {
      targetList.push(provider);
    }

    settings.activeConnProvider = provider;
    this._providers.connector.setProvider(name, key);

    return this._queueSave();
  }

  public getVoiceKey(engine: string): string {
    this._ensureInitialized();
    const saved = this._storeData!.settings.providers.tts.find(
      (p) => p.name === engine,
    );
    return saved ? this._withKey(saved).key : "";
  }

  // Keys are saved with the provider list, encrypted.
  public async updateVoiceKey(engine: string, key: string): Promise<boolean> {
    this._ensureInitialized();
    const list = this._storeData!.settings.providers.tts;
    const index = list.findIndex((p) => p.name === engine);
    const saved = await this._encryptProviderKey({
      name: engine,
      key,
      active: list[index]?.active ?? false,
    });
    if (index !== -1) {
      list[index] = saved;
    } else {
      list.push(saved);
    }

    this._providers.tts.setEngineKey(engine, key);
    return this._queueSave();
  }

  /**
   * Writes a new profile's file and lists it. "unsaved" when only the store
   * couldn't be saved, null for any other failure.
   */
  public async createNewProfile(
    fileName: string,
    profileName: string,
  ): Promise<EntityMetadata | "unsaved" | null> {
    this._ensureInitialized();
    if (!fileName || !profileName) return null;

    if (!(await this._isFreeProfileFile(fileName))) {
      Logger.error(
        `<System> Refused to create the profile file ${fileName}, it isn't a free file name.`,
        this._logFile,
      );
      return null;
    }

    const newPath = join(
      this._pathManagerService.folders.profilesFolder,
      fileName,
    );
    const newProfileData = { ...defaultProfile, name: profileName };

    const saved = await this._jsonManagerService.saveFile(
      newPath,
      ProfileSchema,
      newProfileData,
    );

    if (!saved) {
      Logger.error(
        `<System> Failed to write new profile file: ${fileName}`,
        this._logFile,
      );
      return null;
    }

    return this._listNewProfile({ file: fileName, name: profileName });
  }

  // As createNewProfile, with a copy of another profile's file.
  public async cloneProfile(
    referenceFileName: string,
    newFileName: string,
    newProfileName: string,
  ): Promise<EntityMetadata | "unsaved" | null> {
    this._ensureInitialized();
    if (!referenceFileName || !newFileName || !newProfileName) return null;
    if (!(await this._isFreeProfileFile(newFileName))) {
      Logger.error(
        `<System> Refused to clone into the profile file ${newFileName}, it isn't a free file name.`,
        this._logFile,
      );
      return null;
    }

    const refPath = join(
      this._pathManagerService.folders.profilesFolder,
      referenceFileName,
    );
    const newPath = join(
      this._pathManagerService.folders.profilesFolder,
      newFileName,
    );

    const existingData = await this._jsonManagerService.loadFile(
      refPath,
      ProfileSchema,
    );
    if (!existingData) {
      Logger.error(
        `<System> Clone failed: Reference profile ${referenceFileName} not found.`,
        this._logFile,
      );
      return null;
    }

    const clonedData = {
      ...structuredClone(existingData),
      name: newProfileName,
    };
    const saved = await this._jsonManagerService.saveFile(
      newPath,
      ProfileSchema,
      clonedData,
    );

    if (!saved) {
      Logger.error(
        `<System> Failed to write cloned profile file: ${newFileName}`,
        this._logFile,
      );
      return null;
    }

    return this._listNewProfile({ file: newFileName, name: newProfileName });
  }

  public async exportProfile(ref: string, path: string): Promise<boolean> {
    return this._exportEntity(
      ref,
      path,
      this._pathManagerService.folders.profilesFolder,
      ProfileSchema,
      "profile",
    );
  }

  // Copied to a free file named after its file, and listed under its own
  // name, numbered when another profile has it. Fails as createNewProfile.
  public async importProfile(
    ref: string,
  ): Promise<EntityMetadata | "unsaved" | null> {
    this._ensureInitialized();
    if (!ref) return null;
    const file = await this._freeProfileFile(basename(ref, extname(ref)));
    const result = await this._importEntity(
      ref,
      file,
      this._pathManagerService.folders.profilesFolder,
      ProfileSchema,
      "profile",
    );
    if (!result) return null;
    return this._listNewProfile(result);
  }

  // A profile whose file the store can't list is deleted, so it doesn't take
  // the name's file or come back when the store is rebuilt.
  private async _listNewProfile(
    profile: EntityMetadata,
  ): Promise<EntityMetadata | "unsaved"> {
    if (await this.addProfile(profile)) return profile;
    const path = join(
      this._pathManagerService.folders.profilesFolder,
      profile.file,
    );
    await unlink(path).catch((err) =>
      Logger.warn(
        `<System> Unable to delete the unlisted profile file ${path} -- ${formatError(err)}`,
        this._logFile,
      ),
    );
    return "unsaved";
  }

  /**
   * A free file for a new profile, named after it in lowercase ASCII letters,
   * digits, "-" and "_", with a number added when another profile has it.
   */
  public async profileFileFor(name: string): Promise<string> {
    this._ensureInitialized();
    const slug = cleanText(name, { asciiOnly: true })
      .replace(/[^a-z0-9_-]+/g, "-")
      .slice(0, 64)
      .replace(/^-+|-+$/g, "");
    return this._freeProfileFile(slug || "profile");
  }

  // `base`.json, or `base`-2.json and on when it's taken
  private async _freeProfileFile(base: string): Promise<string> {
    for (let n = 1; n <= 1000; n++) {
      const file = n === 1 ? `${base}.json` : `${base}-${n}.json`;
      if (await this._isFreeProfileFile(file)) return file;
    }
    return `${randomUUID()}.json`;
  }

  // A plain file name in the profiles folder that no profile has, listed or
  // on disk, where file names don't differ only by case.
  private async _isFreeProfileFile(file: string): Promise<boolean> {
    const folder = this._pathManagerService.folders.profilesFolder;
    const path = join(folder, file);
    if (basename(file) !== file || !isInside(folder, path)) return false;
    const listed = this._storeData!.profiles.some(
      (p) => p.file.toLowerCase() === file.toLowerCase(),
    );
    if (listed) return false;
    return access(path).then(
      () => false,
      () => true,
    );
  }

  private async _exportEntity(
    ref: string,
    destPath: string,
    sourceFolder: string,
    schema: any,
    typeName: string,
  ): Promise<boolean> {
    if (!ref || !destPath) return false;

    const refPath = join(sourceFolder, ref);
    const newPath = resolve(destPath);
    const existingData = await this._jsonManagerService.loadFile(
      refPath,
      schema,
    );

    if (!existingData) {
      Logger.error(
        `<System> Clone failed: Reference ${typeName} ${ref} not found.`,
        this._logFile,
      );
      return false;
    }

    const saved = await this._jsonManagerService.saveFile(
      newPath,
      schema,
      existingData,
    );
    if (!saved) {
      Logger.error(
        `<System> Failed to write cloned ${typeName} file: ${destPath}`,
        this._logFile,
      );
      return false;
    }

    return true;
  }

  private async _importEntity(
    ref: string,
    file: string,
    destFolder: string,
    schema: typeof ProfileSchema,
    typeName: string,
  ): Promise<EntityMetadata | null> {
    if (!ref) return null;

    const refPath = resolve(ref);
    const newPath = join(destFolder, file);

    const existingData = await this._jsonManagerService.loadFile(
      refPath,
      schema,
    );
    if (!existingData) {
      Logger.error(
        `<System> Import failed: Reference ${typeName} ${ref} not found.`,
        this._logFile,
      );
      return null;
    }

    // A name the trim made too short would fail the save's validation.
    const trimmed = existingData.name.trim();
    const name = this._freeProfileName(
      trimmed.length < (schema.shape.name.minLength ?? 1)
        ? "Imported profile"
        : trimmed,
    );
    const saved = await this._jsonManagerService.saveFile(newPath, schema, {
      ...existingData,
      name,
    });
    if (!saved) {
      Logger.error(
        `<System> Failed to write imported ${typeName} file: ${newPath}`,
        this._logFile,
      );
      return null;
    }

    return { file, name };
  }

  // `name`, or `name 2` and on when a profile has it, compared as the
  // settings events do: trimmed and in any case.
  private _freeProfileName(name: string): string {
    const taken = new Set(
      this._storeData!.profiles.map((p) => p.name.trim().toLowerCase()),
    );
    let free = name;
    for (let n = 2; taken.has(free.toLowerCase()); n++) free = `${name} ${n}`;
    return free;
  }

  public async addProfile(
    profile: EntityMetadata,
  ): Promise<EntityMetadata | null> {
    return this._addEntity(profile, this._storeData!.profiles);
  }

  // `file` defaults to the active profile's. A service saving the profile it
  // loaded from passes it, so a save racing a switch can't land in the new one.
  public async updateProfileData(
    updates: Partial<Profile>,
    file = this._activeProfileFile(),
  ): Promise<boolean> {
    this._ensureInitialized();
    const res = await this._jsonManagerService.updateFile(
      join(this._pathManagerService.folders.profilesFolder, file),
      ProfileSchema,
      updates,
    );
    if (!res.success || !res.data) return false;
    // A switch while this was writing made another profile active, that's
    // the one to keep in memory.
    if (file === this._activeProfileFile()) this._memoryProfile = res.data;
    return true;
  }

  private async _addEntity(
    entity: EntityMetadata,
    collection: EntityMetadata[],
  ): Promise<EntityMetadata | null> {
    this._ensureInitialized();
    if (!entity) return null;
    if (collection.some((e) => e.file === entity.file)) return entity;

    collection.push(entity);
    if (await this._queueSave()) return entity;
    // Unlisted again, so trying again isn't refused as a taken name.
    collection.splice(collection.indexOf(entity), 1);
    return null;
  }

  private _ensureInitialized() {
    if (!this._storeData)
      throw new Error("StoreManagerService is not initialized.");
  }

  // Saves write the same temporary file, so they run one after another.
  // Tracked while queued too, so a quit doesn't end between two of them.
  private _queueSave() {
    const save = track(
      this._saving.then(() =>
        this._jsonManagerService.saveFile(
          this._storeFilePath,
          StoreZodSchema,
          this._storeData!,
        ),
      ),
    );
    this._saving = save;
    return save;
  }

  // Throws when the store can't be read or copied, so the defaults never
  // replace the only copy of the user's settings.
  private async _backupCorruptedStore() {
    await readFile(this._storeFilePath);
    const name = basename(this._storeFilePath, ".json");
    const corruptedPath = join(
      this._pathManagerService.folders.settingsFolder,
      `${name}.corrupted-${Date.now()}.json`,
    );
    await copyFile(this._storeFilePath, corruptedPath);
    Logger.info(
      `<System> Backed up corrupted store file to ${corruptedPath}`,
      this._logFile,
    );
  }

  private async _encryptProviderKey(
    provider: AppProvider,
  ): Promise<AppProvider> {
    if (!provider.key || !(await safeStorage?.isAsyncEncryptionAvailable())) {
      return provider;
    }
    try {
      const encrypted = await safeStorage.encryptStringAsync(provider.key);
      const key = encrypted.toString("base64");
      this._keys.set(key, provider.key);
      return { ...provider, key };
    } catch {
      return provider;
    }
  }

  // Nothing touches safeStorage without a saved key: on macOS it can ask for
  // the Keychain.
  // shortcut: a key safeStorage asks to re-encrypt (shouldReEncrypt, after the
  // OS rotated its key) keeps the old encryption until it's saved again;
  // re-encrypt it here if old keys stop decrypting.
  private async _decryptKeys(settings: AppSettings) {
    const encrypted = new Set(
      [
        ...settings.providers.connector,
        ...settings.providers.tts,
        settings.activeConnProvider,
        settings.activeTTSProvider,
      ]
        .map((p) => p.key)
        .filter(isEncrypted),
    );
    if (!encrypted.size || !(await safeStorage?.isAsyncEncryptionAvailable())) {
      return;
    }
    await Promise.all(
      [...encrypted].map(async (key) => {
        try {
          const { result } = await safeStorage.decryptStringAsync(
            Buffer.from(key, "base64"),
          );
          this._keys.set(key, result);
        } catch {
          // Left out, so _withKey reads it as ""
        }
      }),
    );
  }

  // The provider with its key decrypted. One that couldn't be (encrypted for
  // another computer or account) is asked for again instead of sending the
  // encrypted text as the key.
  private _withKey(provider: AppProvider): AppProvider {
    if (!isEncrypted(provider.key)) return provider;
    return { ...provider, key: this._keys.get(provider.key) ?? "" };
  }
}
