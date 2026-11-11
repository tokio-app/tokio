import {
  GiftMinute,
  Gifter,
  LiveHistory,
  LiveRecord,
  LiveSummary,
  RankedGifter,
  TOKIO_EVENTS,
  TokioEventMap,
  TopGifter,
} from "@/common/types";
import {
  allInRange,
  DateRange,
  formatError,
  inRange,
  viewerMatcher,
} from "@/common/util";
import { renameWithRetry } from "@/helper/fs";
import { GiftStreaks } from "@/helper/streaks";
import Logger from "@/logger";
import { access, mkdir, readdir, rm } from "node:fs/promises";
import { join, parse } from "node:path";
import { z } from "zod";
import type { JSONManagerService } from "../json";
import { Service } from "../shared";

// The live events a LIVE's record counts: only gifts (the user's call)
export const HISTORY_EVENTS = [TOKIO_EVENTS.GIFT] as const;

export type HistoryEvent = (typeof HISTORY_EVENTS)[number];

// A profile keeps this many LIVEs. Past it, the oldest go as deleting them
// would, gifts included.
export const MAX_LIVES = 1500;
// All time keeps this many gifters, the fewest coins dropped first
export const MAX_GIFTERS = 10_000;
// Overlays get this many of each list
export const TOP_GIFTERS = 10;
// Coin stats gets this many of all time's
const SHOWN_GIFTERS = 100;

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
}) satisfies z.ZodType<LiveSummary>;

const GiftMinuteSchema = z.object({
  minute: z.number(),
  gifters: z.record(z.string(), z.tuple([z.number(), z.number()])),
}) satisfies z.ZodType<GiftMinute>;

const LiveRecordSchema: z.ZodType<LiveRecord> = LiveSummarySchema.extend({
  gifters: z.array(GifterSchema),
  minutes: z.array(GiftMinuteSchema).default([]),
});

// The LIVEs oldest first, and all time's gifters the most coins first
const IndexSchema = z.object({
  lives: z.array(LiveSummarySchema),
  gifters: z.array(GifterSchema),
});

type Index = z.infer<typeof IndexSchema>;

type Json = Pick<JSONManagerService, "loadFile" | "saveFile">;

// What each event does to the LIVE in progress
type Recorders = {
  [K in HistoryEvent]: (live: LiveSummary, data: TokioEventMap[K]) => void;
};

// The most coins first, ties to whoever got there first
const byCoins = (a: Gifter, b: Gifter) =>
  b.coins - a.coins || a.giftedAt - b.giftedAt;

const LIVE_FILE = /^(\d+)\.json$/;
const MINUTE = 60_000;

// A LIVE's gift minutes that are partly in the dates, each with when it
// starts, so the minutes the dates start and end in count alike
const minutesIn = (
  record: LiveRecord | null,
  { from = -Infinity, to = Infinity }: DateRange,
) => {
  const first = Math.floor((record?.startedAt ?? 0) / MINUTE);
  return (record?.minutes ?? [])
    .map((minute) => ({ ...minute, at: (first + minute.minute) * MINUTE }))
    .filter(({ at }) => at + MINUTE > from && at < to);
};

// A LIVE's gifters with only what they sent in the dates' minutes
const giftersIn = (record: LiveRecord, range: DateRange): Gifter[] => {
  const known = new Map(record.gifters.map((g) => [g.userId, g]));
  const sent = new Map<string, Gifter>();
  for (const { at, gifters } of minutesIn(record, range)) {
    for (const [userId, [coins, gifts]] of Object.entries(gifters)) {
      const gifter = known.get(userId);
      if (!gifter) continue;
      const past = sent.get(userId);
      sent.set(userId, {
        ...gifter,
        coins: (past?.coins ?? 0) + coins,
        gifts: (past?.gifts ?? 0) + gifts,
        // Their last gift in them, to the minute
        giftedAt: at,
      });
    }
  }
  return [...sent.values()];
};

/**
 * Each profile's LIVEs and the viewers who sent gifts in them, in
 * history/<profile name>/: index.json with the finished LIVEs' summaries and
 * all time's gifters, and a <startedAt>.json per LIVE with all its gifters
 * and what each sent in each minute.
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
  // The minutes the LIVE in progress's gifts came in, oldest first
  private _minutes: GiftMinute[] = [];
  private _streaks = new GiftStreaks();
  // Final records of LIVEs that ended, until their file is written
  private _ended: LiveRecord[] = [];
  // Files of LIVEs a delete or the cap dropped, until an index without them
  // is saved: a load takes a file newer than every listed LIVE back
  private _dropped: string[] = [];
  private _indexUnsaved = false;
  private _saving: Promise<boolean> = Promise.resolve(true);
  private _listeners: (() => void)[] = [];

  private readonly _recorders: Recorders = {
    [TOKIO_EVENTS.GIFT]: (live, event) => {
      const { added } = this._streaks.add(event);
      if (added <= 0) return;
      const { user, gift } = event;
      const coins = added * Math.max(0, gift.coins);
      live.gifts += added;
      live.coins += coins;
      // A gift without a user id counts in its minute's totals only
      const id = user.userId ?? "";
      const { gifters } = this._minute(live);
      const [sent, count] = gifters[id] ?? [0, 0];
      gifters[id] = [sent + coins, count + added];
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
    this._minutes = [];
    this._streaks.clear();
    this._ended = [];
    // Their LIVEs are still in the index on disk, which keeps the files
    this._dropped = [];
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
    if (recovered.length) {
      Logger.info(
        `<History> Added ${recovered.length} LIVE(s) left in ${dir}`,
        this._logFile,
      );
      this._indexUnsaved = true;
      await this.save();
    }
    await this._cap();
  }

  /** Starts a LIVE on @username, ending one still open first. */
  public start(username: string, now = Date.now()) {
    if (this._dir === null) return;
    this.end(now);
    this._live = { username, startedAt: now, endedAt: now, coins: 0, gifts: 0 };
    this._liveGifters = new Map();
    this._minutes = [];
    this._streaks.clear();
    this._emit();
  }

  public record<K extends HistoryEvent>(type: K, data: TokioEventMap[K]) {
    if (!this._live) return;
    this._recorders[type](this._live, data);
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
    this._minutes = [];
    this._streaks.clear();
    this._indexUnsaved = true;
    this._emit();
    // It reads the oldest LIVE's file, so its save comes after the end's
    void this._cap();
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
   * The finished LIVEs' coins and gifts in some dates: a LIVE all in them
   * counts whole, and one they cut only its gifts in them, so only those take
   * reading a file. Null when another profile loaded while they were read.
   */
  public async getTotals(
    range: DateRange,
  ): Promise<Pick<LiveSummary, "coins" | "gifts"> | null> {
    const dir = this._dir;
    const totals = { coins: 0, gifts: 0 };
    if (dir === null) return totals;
    for (const live of this._lives.filter((l) => inRange(l, range))) {
      if (allInRange(live, range)) {
        totals.coins += live.coins;
        totals.gifts += live.gifts;
        continue;
      }
      const record = await this._readLive(dir, live.startedAt);
      for (const { gifters } of minutesIn(record, range)) {
        for (const [coins, gifts] of Object.values(gifters)) {
          totals.coins += coins;
          totals.gifts += gifts;
        }
      }
    }
    return this._dir === dir ? totals : null;
  }

  /**
   * The top SHOWN_GIFTERS of the finished LIVEs in some dates, counting only
   * the gifts in them of a LIVE they cut, each with their place among them, and
   * with a query only the ones whose name or @handle has it. Every LIVE whole
   * is all time's list; other dates are added up from the LIVEs' files,
   * leaving out a file that doesn't load. Null when another profile loaded
   * while they were read, or the signal aborted.
   */
  public async getGifters({
    from,
    to,
    query = "",
    signal,
  }: DateRange & {
    query?: string;
    signal?: AbortSignal;
  }): Promise<RankedGifter[] | null> {
    const dir = this._dir;
    if (dir === null) return [];
    const range = { from, to };
    const lives = this._lives.filter((l) => inRange(l, range));
    // Kept in byCoins order, and read from no file
    let ranked = [...this._gifters.values()];
    if (
      lives.length < this._lives.length ||
      !lives.every((l) => allInRange(l, range))
    ) {
      const gifters = new Map<string, Gifter>();
      // One at a time, so big LIVEs don't all sit in memory. Oldest first, so
      // the name, handle and picture end up the latest ones.
      for (const { startedAt } of lives) {
        if (signal?.aborted) return null;
        const record = await this._readLive(dir, startedAt);
        if (this._dir !== dir || signal?.aborted) return null;
        if (!record) continue;
        const sent = allInRange(record, range)
          ? record.gifters
          : giftersIn(record, range);
        for (const gifter of sent) {
          const past = gifters.get(gifter.userId);
          gifters.set(gifter.userId, {
            ...gifter,
            picture: gifter.picture || (past?.picture ?? ""),
            coins: (past?.coins ?? 0) + gifter.coins,
            gifts: (past?.gifts ?? 0) + gifter.gifts,
          });
        }
      }
      ranked = [...gifters.values()].sort(byCoins);
    }

    const named = viewerMatcher(query);
    const found: RankedGifter[] = [];
    for (const [i, gifter] of ranked.entries()) {
      if (found.length === SHOWN_GIFTERS) break;
      if (named(gifter)) found.push({ ...gifter, rank: i + 1 });
    }
    return found;
  }

  /**
   * False when the index couldn't be saved: the LIVE is gone from memory, and
   * the next save tries again.
   */
  public deleteLive(startedAt: number): Promise<boolean> {
    return this._drop([startedAt]);
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
      this._dropped = [];
      // An empty index, written after any save that raced the move
      this._indexUnsaved = true;
      this._emit();
      await this.save();
    }
    // A failure here leaves it to the next load
    await this._remove(away);
    return true;
  }

  // shortcut: there's no save on quit, so a quit or crash during a LIVE loses
  // the time and gifts since its last save, up to 30 s (the next load adds the
  // rest from its file). Upgrade to a save on quit if streamers notice.
  /**
   * Writes the file of the LIVE in progress, ending at the save's time even
   * when nothing came since the last one, and of the LIVEs that just ended,
   * then the index when it changed, after which the dropped LIVEs' files go.
   * False when a write failed; the next save retries.
   * With nothing to write, how the last save went, so a switch waits for one
   * still writing.
   */
  public save(): Promise<boolean> {
    const json = this._json;
    const dir = this._dir;
    if (!json || dir === null) return this._saving;
    const live = this._live;
    const records = [...this._ended];
    if (live) records.push(this._record(live, Date.now()));
    const index: Index | null = this._indexUnsaved
      ? { lives: [...this._lives], gifters: [...this._gifters.values()] }
      : null;
    if (!records.length && !index) return this._saving;
    this._ended = [];
    this._indexUnsaved = false;
    // This index leaves their LIVEs out, so their files go once it's written
    const dropped = index ? this._dropped.splice(0) : [];

    const previous = this._saving;
    this._saving = (async () => {
      // After the save before, so an older index can't land last
      await previous;
      // saveFile doesn't make folders. If this fails, the writes log why.
      await mkdir(dir, { recursive: true }).catch(() => {});
      let ok = true;
      for (const record of records) {
        const file = join(dir, `${record.startedAt}.json`);
        if (await json.saveFile(file, LiveRecordSchema, record)) continue;
        ok = false;
        // Tried again on the next save, unless another profile loaded since.
        // Every save writes the LIVE in progress, and its end's record takes
        // its place.
        if (this._dir !== dir) continue;
        if (record.startedAt !== live?.startedAt) this._ended.push(record);
      }
      if (index) {
        const file = join(dir, "index.json");
        if (await json.saveFile(file, IndexSchema, index)) {
          for (const path of dropped) await this._remove(path);
        } else {
          ok = false;
          if (this._dir === dir) {
            this._indexUnsaved = true;
            this._dropped.push(...dropped);
          }
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
      // The minute now still changes before the save writes it, the others
      // never do
      minutes: this._minutes.map((m, i, all) =>
        i < all.length - 1 ? m : { ...m, gifters: { ...m.gifters } },
      ),
    };
  }

  // The LIVE in progress's minute now, added when it's new
  private _minute(live: LiveSummary): GiftMinute {
    const minute =
      Math.floor(Date.now() / MINUTE) - Math.floor(live.startedAt / MINUTE);
    const last = this._minutes.at(-1);
    if (last?.minute === minute) return last;
    const next = { minute, gifters: {} };
    this._minutes.push(next);
    return next;
  }

  // Adds a finished LIVE to the list and its gifters to all time. Its
  // minutes stay in its file.
  private _finish({ gifters, minutes: _minutes, ...summary }: LiveRecord) {
    this._lives.push(summary);
    for (const gifter of gifters) {
      const past = this._gifters.get(gifter.userId);
      this._gifters.set(gifter.userId, {
        ...gifter,
        picture: gifter.picture || (past?.picture ?? ""),
        coins: (past?.coins ?? 0) + gifter.coins,
        gifts: (past?.gifts ?? 0) + gifter.gifts,
      });
    }
  }

  /**
   * Takes LIVEs off the list and their gifts off all time, read from their
   * files. Their files go once an index without them is saved, by this save or
   * a later one. A file that can't be read still leaves the list. False when
   * the index couldn't be saved.
   */
  private async _drop(startedAts: number[]): Promise<boolean> {
    const dir = this._dir;
    const listed = (startedAt: number) =>
      this._lives.some((live) => live.startedAt === startedAt);
    const asked = startedAts.filter(listed);
    if (dir === null || !asked.length) return true;
    const records = await Promise.all(
      asked.map((startedAt) => this._readLive(dir, startedAt)),
    );
    if (this._dir !== dir) return true;

    // Another drop may have taken some while the files were read
    const gone = new Set<number>();
    asked.forEach((startedAt, i) => {
      if (!listed(startedAt)) return;
      gone.add(startedAt);
      const record = records[i];
      if (!record) {
        Logger.warn(
          `<History> Deleting LIVE ${join(dir, `${startedAt}.json`)}, all time keeps its gifts`,
          this._logFile,
        );
        return;
      }
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
    });
    if (!gone.size) return true;
    this._lives = this._lives.filter((l) => !gone.has(l.startedAt));
    this._ended = this._ended.filter((r) => !gone.has(r.startedAt));
    this._rank();
    this._indexUnsaved = true;
    for (const startedAt of gone) {
      this._dropped.push(join(dir, `${startedAt}.json`));
    }
    this._emit();
    return this.save();
  }

  // Past MAX_LIVES, the oldest go
  private _cap(): Promise<boolean> {
    const over = this._lives.length - MAX_LIVES;
    if (over <= 0) return Promise.resolve(true);
    return this._drop(this._lives.slice(0, over).map((l) => l.startedAt));
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
      picture: gifter.picture || (past?.picture ?? ""),
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
    // A save still writing has its record out of _ended, and the file is older
    await this._saving;
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
