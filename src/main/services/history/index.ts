import {
  Gifter,
  LiveHistory,
  LiveRecord,
  LiveSummary,
  RankedGifter,
  TOKIO_EVENTS,
  TokioEventMap,
  TopGifter,
} from "@/common/types";
import { formatError } from "@/common/util";
import { renameWithRetry } from "@/helper/fs";
import { GiftStreaks } from "@/helper/streaks";
import Logger from "@/logger";
import { access, mkdir, readdir, rm } from "node:fs/promises";
import { join, parse } from "node:path";
import { z } from "zod";
import type { JSONManagerService } from "../json";
import { Service } from "../shared";

// The live events a LIVE's record counts
export const HISTORY_EVENTS = [
  TOKIO_EVENTS.GIFT,
  TOKIO_EVENTS.FOLLOW,
  TOKIO_EVENTS.SHARE,
  TOKIO_EVENTS.LIKE,
  TOKIO_EVENTS.ROOM_USER,
] as const;

export type HistoryEvent = (typeof HISTORY_EVENTS)[number];

// All time keeps this many gifters, the fewest coins dropped first
export const MAX_GIFTERS = 10_000;
// Overlays get this many of each list
export const TOP_GIFTERS = 10;
// The LIVEs page gets this many of all time's
export const SHOWN_GIFTERS = 100;

const GifterSchema: z.ZodType<Gifter> = z.object({
  userId: z.string(),
  username: z.string(),
  handle: z.string(),
  picture: z.string(),
  coins: z.number(),
  gifts: z.number(),
  giftedAt: z.number(),
});

const LiveSummarySchema = z.object({
  username: z.string(),
  startedAt: z.number(),
  endedAt: z.number(),
  coins: z.number(),
  gifts: z.number(),
  followers: z.number(),
  shares: z.number(),
  likes: z.number(),
  views: z.number(),
  peakViewers: z.number(),
}) satisfies z.ZodType<LiveSummary>;

const LiveRecordSchema: z.ZodType<LiveRecord> = LiveSummarySchema.extend({
  gifters: z.array(GifterSchema),
});

// The LIVEs oldest first, and all time's gifters the most coins first
const IndexSchema = z.object({
  lives: z.array(LiveSummarySchema),
  gifters: z.array(GifterSchema),
});

type Index = z.infer<typeof IndexSchema>;

type Json = Pick<JSONManagerService, "loadFile" | "saveFile">;

// What each event does to the LIVE in progress, true when it changes it
type Recorders = {
  [K in HistoryEvent]: (live: LiveSummary, data: TokioEventMap[K]) => boolean;
};

// The most coins first, ties to whoever got there first
const byCoins = (a: Gifter, b: Gifter) =>
  b.coins - a.coins || a.giftedAt - b.giftedAt;

const LIVE_FILE = /^(\d+)\.json$/;

/**
 * Each profile's LIVEs and the viewers who sent gifts in them, in
 * history/<profile name>/: index.json with the finished LIVEs' summaries and
 * all time's gifters, and a <startedAt>.json per LIVE with all its gifters.
 */
export class HistoryService extends Service {
  private _json: Json | null = null;
  private _folder = "";
  // The profile's folder, null until one loads: nothing is recorded then
  private _dir: string | null = null;
  // The folder the latest load reads, so an earlier one that ends later is dropped
  private _loading = "";
  // Oldest first
  private _lives: LiveSummary[] = [];
  // All time, by user id, kept in byCoins order
  private _gifters = new Map<string, Gifter>();
  // All time's top TOP_GIFTERS, so top() never sorts all of it
  private _best: Gifter[] = [];
  private _live: LiveSummary | null = null;
  private _liveGifters = new Map<string, Gifter>();
  private _streaks = new GiftStreaks();
  // Final records of LIVEs that ended, until their file is written
  private _ended: LiveRecord[] = [];
  private _liveUnsaved = false;
  private _indexUnsaved = false;
  private _saving: Promise<boolean> = Promise.resolve(true);
  private _listeners: (() => void)[] = [];

  private readonly _recorders: Recorders = {
    [TOKIO_EVENTS.GIFT]: (live, event) => {
      const { added } = this._streaks.add(event);
      if (added <= 0) return false;
      const { user, gift } = event;
      const coins = added * Math.max(0, gift.coins);
      live.gifts += added;
      live.coins += coins;
      if (user.userId) {
        const last = this._liveGifters.get(user.userId);
        this._liveGifters.set(user.userId, {
          userId: user.userId,
          username: user.username,
          handle: user.handle,
          picture: user.profilePictures[0] || (last?.picture ?? ""),
          coins: (last?.coins ?? 0) + coins,
          gifts: (last?.gifts ?? 0) + added,
          giftedAt: Date.now(),
        });
      }
      this._emit();
      return true;
    },
    [TOKIO_EVENTS.FOLLOW]: (live) => {
      live.followers++;
      return true;
    },
    [TOKIO_EVENTS.SHARE]: (live) => {
      live.shares++;
      return true;
    },
    [TOKIO_EVENTS.LIKE]: (live, { totalLikes }) => {
      if (totalLikes <= live.likes) return false;
      live.likes = totalLikes;
      return true;
    },
    [TOKIO_EVENTS.ROOM_USER]: (live, { views, viewers }) => {
      const changed = views > live.views || viewers > live.peakViewers;
      live.views = Math.max(live.views, views);
      live.peakViewers = Math.max(live.peakViewers, viewers);
      return changed;
    },
  };

  public initialize({ json, folder }: { json: Json; folder: string }) {
    this._json = json;
    this._folder = folder;
  }

  /** Loads a profile's history, adding a LIVE that a quit or a crash left. */
  public async load(profileFile: string): Promise<void> {
    const { name } = parse(profileFile);
    const dir = join(this._folder, name);
    this._loading = dir;
    this._dir = null;
    this._lives = [];
    this._gifters = new Map();
    this._best = [];
    this._live = null;
    this._liveGifters = new Map();
    this._streaks.clear();
    this._ended = [];
    this._liveUnsaved = false;
    this._indexUnsaved = false;

    await this._removeCleared(name);
    const index = await this._readIndex(dir);
    if (this._loading !== dir) return;
    if (!index) {
      Logger.warn(
        `<History> Not recording LIVEs, ${join(dir, "index.json")} didn't load`,
        this._logFile,
      );
      this._emit();
      return;
    }

    const lives = index.lives;
    const newest = lives.at(-1)?.startedAt ?? -Infinity;
    const listed = new Set(lives.map((live) => live.startedAt));
    const left: number[] = [];
    for (const file of await readdir(dir).catch(() => [])) {
      const startedAt = Number(LIVE_FILE.exec(file)?.[1] ?? NaN);
      if (Number.isNaN(startedAt) || listed.has(startedAt)) continue;
      // Newer than every listed LIVE, a quit or a crash left it. Older, a
      // delete did.
      if (startedAt > newest) left.push(startedAt);
      else await this._remove(join(dir, file));
    }
    const recovered: LiveRecord[] = [];
    for (const startedAt of left.sort((a, b) => a - b)) {
      const record = await this._readLive(dir, startedAt);
      if (record) recovered.push(record);
    }
    if (this._loading !== dir) return;

    this._dir = dir;
    this._lives = lives;
    this._gifters = new Map(index.gifters.map((g) => [g.userId, g]));
    for (const record of recovered) this._finish(record);
    this._rank();
    this._emit();
    if (!recovered.length) return;
    Logger.info(
      `<History> Added ${recovered.length} LIVE(s) left in ${dir}`,
      this._logFile,
    );
    this._indexUnsaved = true;
    await this.save();
  }

  /** Starts a LIVE on @username, ending one still open first. */
  public start(username: string, now = Date.now()) {
    if (this._dir === null) return;
    this.end(now);
    this._live = {
      username,
      startedAt: now,
      endedAt: now,
      coins: 0,
      gifts: 0,
      followers: 0,
      shares: 0,
      likes: 0,
      views: 0,
      peakViewers: 0,
    };
    this._liveGifters = new Map();
    this._streaks.clear();
    this._liveUnsaved = true;
    this._emit();
  }

  public record<K extends HistoryEvent>(type: K, data: TokioEventMap[K]) {
    if (!this._live) return;
    if (this._recorders[type](this._live, data)) this._liveUnsaved = true;
  }

  /** Ends the LIVE in progress, whose gifters join all time. */
  public end(now = Date.now()) {
    const live = this._live;
    if (!live) return;
    const record = this._record(live, now);
    this._ended.push(record);
    this._finish(record);
    this._rank();
    this._live = null;
    this._liveGifters = new Map();
    this._streaks.clear();
    this._liveUnsaved = false;
    this._indexUnsaved = true;
    this._emit();
  }

  /** The top 10s overlays get, with both numbers on everyone. */
  public top(): { live: TopGifter[]; allTime: TopGifter[] } {
    const live = [...this._liveGifters.values()];
    const past = this._best.filter((g) => !this._liveGifters.has(g.userId));
    return {
      live: live
        .sort(byCoins)
        .slice(0, TOP_GIFTERS)
        .map((g) => this._toTop(g)),
      allTime: [...live, ...past]
        .map((g) => this._toTop(g))
        .sort(
          (a, b) =>
            b.allTime.coins - a.allTime.coins || a.giftedAt - b.giftedAt,
        )
        .slice(0, TOP_GIFTERS),
    };
  }

  /** The finished LIVEs, newest first, and all time's top gifters. */
  public getHistory(): LiveHistory {
    return {
      lives: [...this._lives].reverse(),
      gifters: [...this._gifters.values()].slice(0, SHOWN_GIFTERS),
    };
  }

  /** A finished LIVE with its gifters, null when it isn't kept or unreadable. */
  public async getLive(startedAt: number): Promise<LiveRecord | null> {
    const dir = this._dir;
    if (dir === null || !this._lives.some((l) => l.startedAt === startedAt))
      return null;
    return this._readLive(dir, startedAt);
  }

  /**
   * The top SHOWN_GIFTERS of the finished LIVEs that started from `from`
   * (included) to `to` (left out), each with their place among them, and with
   * a query only the ones whose name or @handle has it. A range of every LIVE
   * is all time's list; others are added up from their files, leaving out a
   * file that doesn't load.
   */
  public async getGifters({
    from = -Infinity,
    to = Infinity,
    query = "",
  }: {
    from?: number;
    to?: number;
    query?: string;
  }): Promise<RankedGifter[]> {
    const dir = this._dir;
    if (dir === null) return [];
    const lives = this._lives.filter(
      ({ startedAt }) => startedAt >= from && startedAt < to,
    );
    // Kept in byCoins order, and read from no file
    let ranked = [...this._gifters.values()];
    if (lives.length < this._lives.length) {
      const records = await Promise.all(
        lives.map(({ startedAt }) => this._readLive(dir, startedAt)),
      );
      if (this._dir !== dir) return [];
      const gifters = new Map<string, Gifter>();
      // Oldest first, so the name, handle and picture end up the latest ones
      for (const gifter of records.flatMap((r) => r?.gifters ?? [])) {
        const past = gifters.get(gifter.userId);
        gifters.set(gifter.userId, {
          ...gifter,
          picture: gifter.picture || (past?.picture ?? ""),
          coins: (past?.coins ?? 0) + gifter.coins,
          gifts: (past?.gifts ?? 0) + gifter.gifts,
        });
      }
      ranked = [...gifters.values()].sort(byCoins);
    }

    // "@kai" finds kai too
    const needle = query.trim().replace(/^@/, "").toLocaleLowerCase();
    const found: RankedGifter[] = [];
    for (const [i, gifter] of ranked.entries()) {
      if (found.length === SHOWN_GIFTERS) break;
      const named =
        gifter.username.toLocaleLowerCase().includes(needle) ||
        gifter.handle.toLocaleLowerCase().includes(needle);
      if (named) found.push({ ...gifter, rank: i + 1 });
    }
    return found;
  }

  /**
   * False when the index couldn't be saved: the LIVE is gone from memory, and
   * the next save tries again.
   */
  public async deleteLive(startedAt: number): Promise<boolean> {
    const dir = this._dir;
    if (dir === null || !this._lives.some((l) => l.startedAt === startedAt))
      return true;
    const file = join(dir, `${startedAt}.json`);
    const record = await this._readLive(dir, startedAt);
    if (this._dir !== dir) return true;

    if (record) {
      for (const { userId, coins, gifts } of record.gifters) {
        // Gone when the cap dropped them
        const gifter = this._gifters.get(userId);
        if (!gifter) continue;
        const left = {
          ...gifter,
          coins: gifter.coins - coins,
          gifts: gifter.gifts - gifts,
        };
        if (left.coins <= 0 && left.gifts <= 0) this._gifters.delete(userId);
        else this._gifters.set(userId, left);
      }
    } else {
      Logger.warn(
        `<History> Deleting LIVE ${file}, all time keeps its gifts`,
        this._logFile,
      );
    }
    this._lives = this._lives.filter((l) => l.startedAt !== startedAt);
    this._ended = this._ended.filter((r) => r.startedAt !== startedAt);
    this._rank();
    this._indexUnsaved = true;
    this._emit();
    const saved = await this.save();
    await this._remove(file);
    return saved;
  }

  /**
   * False, changing nothing, when no history is loaded (an index that doesn't
   * load stays as it is) or it couldn't be moved away.
   */
  public async clear(): Promise<boolean> {
    await this._saving;
    const dir = this._dir;
    if (dir === null) return false;
    // Moved away in one step, so a crash can't leave half of it
    const away = `${dir}.cleared-${Date.now()}`;
    try {
      await renameWithRetry(dir, away);
    } catch (error) {
      if (!(
        error instanceof Error &&
        "code" in error &&
        error.code === "ENOENT"
      )) {
        Logger.error(
          `<History> Couldn't move ${dir} away: ${formatError(error)}`,
          this._logFile,
          error,
        );
        return false;
      }
    }

    if (this._dir === dir) {
      this._lives = [];
      this._gifters = new Map();
      this._best = [];
      this._ended = [];
      // An empty index, written after any save that raced the move
      this._indexUnsaved = true;
      // Written again into a fresh folder
      this._liveUnsaved = this._live !== null;
      this._emit();
      await this.save();
    }
    // A failure here leaves it to the next load
    await this._remove(away);
    return true;
  }

  // shortcut: there's no save on quit, so a quit or crash during a LIVE loses
  // up to 30 s of it (the next load adds the rest from its file). Upgrade to a
  // save on quit if streamers notice.
  /**
   * Writes what changed: the file of the LIVE in progress or of one that just
   * ended, then the index. False when a write failed; the next save retries.
   * With nothing to write, how the last save went, so a switch waits for one
   * still writing.
   */
  public save(): Promise<boolean> {
    const json = this._json;
    const dir = this._dir;
    if (!json || dir === null) return this._saving;
    const live = this._liveUnsaved ? this._live : null;
    const records = [...this._ended];
    if (live) records.push(this._record(live, Date.now()));
    const index: Index | null = this._indexUnsaved
      ? { lives: [...this._lives], gifters: [...this._gifters.values()] }
      : null;
    if (!records.length && !index) return this._saving;
    this._ended = [];
    this._liveUnsaved = false;
    this._indexUnsaved = false;

    this._saving = (async () => {
      // saveFile doesn't make folders. If this fails, the writes log why.
      await mkdir(dir, { recursive: true }).catch(() => {});
      let ok = true;
      for (const record of records) {
        const file = join(dir, `${record.startedAt}.json`);
        if (await json.saveFile(file, LiveRecordSchema, record)) continue;
        ok = false;
        // Tried again on the next save, unless another profile loaded since
        // or the LIVE ended, whose final record then takes its place
        if (this._dir !== dir) continue;
        if (record.startedAt !== live?.startedAt) this._ended.push(record);
        else if (this._live === live) this._liveUnsaved = true;
      }
      if (index) {
        const file = join(dir, "index.json");
        if (!(await json.saveFile(file, IndexSchema, index))) {
          ok = false;
          if (this._dir === dir) this._indexUnsaved = true;
        }
      }
      return ok;
    })();
    return this._saving;
  }

  /** Called when the overlays' lists may have changed. */
  public onChange(listener: () => void) {
    this._listeners.push(listener);
  }

  // The LIVE in progress, as it would end now
  private _record(live: LiveSummary, now: number): LiveRecord {
    return {
      ...live,
      endedAt: now,
      gifters: [...this._liveGifters.values()].sort(byCoins),
    };
  }

  // Adds a finished LIVE to the list and its gifters to all time
  private _finish({ gifters, ...summary }: LiveRecord) {
    this._lives.push(summary);
    for (const gifter of gifters) {
      const past = this._gifters.get(gifter.userId);
      this._gifters.set(gifter.userId, {
        ...gifter,
        coins: (past?.coins ?? 0) + gifter.coins,
        gifts: (past?.gifts ?? 0) + gifter.gifts,
      });
    }
  }

  // Sorts all time and caps it, after it changes
  private _rank() {
    let kept = [...this._gifters.values()];
    // Past the cap, the fewest coins go first, then the oldest last gift
    if (kept.length > MAX_GIFTERS)
      kept = kept
        .sort((a, b) => b.coins - a.coins || b.giftedAt - a.giftedAt)
        .slice(0, MAX_GIFTERS);
    const sorted = kept.sort(byCoins);
    this._gifters = new Map(sorted.map((g) => [g.userId, g]));
    this._best = sorted.slice(0, TOP_GIFTERS);
  }

  // `gifter` is their newest: this LIVE's when they sent gifts in it
  private _toTop(gifter: Gifter): TopGifter {
    const live = this._liveGifters.get(gifter.userId);
    const past = this._gifters.get(gifter.userId);
    return {
      userId: gifter.userId,
      username: gifter.username,
      handle: gifter.handle,
      picture: gifter.picture,
      live: { coins: live?.coins ?? 0, gifts: live?.gifts ?? 0 },
      allTime: {
        coins: (past?.coins ?? 0) + (live?.coins ?? 0),
        gifts: (past?.gifts ?? 0) + (live?.gifts ?? 0),
      },
      giftedAt: gifter.giftedAt,
    };
  }

  // The index, empty without one, null when it's there but doesn't load
  private async _readIndex(dir: string): Promise<Index | null> {
    if (!this._json) return null;
    const path = join(dir, "index.json");
    const data = await this._json.loadFile(path, IndexSchema);
    if (data) return data;
    // loadFile logged why a file it found doesn't load
    return access(path).then(
      () => null,
      (error: NodeJS.ErrnoException) =>
        error.code === "ENOENT" ? { lives: [], gifters: [] } : null,
    );
  }

  private async _readLive(
    dir: string,
    startedAt: number,
  ): Promise<LiveRecord | null> {
    // Not written yet when its save failed
    const ended = this._ended.find((r) => r.startedAt === startedAt);
    if (ended || !this._json) return ended ?? null;
    const file = join(dir, `${startedAt}.json`);
    const record = await this._json.loadFile(file, LiveRecordSchema);
    if (!record)
      Logger.warn(`<History> LIVE ${file} didn't load`, this._logFile);
    return record;
  }

  // Leftovers of clear(): <name>.cleared-<digits>
  private async _removeCleared(name: string) {
    const prefix = `${name}.cleared-`;
    for (const entry of await readdir(this._folder).catch(() => [])) {
      if (
        !entry.startsWith(prefix) ||
        !/^\d+$/.test(entry.slice(prefix.length))
      )
        continue;
      await this._remove(join(this._folder, entry));
    }
  }

  // With a few tries, for files Windows holds a moment
  private async _remove(path: string) {
    await rm(path, { recursive: true, force: true, maxRetries: 3 }).catch(
      (error: unknown) =>
        Logger.warn(
          `<History> Couldn't remove ${path}: ${formatError(error)}`,
          this._logFile,
        ),
    );
  }

  private _emit() {
    for (const listener of this._listeners) listener();
  }
}
