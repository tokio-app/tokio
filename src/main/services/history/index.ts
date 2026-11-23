import {
  GiftMinute,
  Gifter,
  HistoryTotals,
  LiveHistory,
  LiveRecord,
  LiveSummary,
  Platform,
  PLATFORMS,
  RankedGifter,
  TOKIO_EVENTS,
  TokioEventMap,
  TopGifter,
  UserData,
} from "@/common/types";
import {
  allInRange,
  DateRange,
  formatError,
  GIFT_CURRENCY,
  inRange,
  isPlatform,
  platformOf,
  platformParts,
  viewerMatcher,
} from "@/common/util";
import { parseAmount } from "@/helper/amount";
import { isMissing, renameWithRetry } from "@/helper/fs";
import { GiftStreaks } from "@/helper/streaks";
import Logger from "@/logger";
import { access, mkdir, readdir, rm } from "node:fs/promises";
import { join, parse } from "node:path";
import { z } from "zod";
import type { JSONManagerService } from "../json";
import type { RatesService } from "../rates";
import { Service } from "../shared";

// The live events a LIVE's record counts: what viewers spend, each
// platform's in its own currency (PLATFORM_CURRENCY), and gifted subs
export const HISTORY_EVENTS = [
  TOKIO_EVENTS.GIFT,
  TOKIO_EVENTS.CHEER,
  TOKIO_EVENTS.SUPER_CHAT,
  TOKIO_EVENTS.GIFT_SUB,
] as const;

export type HistoryEvent = (typeof HISTORY_EVENTS)[number];

// A profile keeps this many LIVEs. Past it, the oldest go as deleting them
// would, gifts included.
export const MAX_LIVES = 1500;
// All time keeps this many gifters of each platform, the fewest dropped
// first
export const MAX_GIFTERS = 10_000;
// Overlays get this many of each list
export const TOP_GIFTERS = 10;
// LIVE history gets this many of each platform's
const SHOWN_GIFTERS = 100;

const GifterSchema: z.ZodType<Gifter> = z.object({
  userId: z.string(),
  username: z.string(),
  handle: z.string(),
  picture: z.string(),
  coins: z.number(),
  gifts: z.number(),
  // Gifted subs, since Twitch, YouTube and Kick came; older ones had none
  giftSubs: z.number().default(0),
  giftedAt: z.number(),
  // One a newer Tokio saved that this one doesn't know reads as TikTok
  platform: z.enum(PLATFORMS).optional().catch(undefined),
});

const LiveSummarySchema = z.object({
  username: z.string(),
  startedAt: z.number(),
  endedAt: z.number(),
  coins: z.number(),
  gifts: z.number(),
  // Each platform's part; older LIVEs, TikTok's alone, have none
  platforms: z
    .partialRecord(
      z.enum(PLATFORMS),
      z.object({ amount: z.number(), gifts: z.number(), giftSubs: z.number() }),
    )
    .default({}),
}) satisfies z.ZodType<LiveSummary>;

const GiftMinuteSchema = z.object({
  minute: z.number(),
  // Entries saved before gifted subs counted have two numbers
  gifters: z.record(
    z.string(),
    z.tuple([z.number(), z.number(), z.number().default(0)]),
  ),
}) satisfies z.ZodType<GiftMinute>;

const LiveRecordSchema: z.ZodType<LiveRecord> = LiveSummarySchema.extend({
  gifters: z.array(GifterSchema),
  minutes: z.array(GiftMinuteSchema).default([]),
});

// The LIVEs oldest first, and all time's gifters in byAmount order
const IndexSchema = z.object({
  lives: z.array(LiveSummarySchema),
  gifters: z.array(GifterSchema),
  // The newest startedAt ever listed, so a deleted newest LIVE's file isn't
  // taken for a crash's leftover
  newest: z.number().optional(),
});

type Index = z.infer<typeof IndexSchema>;

type Json = Pick<
  JSONManagerService,
  "loadFile" | "saveFile" | "saveArbitraryFile"
>;

// What each event does to the LIVE in progress
type Recorders = {
  [K in HistoryEvent]: (live: LiveSummary, data: TokioEventMap[K]) => void;
};

// A Super Chat waiting for the rates, with when it came
type Waiting = { user: UserData; currency: string; value: number; at: number };

// The most first in their platform's currency, then the most gifted subs,
// ties to whoever got there first. Only a platform's own compare, so a list
// sorted by it keeps each platform's order.
const byAmount = (a: Gifter, b: Gifter) =>
  b.coins - a.coins || b.giftSubs - a.giftSubs || a.giftedAt - b.giftedAt;

// Overlays' order, as before gifted subs counted
const byCoins = (a: Gifter, b: Gifter) =>
  b.coins - a.coins || a.giftedAt - b.giftedAt;

// The gifters overlays get: TikTok's and Kick's who sent gifts with a price
const overlaid = (gifter: Gifter) =>
  gifter.coins > 0 && GIFT_CURRENCY[platformOf(gifter)] !== null;

// A minute key's platform, from its id's prefix ("kick:..."). Bare ids, ""
// included, are TikTok's.
const keyPlatform = (key: string): Platform => {
  const prefix = key.slice(0, Math.max(0, key.indexOf(":")));
  return isPlatform(prefix) ? prefix : "tiktok";
};

const noPart = (): HistoryTotals => ({ amount: 0, gifts: 0, giftSubs: 0 });

const addPart = (
  parts: Partial<Record<Platform, HistoryTotals>>,
  platform: Platform,
  { amount, gifts, giftSubs }: HistoryTotals,
) => {
  const part = (parts[platform] ??= noPart());
  part.amount += amount;
  part.gifts += gifts;
  part.giftSubs += giftSubs;
};

// Counts each platform's gifters as it's called, giving the one's place
const placer = () => {
  const places = new Map<Platform, number>();
  return (gifter: Gifter) => {
    const platform = platformOf(gifter);
    const place = (places.get(platform) ?? 0) + 1;
    places.set(platform, place);
    return place;
  };
};

// The sorted gifters within their platform's first `count`, in their order
const topOfEach = (sorted: Gifter[], count: number) => {
  const place = placer();
  return sorted.filter((gifter) => place(gifter) <= count);
};

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
    for (const [userId, [coins, gifts, giftSubs]] of Object.entries(gifters)) {
      const gifter = known.get(userId);
      if (!gifter) continue;
      const past = sent.get(userId);
      sent.set(userId, {
        ...gifter,
        coins: (past?.coins ?? 0) + coins,
        gifts: (past?.gifts ?? 0) + gifts,
        giftSubs: (past?.giftSubs ?? 0) + giftSubs,
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
  // All time, by user id, kept in byAmount order
  private _gifters = new Map<string, Gifter>();
  // All time's top TOP_GIFTERS for overlays, so top() never sorts all of it
  private _best: Gifter[] = [];
  private _live: LiveSummary | null = null;
  private _liveGifters = new Map<string, Gifter>();
  // The minutes the LIVE in progress's gifts came in, oldest first
  private _minutes: GiftMinute[] = [];
  private _streaks = new GiftStreaks();
  private _rates: Pick<RatesService, "toUsd"> | null = null;
  // This LIVE's Super Chats that came before the rates loaded
  private _waiting: Waiting[] = [];
  // Super Chat amounts that couldn't be read, logged once each
  private _unread = new Set<string>();
  // Final records of LIVEs that ended, until their file is written
  private _ended: LiveRecord[] = [];
  // Files of LIVEs a delete or the cap dropped, until an index without them
  // is saved: an index on disk must never list a LIVE whose file is gone
  private _dropped: string[] = [];
  // The newest startedAt ever listed, deleted LIVEs included
  private _newest = -Infinity;
  private _indexUnsaved = false;
  private _saving: Promise<boolean> = Promise.resolve(true);
  private _listeners: (() => void)[] = [];

  private readonly _recorders: Recorders = {
    [TOKIO_EVENTS.GIFT]: (live, event) => {
      const { added } = this._streaks.add(event);
      if (added <= 0) return;
      const { user, gift } = event;
      // gift.coins is in the platform's currency: a Kick gift's are Kicks.
      // YouTube's Gifts have no price.
      const priced = GIFT_CURRENCY[platformOf(user)] !== null;
      const amount = priced ? added * Math.max(0, gift.coins) : 0;
      this._count(live, user, { amount, gifts: added, giftSubs: 0 });
    },
    [TOKIO_EVENTS.CHEER]: (live, { user, bits }) => {
      this._count(live, user, { amount: bits, gifts: 0, giftSubs: 0 });
    },
    [TOKIO_EVENTS.GIFT_SUB]: (live, { user, count }) => {
      this._count(live, user, { amount: 0, gifts: 0, giftSubs: count });
    },
    [TOKIO_EVENTS.SUPER_CHAT]: (live, { user, amount, usd }) => {
      if (typeof usd === "number") {
        this._count(live, user, { amount: usd, gifts: 0, giftSubs: 0 });
        return;
      }
      const parsed = parseAmount(amount);
      if (!parsed) {
        if (this._unread.has(amount)) return;
        this._unread.add(amount);
        Logger.warn(
          `<History> Couldn't read the Super Chat amount ${JSON.stringify(amount)}, left out of the LIVE's dollars`,
          this._logFile,
        );
        return;
      }
      // Counted when the rates load, unless the LIVE ends first
      this._waiting.push({ ...parsed, user, at: Date.now() });
      this._countWaiting();
    },
  };

  public initialize({ json, folder }: { json: Json; folder: string }) {
    this._json = json;
    this._folder = folder;
  }

  /**
   * Sets what converts the Super Chats to dollars. The ones that came before
   * the rates loaded count once they do.
   */
  public setRates(rates: Pick<RatesService, "toUsd" | "onChange">) {
    this._rates = rates;
    rates.onChange(() => this._countWaiting());
  }

  /** A platform joined the LIVE: it's kept in it even if it sends nothing. */
  public join(platform: Platform) {
    if (this._live) addPart(this._live.platforms, platform, noPart());
  }

  /**
   * Loads a profile's history, adding a LIVE that a quit or a crash left.
   * False when its index is there but doesn't load, so nothing is recorded.
   */
  public async load(profileFile: string): Promise<boolean> {
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
    this._waiting = [];
    this._ended = [];
    // Their LIVEs are still in the index on disk, which keeps the files
    this._dropped = [];
    this._newest = -Infinity;
    this._indexUnsaved = false;

    await this._removeCleared(name);
    const index = await this._readIndex(dir);
    if (this._loading !== dir) return true;
    if (!index) {
      Logger.warn(
        `<History> Not recording LIVEs, ${join(dir, "index.json")} didn't load`,
        this._logFile,
      );
      this._emit();
      return false;
    }

    const lives = index.lives;
    const newest = Math.max(
      index.newest ?? -Infinity,
      lives.at(-1)?.startedAt ?? -Infinity,
    );
    const listed = new Set(lives.map((live) => live.startedAt));
    const left: number[] = [];
    for (const file of await readdir(dir).catch(() => [])) {
      const startedAt = Number(LIVE_FILE.exec(file)?.[1] ?? NaN);
      if (Number.isNaN(startedAt) || listed.has(startedAt)) continue;
      // Newer than every LIVE ever listed, a quit or a crash left it. Older, a
      // delete did.
      if (startedAt > newest) left.push(startedAt);
      else await this._remove(join(dir, file));
    }
    const recovered: LiveRecord[] = [];
    for (const startedAt of left.sort((a, b) => a - b)) {
      const record = await this._readLive(dir, startedAt);
      if (record) recovered.push(record);
    }
    if (this._loading !== dir) return true;

    this._dir = dir;
    this._lives = lives;
    this._newest = newest;
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
    return true;
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
      platforms: {},
    };
    this._liveGifters = new Map();
    this._minutes = [];
    this._streaks.clear();
    this._waiting = [];
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
    if (this._waiting.length) {
      Logger.warn(
        `<History> Left ${this._waiting.length} Super Chat(s) out of the LIVE's dollars, the exchange rates didn't load before it ended`,
        this._logFile,
      );
      this._waiting = [];
    }
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

  /**
   * The top 10s overlays get, with both numbers on everyone: TikTok's and
   * Kick's gifters of gifts with a price, as before other platforms counted.
   */
  public top(): { live: TopGifter[]; allTime: TopGifter[] } {
    const live = [...this._liveGifters.values()].filter(overlaid);
    const ids = new Set(live.map((g) => g.userId));
    const past = this._best.filter((g) => !ids.has(g.userId));
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

  /**
   * This LIVE's top gifters on each platform, for Home, Studio and MCP. Every
   * record has an amount or gifted subs.
   */
  public topByPlatform(): Partial<Record<Platform, Gifter[]>> {
    const tops: Partial<Record<Platform, Gifter[]>> = {};
    for (const gifter of [...this._liveGifters.values()].sort(byAmount)) {
      // Missing means TikTok
      const top = (tops[gifter.platform ?? "tiktok"] ??= []);
      if (top.length < TOP_GIFTERS) top.push({ ...gifter });
    }
    return tops;
  }

  /**
   * The finished LIVEs, newest first, and each platform's top gifters of all
   * time, in one list in byAmount order.
   */
  public getHistory(): LiveHistory {
    return {
      lives: [...this._lives].reverse(),
      gifters: topOfEach([...this._gifters.values()], SHOWN_GIFTERS),
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
   * The finished LIVEs' TikTok coins, gifts and each platform's part in some
   * dates: a LIVE all in them counts whole, and one they cut only its gifts
   * in them, so only those take reading a file. Each platform a LIVE was on
   * is there, with zeros when it sent nothing in them. Null when another
   * profile loaded while they were read.
   */
  public async getTotals(
    range: DateRange,
  ): Promise<Pick<LiveSummary, "coins" | "gifts" | "platforms"> | null> {
    const dir = this._dir;
    const totals: Pick<LiveSummary, "coins" | "gifts" | "platforms"> = {
      coins: 0,
      gifts: 0,
      platforms: {},
    };
    if (dir === null) return totals;
    for (const live of this._lives.filter((l) => inRange(l, range))) {
      const whole = allInRange(live, range);
      const parts = platformParts(live);
      for (const platform of PLATFORMS) {
        const part = parts[platform];
        if (part) addPart(totals.platforms, platform, whole ? part : noPart());
      }
      if (whole) {
        totals.coins += live.coins;
        totals.gifts += live.gifts;
        continue;
      }
      const record = await this._readLive(dir, live.startedAt);
      for (const { gifters } of minutesIn(record, range)) {
        for (const [key, [amount, gifts, giftSubs]] of Object.entries(
          gifters,
        )) {
          const platform = keyPlatform(key);
          addPart(totals.platforms, platform, { amount, gifts, giftSubs });
          if (platform === "tiktok") totals.coins += amount;
          totals.gifts += gifts;
        }
      }
    }
    return this._dir === dir ? totals : null;
  }

  /**
   * Each platform's top SHOWN_GIFTERS of the finished LIVEs in some dates, in
   * one list in byAmount order, counting only the gifts in them of a LIVE
   * they cut, each with their place among their platform's gifters, and with
   * a query only the ones whose name or @handle has it. Every LIVE whole is
   * all time's list; other dates are added up from the LIVEs' files, leaving
   * out a file that doesn't load. Null when another profile loaded while they
   * were read, or the signal aborted.
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
    // Kept in byAmount order, and read from no file
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
            giftSubs: (past?.giftSubs ?? 0) + gifter.giftSubs,
          });
        }
      }
      ranked = [...gifters.values()].sort(byAmount);
    }

    const named = viewerMatcher(query);
    const place = placer();
    const shown = placer();
    const found: RankedGifter[] = [];
    for (const gifter of ranked) {
      const rank = place(gifter);
      if (named(gifter) && shown(gifter) <= SHOWN_GIFTERS)
        found.push({ ...gifter, rank });
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
      if (!isMissing(error)) {
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
      this._newest = -Infinity;
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
   * then the index when it changed and every ended LIVE's file was written,
   * after which the dropped LIVEs' files go.
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
      ? {
          lives: [...this._lives],
          gifters: [...this._gifters.values()],
          ...(Number.isFinite(this._newest) && { newest: this._newest }),
        }
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
      let endFailed = false;
      for (const record of records) {
        const file = join(dir, `${record.startedAt}.json`);
        // Built here, so unchecked: Zod on a long LIVE takes tens of ms
        if (await json.saveArbitraryFile(file, record)) continue;
        ok = false;
        const ended = record.startedAt !== live?.startedAt;
        if (ended) endFailed = true;
        // Tried again on the next save, unless another profile loaded since.
        // Every save writes the LIVE in progress, and its end's record takes
        // its place.
        if (this._dir !== dir) continue;
        if (ended) this._ended.push(record);
      }
      if (index) {
        const file = join(dir, "index.json");
        // An index on disk must never list a LIVE whose file isn't written
        if (!endFailed && (await json.saveFile(file, IndexSchema, index))) {
          // One left over goes on the next save or load. Not a failed save:
          // a held file mustn't refuse a profile switch.
          for (const path of dropped) {
            if ((await this._remove(path)) || this._dir !== dir) continue;
            this._indexUnsaved = true;
            this._dropped.push(path);
          }
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
      gifters: [...this._liveGifters.values()].sort(byAmount),
      // The minute now still changes before the save writes it, the others
      // never do
      minutes: this._minutes.map((m, i, all) =>
        i < all.length - 1 ? m : { ...m, gifters: { ...m.gifters } },
      ),
    };
  }

  // The LIVE in progress's minute `at` is in, added when it's new
  private _minute(live: LiveSummary, at: number): GiftMinute {
    const minute =
      Math.floor(at / MINUTE) - Math.floor(live.startedAt / MINUTE);
    const last = this._minutes.at(-1);
    if (last?.minute === minute) return last;
    const i = this._minutes.findIndex((m) => m.minute >= minute);
    if (i === -1) {
      const next = { minute, gifters: {} };
      this._minutes.push(next);
      return next;
    }
    // An earlier one, for a Super Chat that waited for the rates: copied, as
    // a save still writing may hold it
    const found = this._minutes[i];
    const same = found.minute === minute;
    const copy = { minute, gifters: same ? { ...found.gifters } : {} };
    this._minutes.splice(i, same ? 1 : 0, copy);
    return copy;
  }

  // Counts what a viewer sent at `at` in the LIVE, its platform's part, its
  // minute and their record
  private _count(
    live: LiveSummary,
    user: UserData,
    sent: HistoryTotals,
    at = Date.now(),
  ) {
    const platform = platformOf(user);
    addPart(live.platforms, platform, sent);
    if (!sent.amount && !sent.gifts && !sent.giftSubs) return;
    live.gifts += sent.gifts;
    // As Tokio kept them before other platforms
    if (platform === "tiktok") live.coins += sent.amount;
    const last = user.userId ? this._liveGifters.get(user.userId) : undefined;
    // A viewer gets a record with an amount or gifted subs. A gift without a
    // price (YouTube's Gifts) adds only to one they have.
    const gifter =
      user.userId && (last || sent.amount > 0 || sent.giftSubs > 0)
        ? user.userId
        : "";
    // Without one, in the platform's own: "" for TikTok, "kick:" for Kick
    const id = gifter || (platform === "tiktok" ? "" : `${platform}:`);
    const { gifters } = this._minute(live, at);
    const [amount, gifts, giftSubs] = gifters[id] ?? [0, 0, 0];
    gifters[id] = [
      amount + sent.amount,
      gifts + sent.gifts,
      giftSubs + sent.giftSubs,
    ];
    if (gifter) {
      this._liveGifters.set(gifter, {
        userId: gifter,
        username: user.username,
        handle: user.handle,
        picture: user.profilePictures[0] || (last?.picture ?? ""),
        coins: (last?.coins ?? 0) + sent.amount,
        gifts: (last?.gifts ?? 0) + sent.gifts,
        giftSubs: (last?.giftSubs ?? 0) + sent.giftSubs,
        giftedAt: Math.max(at, last?.giftedAt ?? at),
        ...(user.platform && { platform: user.platform }),
      });
    }
    this._emit();
  }

  // The Super Chats that waited, once the rates load
  private _countWaiting() {
    const live = this._live;
    const rates = this._rates;
    if (!live || !rates) return;
    this._waiting = this._waiting.filter(({ user, currency, value, at }) => {
      const usd = rates.toUsd({ [currency]: value });
      if (usd === null) return true;
      this._count(live, user, { amount: usd, gifts: 0, giftSubs: 0 }, at);
      return false;
    });
  }

  // Adds a finished LIVE to the list and its gifters to all time. Its
  // minutes stay in its file.
  private _finish({ gifters, minutes: _minutes, ...summary }: LiveRecord) {
    this._lives.push(summary);
    this._newest = Math.max(this._newest, summary.startedAt);
    for (const gifter of gifters) {
      const past = this._gifters.get(gifter.userId);
      this._gifters.set(gifter.userId, {
        ...gifter,
        picture: gifter.picture || (past?.picture ?? ""),
        coins: (past?.coins ?? 0) + gifter.coins,
        gifts: (past?.gifts ?? 0) + gifter.gifts,
        giftSubs: (past?.giftSubs ?? 0) + gifter.giftSubs,
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
      for (const { userId, coins, gifts, giftSubs } of record.gifters) {
        // Gone when the cap dropped them. Below this LIVE's numbers, the cap
        // dropped them and later gifts brought them back without it.
        // shortcut: one whose later gifts reach this LIVE's still loses this
        // LIVE's numbers from them, an undercount. Track when each all-time
        // entry began if that ever matters.
        const gifter = this._gifters.get(userId);
        if (
          !gifter ||
          gifter.coins < coins ||
          gifter.gifts < gifts ||
          gifter.giftSubs < giftSubs
        )
          continue;
        const left = {
          ...gifter,
          coins: gifter.coins - coins,
          gifts: gifter.gifts - gifts,
          giftSubs: gifter.giftSubs - giftSubs,
        };
        if (left.coins <= 0 && left.gifts <= 0 && left.giftSubs <= 0)
          this._gifters.delete(userId);
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

  // Sorts all time and caps each platform's, after it changes
  private _rank() {
    let kept = [...this._gifters.values()];
    // Past the cap, the fewest go first, then the fewest gifted subs, then
    // the oldest last gift
    if (kept.length > MAX_GIFTERS)
      kept = topOfEach(
        kept.sort(
          (a, b) =>
            b.coins - a.coins ||
            b.giftSubs - a.giftSubs ||
            b.giftedAt - a.giftedAt,
        ),
        MAX_GIFTERS,
      );
    const sorted = kept.sort(byAmount);
    this._gifters = new Map(sorted.map((g) => [g.userId, g]));
    this._best = sorted.filter(overlaid).sort(byCoins).slice(0, TOP_GIFTERS);
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
      ...(gifter.platform && { platform: gifter.platform }),
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
      (error: unknown) =>
        isMissing(error) ? { lives: [], gifters: [] } : null,
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

  // With a few tries, for files Windows holds a moment. False when it failed.
  private async _remove(path: string): Promise<boolean> {
    return rm(path, { recursive: true, force: true, maxRetries: 3 }).then(
      () => true,
      (error: unknown) => {
        Logger.warn(
          `<History> Couldn't remove ${path}: ${formatError(error)}`,
          this._logFile,
        );
        return false;
      },
    );
  }

  private _emit() {
    for (const listener of this._listeners) listener();
  }
}
