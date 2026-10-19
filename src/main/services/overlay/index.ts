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
  isLiveEvent,
  OverlayApp,
  OverlayConfigRedux,
  TOKIO_EVENTS,
  TokioPayload,
} from "@/common/types";
import { formatError, generateTikTokEventSample } from "@/common/util";
import Logger from "@/logger";
import { randomUUID } from "node:crypto";
import { access, cp, readdir, rename, rm } from "node:fs/promises";
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
  data?: T;
}

export class OverlayService extends Service {
  private _folder = "";
  private _giftsFile = "";
  private _overlays: OverlayApp[] = [];
  private _yaml: YAMLManagerService;
  private _json: JSONManagerService;
  private _server: ServerService;
  private _store: OverlayStore;
  private _catalog: { overlays: CatalogOverlay[]; time: number } | null = null;
  // Installs in progress, by overlay id
  private _installs = new Map<string, Promise<OverlayResult>>();

  public setLogFile(logFile: string): void {
    this._logFile = logFile;
  }

  public initialize(
    paths: { folder: string; giftsFile: string },
    services: {
      yaml: YAMLManagerService;
      json: JSONManagerService;
      server: ServerService;
      store: OverlayStore;
    },
  ): void {
    this._folder = paths.folder;
    this._giftsFile = paths.giftsFile;
    this._yaml = services.yaml;
    this._json = services.json;
    this._server = services.server;
    this._store = services.store;
  }

  /**
   * Saves the gifts, then checks every installed overlay, writes its saved
   * config into its HTML and serves it. Overlays that fail are forgotten.
   */
  public async load(gifts: CustomGift[]): Promise<void> {
    await this._removeStaging();

    if (this._store.wasRebuilt()) {
      for (const overlay of await findOverlays(this._folder, this._yaml)) {
        await this._store.addOverlayInfo(overlay);
      }
    }

    await this._json.saveArbitraryFile(this._giftsFile, gifts);

    for (const overlay of this._store.getSettings().overlays) {
      const info = await this._writeHTML(overlay.id, overlay.external!, gifts);

      if (!info) {
        Logger.warn(
          `<Overlays> Unable to load overlay ${overlay.id}, it has been removed.`,
          this._logFile,
        );
        await this._store.removeOverlayInfo(overlay.id);
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
   * Copies the overlay in `basedir` into the overlays folder, with its config
   * defaults written into its HTML.
   */
  public async import(
    basedir: string,
    gifts: CustomGift[],
  ): Promise<OverlayResult> {
    const id = randomUUID();
    const dir = this._dir(id);
    try {
      const res = await processOverlay(basedir, this._yaml, true);
      if (!res.success) return { success: false };

      const { config, htmlContent, info } = res.data!;
      // It gets its ID through the block, settings or not.
      if (!hasSetupBlock(htmlContent)) return { success: false };

      await cp(basedir, dir, { recursive: true });

      const html = await processHTML(
        id,
        htmlContent,
        dir,
        "default",
        config,
        gifts,
      );
      if (!html.success) {
        await rm(dir, { recursive: true, force: true });
        return { success: false };
      }

      this._register({ ...info, id, path: dir }, true);
      await this._store.addOverlayInfo({ ...info, id });

      return { success: true };
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
  public async getCatalog(): Promise<OverlayResult<CatalogOverlay[]>> {
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
  public async remove(id: string): Promise<OverlayResult> {
    // Only stored ids, so the renderer's id can't point outside the folder
    if (!this._store.getSettings().overlays.some((o) => o.id === id)) {
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
    await this._store.removeOverlayInfo(id);
    return { success: true };
  }

  // Paths point at the overlay's HTML file.
  public getOverlays(): OverlayApp[] {
    return this._overlays.map((ov) => ({
      ...ov,
      path: join(ov.path, "index.html"),
    }));
  }

  public async getConfig(
    id: string,
  ): Promise<OverlayResult<OverlayConfig | undefined>> {
    const res = await processOverlay(this._dir(id), this._yaml, false);
    return { success: res.success, data: res.data?.config };
  }

  /**
   * Writes the config values into the overlay's HTML and saves the config.
   */
  public async saveConfig(
    id: string,
    config: OverlayConfig,
    gifts: CustomGift[],
  ): Promise<OverlayResult<OverlayConfigRedux>> {
    try {
      const dir = this._dir(id);
      const res = await processOverlay(dir, this._yaml, false);
      if (!res.success) return { success: false };

      const html = await processHTML(
        id,
        res.data!.htmlContent,
        dir,
        "value",
        config,
        gifts,
      );
      if (!html.success) return { success: false };

      const saved = await this._yaml.saveFile(
        res.paths!.config,
        OverlayConfigSchema,
        config,
      );
      if (!saved) return { success: false };

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
    const gifts = await this._json.loadArbitraryFile<CustomGift[]>(
      this._giftsFile,
    );
    return gifts ?? [];
  }

  public send(id: string, payload: TokioPayload): void {
    this._server.sendToClient(id, payload);
  }

  // A sample of every live event, for an overlay's test button. Internal events have no samples.
  public getTestPayloads(): TokioPayload[] {
    return Object.values(TOKIO_EVENTS)
      .filter(isLiveEvent)
      .map((key) => generateTikTokEventSample(key));
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

    await this._store.addTestOverlay({ id: randomUUID(), name: trimmed });
    return { success: true, data: this.getTestOverlays() };
  }

  public async removeTestOverlay(
    id: string,
  ): Promise<OverlayResult<TestOverlay[]>> {
    await this._store.removeTestOverlay(id);
    return { success: true, data: this.getTestOverlays() };
  }

  /**
   * Sends every test payload to the overlay connected with `id`. Fails when
   * no overlay is connected with it.
   */
  public sendTestEvents(id: string): OverlayResult {
    const payloads = this.getTestPayloads();
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

  // Writes the overlay's saved config and the gifts into its HTML.
  private async _writeHTML(
    id: string,
    external: boolean,
    gifts: CustomGift[],
  ): Promise<OverlayMetadata | null> {
    const dir = this._dir(id);
    const res = await processOverlay(dir, this._yaml, external);
    if (!res.success) return null;

    const html = await processHTML(
      id,
      res.data!.htmlContent,
      dir,
      "value",
      res.data!.config,
      gifts,
    );
    return html.success ? res.data!.info : null;
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
    const staging = join(this._folder, `.install-${randomUUID()}`);
    try {
      const info = await this._prepare(entry, staging, update, gifts);
      await this._swap(staging, this._dir(id));
      await this._track({ ...info, id }, update);
      return { success: true };
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
   * Downloads an official overlay into `staging` and makes it ready to serve:
   * checked like an import, with the installed version's settings when it's
   * an update. Throws when it can't.
   */
  private async _prepare(
    entry: CatalogOverlay,
    staging: string,
    update: boolean,
    gifts: CustomGift[],
  ): Promise<OverlayMetadata> {
    await extractZip(await downloadOverlay(entry), staging);

    const res = await processOverlay(staging, this._yaml, false);
    if (!res.success || !hasSetupBlock(res.data!.htmlContent)) {
      throw new Error("The download isn't a valid overlay.");
    }

    let config = res.data!.config;
    const saved = update && config && (await this.getConfig(entry.id)).data;
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
      "value",
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
  ): Promise<void> {
    const app = { ...overlay, path: this._dir(overlay.id) };
    const loaded = this._overlays.findIndex((o) => o.id === overlay.id);
    // An update is already served from its folder, now with the new files.
    if (loaded === -1) this._register(app, true);
    else this._overlays[loaded] = app;

    if (update) await this._store.updateOverlayInfo(overlay);
    else await this._store.addOverlayInfo(overlay);
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
    if (replacing) await rename(dir, old);

    try {
      await rename(staging, dir);
    } catch (error) {
      if (replacing) await rename(old, dir).catch(() => {});
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
