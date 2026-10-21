import {
  ActivityFeed,
  AlertSound,
  AppProvider,
  AppSettings,
  EntityMetadata,
  OverlayMetadata,
  Profile,
  ProfileSchema,
  SavedEmote,
  StoreSchema,
  StoreZodSchema,
  TestOverlay,
} from "@/common/schemas";
import { Emotes } from "@/common/types";
import { defaultProfile, formatError } from "@/common/util";
import { defaultStoreData } from "@/common/util/constants/store";
import { cleanText } from "@/helper/chat";
import { isInside } from "@/helper/path";
import Logger from "@/logger";
import { AUDIO_EXTENSIONS } from "@/services/alerts";
import { TikTokConnectorService } from "@/services/connector";
import { JSONManagerService } from "@/services/json";
import { PathManagerService } from "@/services/path";
import { TTSService } from "@/services/tts";
import { safeStorage } from "electron";
import { access, copyFile, readdir, readFile } from "fs/promises";
import { randomUUID } from "node:crypto";
import { basename, extname, join, resolve } from "path";
import { Service } from "../shared";

type Providers = {
  tts: TTSService;
  connector: TikTokConnectorService;
};

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
        data.settings.sounds = await this._findSounds(
          profiles.map(({ profile }) => profile),
        );
        this._rebuilt = true;
        await this._jsonManagerService.saveFile(
          this._storeFilePath,
          StoreZodSchema,
          data,
        );
      } else {
        const conn_p = this._decryptProviderKey(
          data.settings.activeConnProvider,
        );
        this._providers.connector.setProvider(conn_p.name, conn_p.key);
        // Speaks the voices saved before the engines were combined.
        this._providers.tts.setProvider(data.settings.activeTTSProvider.name);
        for (const saved of data.settings.providers.tts) {
          const { name, key } = this._decryptProviderKey(saved);
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

  // Alerts keep the names of the sounds they use. Files no alert uses lost
  // their name, they're listed anyway so they can be played or deleted.
  private async _findSounds(profiles: Profile[]): Promise<AlertSound[]> {
    const folder = this._pathManagerService.folders.soundsFolder;
    const files = new Set(
      (await readdir(folder).catch(() => []))
        .filter((file) => AUDIO_EXTENSIONS.includes(extname(file).slice(1)))
        .sort(),
    );

    const sounds = new Map<string, AlertSound>();
    for (const profile of profiles) {
      for (const { sound } of profile.alerts.items) {
        if (sound && files.has(sound.file) && !sounds.has(sound.file)) {
          sounds.set(sound.file, sound);
        }
      }
    }

    let unnamed = 0;
    for (const file of files) {
      if (!sounds.has(file)) {
        sounds.set(file, { name: `Recovered sound ${++unnamed}`, file });
      }
    }

    return [...sounds.values()];
  }

  public getSettings(): AppSettings {
    this._ensureInitialized();

    const clonedSettings = structuredClone(this._storeData!.settings);

    clonedSettings.providers = {
      connector: this._withRegisteredProviders(
        clonedSettings.providers.connector.map((p) =>
          this._decryptProviderKey(p),
        ),
        this._providers.connector,
      ),
      tts: this._withRegisteredProviders(
        clonedSettings.providers.tts.map((p) => this._decryptProviderKey(p)),
        this._providers.tts,
      ),
    };

    clonedSettings.activeConnProvider = this._decryptProviderKey(
      clonedSettings.activeConnProvider,
    );
    clonedSettings.activeTTSProvider = this._decryptProviderKey(
      clonedSettings.activeTTSProvider,
    );

    return clonedSettings;
  }

  // Registered providers that were never saved still need to be selectable.
  private _withRegisteredProviders(
    saved: AppProvider[],
    service: { getProviders(): { name: string }[] },
  ): AppProvider[] {
    const missing = service
      .getProviders()
      .filter(({ name }) => !saved.some((p) => p.name === name))
      .map(({ name }) => ({ name, key: "", active: false }));
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

  public async addSound(sound: AlertSound): Promise<boolean> {
    this._ensureInitialized();
    const sounds = this._storeData!.settings.sounds;
    // Files are named by content, so the same file means the same sound.
    if (sounds.some((s) => s.file === sound.file)) return true;
    sounds.push(sound);
    return this._queueSave();
  }

  public async removeSound(file: string): Promise<boolean> {
    this._ensureInitialized();
    this._storeData!.settings.sounds = this._storeData!.settings.sounds.filter(
      (s) => s.file !== file,
    );
    return this._queueSave();
  }

  /**
   * Whether an alert in any profile plays this sound file.
   */
  public async isSoundInUse(file: string): Promise<boolean> {
    this._ensureInitialized();
    for (const { file: profileFile } of this.getProfiles()) {
      const profile = await this._jsonManagerService.loadFile(
        join(this._pathManagerService.folders.profilesFolder, profileFile),
        ProfileSchema,
      );
      if (profile?.alerts.items.some((a) => a.sound?.file === file)) {
        return true;
      }
    }
    return false;
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

    const provider = this._encryptProviderKey({
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
    return saved ? this._decryptProviderKey(saved).key : "";
  }

  // Keys are saved with the provider list, encrypted.
  public async updateVoiceKey(engine: string, key: string): Promise<boolean> {
    this._ensureInitialized();
    const list = this._storeData!.settings.providers.tts;
    const index = list.findIndex((p) => p.name === engine);
    const saved = this._encryptProviderKey({
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

  public async createNewProfile(
    fileName: string,
    profileName: string,
  ): Promise<EntityMetadata | null> {
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

    return await this.addProfile({ file: fileName, name: profileName });
  }

  public async cloneProfile(
    referenceFileName: string,
    newFileName: string,
    newProfileName: string,
  ): Promise<EntityMetadata | null> {
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

    return await this.addProfile({ file: newFileName, name: newProfileName });
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

  // Under the name of its file, or a free one when a profile has it.
  public async importProfile(ref: string): Promise<boolean> {
    this._ensureInitialized();
    if (!ref) return false;
    const file = await this._freeProfileFile(basename(ref, extname(ref)));
    const result = await this._importEntity(
      ref,
      file,
      this._pathManagerService.folders.profilesFolder,
      ProfileSchema,
      "profile",
    );
    if (!result) return false;
    return (await this.addProfile(result)) !== null;
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
    schema: any,
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

    const saved = await this._jsonManagerService.saveFile(
      newPath,
      schema,
      existingData,
    );
    if (!saved) {
      Logger.error(
        `<System> Failed to write imported ${typeName} file: ${newPath}`,
        this._logFile,
      );
      return null;
    }

    const name = cleanText(file.split(".")[0]).replace(/[_.-]/g, " ");
    return { file, name };
  }

  public async addProfile(
    profile: EntityMetadata,
  ): Promise<EntityMetadata | null> {
    return this._addEntity(profile, this._storeData!.profiles);
  }

  public async updateProfileData(updates: Partial<Profile>): Promise<boolean> {
    this._ensureInitialized();
    const file = this._activeProfileFile();
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
  private _queueSave() {
    const save = this._saving.then(() =>
      this._jsonManagerService.saveFile(
        this._storeFilePath,
        StoreZodSchema,
        this._storeData!,
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

  private _encryptProviderKey(provider: AppProvider): AppProvider {
    if (!provider.key || !safeStorage?.isEncryptionAvailable()) return provider;
    try {
      const encryptedBuffer = safeStorage.encryptString(provider.key);
      return { ...provider, key: encryptedBuffer.toString("base64") };
    } catch {
      return provider;
    }
  }

  private _decryptProviderKey(provider: AppProvider): AppProvider {
    // safeStorage output starts with v10/v11 ("djEw"/"djEx" in base64).
    // Anything else was saved while encryption was unavailable, as plain text.
    if (!/^djE[wx]/.test(provider.key)) return provider;
    if (!safeStorage?.isEncryptionAvailable()) return { ...provider, key: "" };
    try {
      const buffer = Buffer.from(provider.key, "base64");
      return { ...provider, key: safeStorage.decryptString(buffer) };
    } catch {
      // Encrypted for another computer or account: asked for again instead
      // of sending the encrypted text as the key.
      return { ...provider, key: "" };
    }
  }
}
