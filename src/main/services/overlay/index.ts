import {
  CatalogOverlay,
  mergeOverlayConfig,
  OverlayConfig,
  OverlayConfigSchema,
  OverlayMetadata,
  TestOverlay,
} from "@/common/schemas";
import {
  CustomGift,
  GiftEvent,
  OverlayApp,
  OverlayConfigRedux,
  TokioPayload,
} from "@/common/types";
import { createTestLive, formatError } from "@/common/util";
import { renameWithRetry } from "@/helper/fs";
import Logger from "@/logger";
import { randomUUID } from "node:crypto";
import { access, cp, lstat, readdir, realpath, rm } from "node:fs/promises";
import { join } from "node:path";
import { JSONManagerService } from "../json";
import { ServerService } from "../server";
import { Service } from "../shared";
import { StoreManagerService } from "../store";
import { YAMLManagerService } from "../yaml";
import {
  findOverlays,
  hasSetupBlock,
  processHTML,
  processOverlay,
} from "./common";
import { downloadOverlay, extractZip, fetchCatalog } from "./common/catalog";

// The parts of the store that keep the overlay lists.
type OverlayStore = Pick<
  StoreManagerService,
  | "wasRebuilt"
  | "getSettings"
  | "addOverlayInfo"
  | "updateOverlayInfo"
  | "removeOverlayInfo"
  | "addTestOverlay"
  | "removeTestOverlay"
>;

// The catalog is read again after this long, so new versions show up while
// Tokio stays open.
export const CATALOG_TTL_MS = 15 * 60 * 1000;

// Folders of installs in progress, inside the overlays folder so they can be
// renamed into place. See installFromCatalog.
const STAGING_FOLDER = /^\.(install|old)-/;

export interface OverlayResult<T = undefined> {
  success: boolean;
  // false when the change was made but the store file wasn't written
  saved?: boolean;
  data?: T;
}

const sameGift = (a: CustomGift, b: CustomGift) =>
  a.value === b.value &&
  a.label === b.label &&
  a.img === b.img &&
  a.coins === b.coins;

export class OverlayService extends Service {
  private _folder = "";
  private _giftsFile = "";
  private _customGiftsFile = "";
  // TikTok's list, kept once read: every gift of a LIVE is checked against it.
  private _gifts: CustomGift[] | null = null;
  // Gifts viewers sent that TikTok's list doesn't have, see recordGift
  private _customGifts: CustomGift[] | null = null;
  // Gift saves run one after another, so one doesn't drop another's gift.
  private _giftSave: Promise<unknown> = Promise.resolve();
  // Custom gifts whose details were already compared since the app started
  private _checkedGifts = new Set<number>();
  // A test LIVE per overlay, so each Test carries on from that overlay's last
  private _testLives = new Map<string, () => TokioPayload[]>();
  private _overlays: OverlayApp[] = [];
  private _yaml: YAMLManagerService;
  private _json: JSONManagerService;
  private _server: ServerService;
  private _store: OverlayStore;
  private _catalog: { overlays: CatalogOverlay[]; time: number } | null = null;
  private _catalogFetch: Promise<OverlayResult<CatalogOverlay[]>> | null = null;
  // Installs in progress, by overlay id
  private _installs = new Map<string, Promise<OverlayResult>>();
  // The last task queued for each overlay's files, see _lock
  private _locks = new Map<string, Promise<unknown>>();

  public setLogFile(logFile: string): void {
    this._logFile = logFile;
  }

  public initialize(
    paths: { folder: string; giftsFile: string; customGiftsFile: string },
    services: {
      yaml: YAMLManagerService;
      json: JSONManagerService;
      server: ServerService;
      store: OverlayStore;
    },
  ): void {
    this._folder = paths.folder;
    this._giftsFile = paths.giftsFile;
    this._customGiftsFile = paths.customGiftsFile;
    this._gifts = null;
    this._customGifts = null;
    this._yaml = services.yaml;
    this._json = services.json;
    this._server = services.server;
    this._store = services.store;
  }

  /**
   * Saves the gifts, then checks every installed overlay, writes its saved
   * config into its HTML and serves it. Overlays that fail stay stored, so a
   * fix keeps their ID and link, unless their folder is gone.
   */
  public async load(gifts: CustomGift[]): Promise<void> {
    await this._removeStaging();

    if (this._store.wasRebuilt()) {
      for (const overlay of await findOverlays(this._folder, this._yaml)) {
        await this._store.addOverlayInfo(overlay);
      }
    }

    await this._json.saveArbitraryFile(this._giftsFile, gifts);
    this._gifts = gifts;

    for (const overlay of this._store.getSettings().overlays) {
      const info = await this._writeHTML(overlay.id, overlay.external!, gifts);

      if (!info) {
        const gone = await access(this._dir(overlay.id)).then(
          () => false,
          () => true,
        );
        Logger.warn(
          `<Overlays> Unable to load overlay ${overlay.id}, ${gone ? "its folder is gone. It has been removed." : "it's kept for the next start."}`,
          this._logFile,
        );
        if (gone) await this._store.removeOverlayInfo(overlay.id);
        continue;
      }

      this._register(
        { ...info, id: overlay.id, path: this._dir(overlay.id) },
        false,
      );
    }
  }

  /**
   * Saves gifts fetched after `load` and writes them into the loaded overlays.
   * Does nothing when they match the saved ones.
   */
  public async refreshGifts(gifts: CustomGift[]): Promise<void> {
    if (JSON.stringify(gifts) === JSON.stringify(await this.getGifts())) return;

    await this._json.saveArbitraryFile(this._giftsFile, gifts);
    this._gifts = gifts;

    const loaded = new Set(this._overlays.map((o) => o.id));
    for (const overlay of this._store.getSettings().overlays) {
      if (!loaded.has(overlay.id)) continue;
      if (!(await this._writeHTML(overlay.id, overlay.external!, gifts))) {
        Logger.warn(
          `<Overlays> Unable to update the gifts of overlay ${overlay.id}.`,
          this._logFile,
        );
      }
    }
  }

  /**
   * Copies the overlay in `basedir` into the overlays folder, with the
   * settings its config.yaml holds written into its HTML.
   */
  public async import(
    basedir: string,
    gifts: CustomGift[],
  ): Promise<OverlayResult> {
    const id = randomUUID();
    const dir = this._dir(id);
    try {
      // A link picked as the folder is copied as the folder it points to.
      const source = await realpath(basedir);
      if (!(await processOverlay(source, this._yaml, true)).success) {
        return { success: false };
      }

      // A link could point anywhere on the computer, and the previews and
      // the server would serve its target.
      await cp(source, dir, {
        recursive: true,
        filter: async (src) => !(await lstat(src)).isSymbolicLink(),
      });

      // Checked on the copy, without its links: an overlay that needs a
      // linked file is refused. It gets its ID through the block, settings
      // or not.
      const res = await processOverlay(dir, this._yaml, true);
      if (!res.success || !hasSetupBlock(res.data!.htmlContent)) {
        await rm(dir, { recursive: true, force: true });
        return { success: false };
      }
      const { config, htmlContent, info } = res.data!;

      const html = await processHTML(id, htmlContent, dir, config, gifts);
      if (!html.success) {
        await rm(dir, { recursive: true, force: true });
        return { success: false };
      }

      this._register({ ...info, id, path: dir }, true);
      const saved = await this._store.addOverlayInfo({ ...info, id });
      return { success: true, saved };
    } catch (error) {
      Logger.error(
        `<Overlays> Unable to import overlay from ${basedir} -- ${formatError(error)}`,
        this._logFile,
        error,
      );
      await rm(dir, { recursive: true, force: true }).catch(() => {});
      return { success: false };
    }
  }

  /**
   * The official overlays, from the catalog of tokio-app/overlays. It's read
   * again after CATALOG_TTL_MS, and a failure isn't kept, so the next call
   * tries again.
   */
  public getCatalog(): Promise<OverlayResult<CatalogOverlay[]>> {
    // Pages opening together share one read.
    this._catalogFetch ??= this._fetchCatalog().finally(
      () => (this._catalogFetch = null),
    );
    return this._catalogFetch;
  }

  private async _fetchCatalog(): Promise<OverlayResult<CatalogOverlay[]>> {
    if (this._catalog && Date.now() - this._catalog.time < CATALOG_TTL_MS) {
      return { success: true, data: this._catalog.overlays };
    }

    try {
      const { overlays, dropped } = await fetchCatalog();
      if (dropped.length > 0) {
        Logger.warn(
          `<Overlays> Skipped catalog entries that can't be read: ${dropped.join(", ")}`,
          this._logFile,
        );
      }
      this._catalog = { overlays, time: Date.now() };
      return { success: true, data: overlays };
    } catch (error) {
      // Usually just offline.
      Logger.warn(
        `<Overlays> Unable to read the overlay catalog -- ${formatError(error)}`,
        this._logFile,
      );
      return { success: false };
    }
  }

  /**
   * Installs the catalog's version of an official overlay, or updates the
   * installed one, keeping the saved settings that still apply. It's served
   * under its catalog id, so its URL never changes.
   */
  public installFromCatalog(
    id: string,
    gifts: CustomGift[],
  ): Promise<OverlayResult> {
    // A second request for the same overlay gets the first one's result.
    let install = this._installs.get(id);
    if (!install) {
      install = this._installFromCatalog(id, gifts).finally(() =>
        this._installs.delete(id),
      );
      this._installs.set(id, install);
    }
    return install;
  }

  /**
   * Deletes an installed overlay, official or imported, with its settings and
   * stops serving it.
   */
  public remove(id: string): Promise<OverlayResult> {
    return this._lock(id, () => this._remove(id));
  }

  private async _remove(id: string): Promise<OverlayResult> {
    if (!this._isStored(id)) {
      Logger.warn(
        `<Overlays> Unable to remove overlay ${id}, it isn't installed.`,
        this._logFile,
      );
      return { success: false };
    }

    try {
      await rm(this._dir(id), { recursive: true, force: true });
    } catch (error) {
      Logger.error(
        `<Overlays> Unable to remove overlay ${id} -- ${formatError(error)}`,
        this._logFile,
        error,
      );
      return { success: false };
    }

    this._server.unmount(id);
    this._overlays = this._overlays.filter((o) => o.id !== id);
    return { success: true, saved: await this._store.removeOverlayInfo(id) };
  }

  // Only stored ids, so the renderer's id can't point outside the folder.
  // It doesn't log: the callers do.
  private _isStored(id: string) {
    return this._store.getSettings().overlays.some((o) => o.id === id);
  }

  // Paths point at the overlay's HTML file.
  public getOverlays(): OverlayApp[] {
    return this._overlays.map((ov) => ({
      ...ov,
      path: join(ov.path, "index.html"),
    }));
  }

  public getConfig(
    id: string,
  ): Promise<OverlayResult<OverlayConfig | undefined>> {
    return this._lock(id, async () =>
      this._isStored(id) ? this._readConfig(id) : { success: false },
    );
  }

  private async _readConfig(
    id: string,
  ): Promise<OverlayResult<OverlayConfig | undefined>> {
    const res = await processOverlay(this._dir(id), this._yaml, false);
    return { success: res.success, data: res.data?.config };
  }

  /**
   * Writes the config values into the overlay's HTML and saves the config.
   */
  public saveConfig(
    id: string,
    config: OverlayConfig,
    gifts: CustomGift[],
  ): Promise<OverlayResult<OverlayConfigRedux>> {
    return this._lock(id, () => this._saveConfig(id, config, gifts));
  }

  private async _saveConfig(
    id: string,
    config: OverlayConfig,
    gifts: CustomGift[],
  ): Promise<OverlayResult<OverlayConfigRedux>> {
    if (!this._isStored(id)) return { success: false };
    try {
      const dir = this._dir(id);
      const res = await processOverlay(dir, this._yaml, false);
      if (!res.success) return { success: false };
      // A dialog opened before an update has the old version's fields.
      const merged = res.data!.config
        ? mergeOverlayConfig(res.data!.config, config)
        : config;

      // First, so settings the schema refuses never reach the HTML.
      const saved = await this._yaml.saveFile(
        res.paths!.config,
        OverlayConfigSchema,
        merged,
      );
      if (!saved) return { success: false };

      const html = await processHTML(
        id,
        res.data!.htmlContent,
        dir,
        merged,
        gifts,
      );
      if (!html.success) return { success: false };

      return { success: true, data: html.parsed };
    } catch (error) {
      Logger.error(
        `<Overlays> Unable to save the config of overlay ${id} -- ${formatError(error)}`,
        this._logFile,
        error,
      );
      return { success: false };
    }
  }

  public async getGifts(): Promise<CustomGift[]> {
    if (!this._gifts) {
      const saved = await this._json.loadArbitraryFile<CustomGift[]>(
        this._giftsFile,
      );
      // A load that finished meanwhile has the newer list.
      this._gifts ??= saved ?? [];
    }
    return this._gifts;
  }

  // Shared by all profiles, unlike emotes: a gift is the same in every LIVE.
  public async getCustomGifts(): Promise<CustomGift[]> {
    if (!this._customGifts) {
      const saved = await this._json.loadArbitraryFile<CustomGift[]>(
        this._customGiftsFile,
      );
      this._customGifts ??= saved ?? [];
    }
    return this._customGifts;
  }

  /**
   * Saves a gift a viewer sent when TikTok's list doesn't have it. data is
   * the new list of custom gifts, only set when it changed.
   */
  public recordGift(
    gift: GiftEvent["gift"],
  ): Promise<OverlayResult<CustomGift[]>> {
    const save = this._giftSave.then(() => this._recordGift(gift));
    this._giftSave = save.catch(() => {});
    return save;
  }

  private async _recordGift(
    gift: GiftEvent["gift"],
  ): Promise<OverlayResult<CustomGift[]>> {
    const value = Number(gift.id);
    // Nothing the picker could show
    if (!Number.isInteger(value) || value <= 0 || !gift.name) {
      return { success: true };
    }

    // An empty list was never fetched, so every gift would look missing.
    const listed = await this.getGifts();
    if (listed.length === 0 || listed.some((g) => g.value === value)) {
      return { success: true };
    }

    const entry: CustomGift = {
      value,
      label: gift.name,
      img: gift.image,
      coins: gift.coins,
    };
    const saved = [...(await this.getCustomGifts())];
    const index = saved.findIndex((g) => g.value === value);
    let changed = false;
    if (index === -1) {
      saved.push(entry);
      changed = true;
    } else if (
      !this._checkedGifts.has(value) &&
      !sameGift(saved[index], entry)
    ) {
      // Once per run, in case TikTok renames it or moves its image.
      saved[index] = entry;
      changed = true;
    }
    this._checkedGifts.add(value);

    if (!changed) return { success: true };
    if (!(await this._json.saveArbitraryFile(this._customGiftsFile, saved))) {
      return { success: false };
    }
    this._customGifts = saved;
    return { success: true, data: saved };
  }

  public send(id: string, payload: TokioPayload): void {
    this._server.sendToClient(id, payload);
  }

  // Every live event, as the next moment of the overlay's test LIVE, for its test button.
  public getTestPayloads(id: string): TokioPayload[] {
    let live = this._testLives.get(id);
    if (!live) this._testLives.set(id, (live = createTestLive()));
    return live();
  }

  // IDs for overlays tested without importing them, see the Tools page.
  public getTestOverlays(): TestOverlay[] {
    return this._store.getSettings().testOverlays;
  }

  public async createTestOverlay(
    name: string,
  ): Promise<OverlayResult<TestOverlay[]>> {
    const trimmed = name.trim();
    if (!trimmed) return { success: false };

    const saved = await this._store.addTestOverlay({
      id: randomUUID(),
      name: trimmed,
    });
    return { success: true, saved, data: this.getTestOverlays() };
  }

  public async removeTestOverlay(
    id: string,
  ): Promise<OverlayResult<TestOverlay[]>> {
    const saved = await this._store.removeTestOverlay(id);
    return { success: true, saved, data: this.getTestOverlays() };
  }

  /**
   * Sends every test payload to the overlay connected with `id`. Fails when
   * no overlay is connected with it.
   */
  public sendTestEvents(id: string): OverlayResult {
    const payloads = this.getTestPayloads(id);
    const sent = payloads.every((payload) =>
      this._server.sendToClient(id, payload),
    );
    if (!sent) {
      Logger.info(
        `<Overlays> No overlay connected with id ${id} to send test events to.`,
        this._logFile,
      );
    }
    return { success: sent };
  }

  /**
   * Runs the tasks on one overlay's files one after another, so a write never
   * puts back settings read before another's save. A task must not call a
   * method that takes the lock, or it waits on itself.
   */
  private _lock<T>(id: string, task: () => Promise<T>): Promise<T> {
    const run = (this._locks.get(id) ?? Promise.resolve())
      .catch(() => {})
      .then(task);
    this._locks.set(id, run);
    const idle = () => {
      if (this._locks.get(id) === run) this._locks.delete(id);
    };
    run.then(idle, idle);
    return run;
  }

  // Writes the overlay's saved config and the gifts into its HTML.
  private _writeHTML(
    id: string,
    external: boolean,
    gifts: CustomGift[],
  ): Promise<OverlayMetadata | null> {
    return this._lock(id, async () => {
      const dir = this._dir(id);
      const res = await processOverlay(dir, this._yaml, external);
      if (!res.success) return null;

      const html = await processHTML(
        id,
        res.data!.htmlContent,
        dir,
        res.data!.config,
        gifts,
      );
      return html.success ? res.data!.info : null;
    });
  }

  private async _installFromCatalog(
    id: string,
    gifts: CustomGift[],
  ): Promise<OverlayResult> {
    const catalog = await this.getCatalog();
    const entry = catalog.data?.find((o) => o.id === id);
    if (!entry) {
      // getCatalog logged why it has no catalog.
      if (catalog.success) {
        Logger.warn(
          `<Overlays> Unable to install overlay ${id}, it isn't in the catalog.`,
          this._logFile,
        );
      }
      return { success: false };
    }

    const staging = join(this._folder, `.install-${randomUUID()}`);
    try {
      // Outside the lock, so a slow download doesn't hold up saves.
      const zip = await downloadOverlay(entry);
      return await this._lock(id, async () => {
        const installed = this._store
          .getSettings()
          .overlays.find((o) => o.id === id);
        if (installed?.external) {
          Logger.warn(
            `<Overlays> Unable to install overlay ${id}, an imported overlay has its id.`,
            this._logFile,
          );
          return { success: false };
        }

        const update = installed !== undefined;
        const info = await this._prepare(entry, zip, staging, update, gifts);
        await this._swap(staging, this._dir(id));
        return {
          success: true,
          saved: await this._track({ ...info, id }, update),
        };
      });
    } catch (error) {
      Logger.error(
        `<Overlays> Unable to install overlay ${id} -- ${formatError(error)}`,
        this._logFile,
        error,
      );
      await rm(staging, { recursive: true, force: true }).catch(() => {});
      return { success: false };
    }
  }

  /**
   * Extracts an official overlay's zip into `staging` and makes it ready to
   * serve: checked like an import, with the installed version's settings when
   * it's an update. Throws when it can't. Runs inside the overlay's lock.
   */
  private async _prepare(
    entry: CatalogOverlay,
    zip: Uint8Array,
    staging: string,
    update: boolean,
    gifts: CustomGift[],
  ): Promise<OverlayMetadata> {
    await extractZip(zip, staging);

    const res = await processOverlay(staging, this._yaml, false);
    if (!res.success || !hasSetupBlock(res.data!.htmlContent)) {
      throw new Error("The download isn't a valid overlay.");
    }

    let config = res.data!.config;
    const saved = update && config && (await this._readConfig(entry.id)).data;
    if (config && saved) {
      config = mergeOverlayConfig(config, saved);
      const kept = await this._yaml.saveFile(
        res.paths!.config,
        OverlayConfigSchema,
        config,
      );
      if (!kept) throw new Error("Unable to keep its settings.");
    }

    const html = await processHTML(
      entry.id,
      res.data!.htmlContent,
      staging,
      config,
      gifts,
    );
    if (!html.success) throw new Error("Unable to write its HTML.");
    return { ...res.data!.info, external: false };
  }

  // Serves an installed official overlay and saves it in the store.
  private async _track(
    overlay: OverlayMetadata & { id: string },
    update: boolean,
  ): Promise<boolean> {
    const app = { ...overlay, path: this._dir(overlay.id) };
    const loaded = this._overlays.findIndex((o) => o.id === overlay.id);
    // An update is already served from its folder, now with the new files.
    if (loaded === -1) this._register(app, true);
    else this._overlays[loaded] = app;

    return update
      ? this._store.updateOverlayInfo(overlay)
      : this._store.addOverlayInfo(overlay);
  }

  /**
   * Puts a prepared overlay in place of the installed one, if any. Both are
   * renamed within the overlays folder, so the old version stays whole until
   * the new one is in place.
   */
  private async _swap(staging: string, dir: string): Promise<void> {
    const old = join(this._folder, `.old-${randomUUID()}`);
    const replacing = await access(dir).then(
      () => true,
      () => false,
    );
    if (replacing) await renameWithRetry(dir, old);

    try {
      await renameWithRetry(staging, dir);
    } catch (error) {
      if (replacing) {
        // The next start deletes .old-* folders, so say where it was left.
        await renameWithRetry(old, dir).catch((undo) =>
          Logger.error(
            `<Overlays> Unable to put back ${dir}, the installed version is in ${old} -- ${formatError(undo)}`,
            this._logFile,
            undo,
          ),
        );
      }
      throw error;
    }

    if (replacing) {
      await rm(old, { recursive: true, force: true }).catch(() => {});
    }
  }

  // Folders left by an install that was cut short.
  private async _removeStaging(): Promise<void> {
    const entries = await readdir(this._folder, { withFileTypes: true }).catch(
      () => [],
    );
    for (const entry of entries) {
      if (!entry.isDirectory() || !STAGING_FOLDER.test(entry.name)) continue;
      await rm(join(this._folder, entry.name), {
        recursive: true,
        force: true,
      }).catch(() => {});
    }
  }

  private _register(overlay: OverlayApp, rebuild: boolean): void {
    this._overlays.push(overlay);
    this._server.mount(overlay.id, overlay.path, rebuild);
  }

  private _dir(id: string): string {
    return join(this._folder, id);
  }
}
