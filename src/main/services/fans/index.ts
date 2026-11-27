import {
  Fan,
  Platform,
  PLATFORMS,
  TOKIO_EVENTS,
  UserData,
} from "@/common/types";
import { platformOf, topOfEach } from "@/common/util";
import Logger from "@/logger";
import { join } from "node:path";
import { z } from "zod";
import type { JSONManagerService } from "../json";
import { Service } from "../shared";

// The live events whose viewer can carry a fan level, or a subscriber's or
// member's badge. Room Users' ranks carry no badges.
export const FAN_EVENTS = [
  TOKIO_EVENTS.CHAT,
  TOKIO_EVENTS.GIFT,
  TOKIO_EVENTS.LIKE,
  TOKIO_EVENTS.SHARE,
  TOKIO_EVENTS.FOLLOW,
  TOKIO_EVENTS.SUPER_FAN,
  TOKIO_EVENTS.MEMBER_JOIN,
  TOKIO_EVENTS.SUPER_FAN_JOIN,
  TOKIO_EVENTS.SUBSCRIBE,
  TOKIO_EVENTS.SUPER_CHAT,
] as const;

export type FanEvent = (typeof FAN_EVENTS)[number];

// What an event says about a viewer's Super Fan subscription. Only chat and
// gifts carry TikTok's flag (the connector says false on the others), and
// becoming a Super Fan or joining as one says yes. The rest keep what's known.
const SUPERFAN: Partial<Record<FanEvent, (user: UserData) => boolean>> = {
  [TOKIO_EVENTS.CHAT]: (user) => Boolean(user.superfan),
  [TOKIO_EVENTS.GIFT]: (user) => Boolean(user.superfan),
  [TOKIO_EVENTS.SUPER_FAN]: () => true,
  [TOKIO_EVENTS.SUPER_FAN_JOIN]: () => true,
};

// Kept per platform in each profile, the ones not seen for the longest dropped
// first
export const MAX_FANS = 5000;
// What overlays get
export const SENT_FANS = 100;

const FanSchema: z.ZodType<Fan> = z.object({
  userId: z.string(),
  username: z.string(),
  handle: z.string(),
  fanLevel: z.number(),
  fanBadge: z.string().default(""),
  superfan: z.boolean().default(false),
  // Saved since other platforms' fans counted; TikTok's have none
  months: z.number().optional(),
  seenAt: z.number(),
  // One a newer Tokio saved that this one doesn't know reads as TikTok
  platform: z.enum(PLATFORMS).optional().catch(undefined),
});

// TikTok's by level, the others by months (unknown last), then the most
// recently seen, each platform after the one before it in PLATFORMS
const order = (a: Fan, b: Fan) =>
  PLATFORMS.indexOf(platformOf(a)) - PLATFORMS.indexOf(platformOf(b)) ||
  b.fanLevel - a.fanLevel ||
  (b.months ?? 0) - (a.months ?? 0) ||
  b.seenAt - a.seenAt;

// The last MAX_FANS of each platform, in the order they came
const capped = (fans: Fan[]) =>
  topOfEach(fans.toReversed(), MAX_FANS).toReversed();

// Least recently seen first
const FansFileSchema = z.object({ fans: z.array(FanSchema) });

type Json = Pick<JSONManagerService, "loadOr" | "saveFile">;

/**
 * The fans the active profile has seen in its LIVEs, by user id: TikTok's fan
 * club, and the other platforms' subscribers and members. TikTok sends a
 * viewer's fan level only when they do something, so overlays get the ones
 * seen before from here. They're saved in their own file,
 * fans/<profile file>, which exports and GET_PROFILE leave out.
 */
export class FansService extends Service {
  private _json: Json | null = null;
  private _folder = "";
  // The file the fans came from, null until one loads: nothing is recorded then
  private _file: string | null = null;
  // The file the latest load reads, so an earlier one that ends later is dropped
  private _loading = "";
  // By user id, least recently seen first
  private _fans = new Map<string, Fan>();
  private _unsaved = false;
  private _saving: Promise<boolean> = Promise.resolve(true);
  private _listeners: (() => void)[] = [];

  public initialize({ json, folder }: { json: Json; folder: string }) {
    this._json = json;
    this._folder = folder;
  }

  /**
   * Takes the fans of a profile, by its file's name. A file that doesn't load
   * is left as it is, and nothing is recorded until another load: false then.
   */
  public async load(profileFile: string): Promise<boolean> {
    const path = join(this._folder, profileFile);
    this._loading = path;
    this._file = null;
    this._fans.clear();
    this._unsaved = false;
    const fans = await this._read(path);
    if (this._loading !== path) return true;
    if (fans) {
      for (const fan of capped(fans)) this._fans.set(fan.userId, fan);
      this._file = path;
    } else {
      Logger.warn(
        `<Fans> Not recording fans, ${path} didn't load`,
        this._logFile,
      );
    }
    this._emit();
    return fans !== null;
  }

  /**
   * Keeps a viewer with a fan level, or a subscriber or member on the other
   * platforms, as the event `type` shows them now. `months` is a sub's.
   */
  public record(user: UserData, type?: FanEvent, months?: number) {
    if (this._file === null || !user.userId) return;
    const fan = this._fan(user, user.userId, type, months);
    if (!fan) return;
    // Only a new fan can take its platform past MAX_FANS
    const isNew = !this._fans.has(fan.userId);
    // Set again, so it's the most recently seen
    this._fans.delete(fan.userId);
    this._fans.set(fan.userId, fan);
    if (isNew && this._fans.size > MAX_FANS) this._trim(platformOf(fan));
    this._unsaved = true;
    this._emit();
  }

  /**
   * TikTok's fans, the highest levels first, then the most recently seen:
   * what overlays get, the first SENT_FANS. The other platforms' would fill a
   * fan-level overlay with subs.
   */
  public list(limit = SENT_FANS): Fan[] {
    return [...this._fans.values()]
      .filter((fan) => platformOf(fan) === "tiktok")
      .sort(order)
      .slice(0, limit);
  }

  /**
   * Every platform's fans, for the Fans page and MCP: TikTok's by level, the
   * others by months, then the most recently seen. Platforms aren't ranked
   * against each other, so each comes after the one before it in PLATFORMS.
   */
  public all(): Fan[] {
    return [...this._fans.values()].sort(order);
  }

  /**
   * Saves the fans into the file they came from, when they changed. With
   * nothing to save, how the last save went, so a switch waits for one still
   * writing.
   */
  public save(): Promise<boolean> {
    const json = this._json;
    const file = this._file;
    if (!json || file === null || !this._unsaved) return this._saving;
    const data = { fans: [...this._fans.values()] };
    this._unsaved = false;
    this._saving = json.saveFile(file, FansFileSchema, data).then((saved) => {
      // Tried again on the next save, unless another profile loaded since
      if (!saved && this._file === file) this._unsaved = true;
      return saved;
    });
    return this._saving;
  }

  /** The listener runs when the fans change, and after each load. */
  public onChange(listener: () => void) {
    this._listeners.push(listener);
  }

  // What the event says about a viewer, or null when it doesn't show them as a
  // fan. A missing badge isn't proof they left, so it changes nothing.
  private _fan(
    user: UserData,
    userId: string,
    type?: FanEvent,
    months?: number,
  ): Fan | null {
    const known = this._fans.get(userId);
    const platform = platformOf(user);
    const base = { userId, username: user.username, handle: user.handle };
    if (platform === "tiktok") {
      const level = user.fanLevel ?? 0;
      if (level <= 0) return null;
      const said = type ? SUPERFAN[type]?.(user) : undefined;
      return {
        ...base,
        fanLevel: level,
        fanBadge: user.fanBadge ?? "",
        superfan: said ?? known?.superfan ?? false,
        seenAt: Date.now(),
      };
    }
    // Their subscriber or member badge, or a sub, says they're one
    if (!user.superfan && type !== TOKIO_EVENTS.SUBSCRIBE) return null;
    // YouTube's badge says only its milestone, so a larger number stays
    const most = Math.max(known?.months ?? 0, user.subMonths ?? 0, months ?? 0);
    return {
      ...base,
      fanLevel: 0,
      fanBadge: "",
      superfan: true,
      ...(most > 0 && { months: most }),
      seenAt: Date.now(),
      platform,
    };
  }

  // Drops the platform's one not seen for the longest when it has too many
  private _trim(platform: Platform) {
    let count = 0;
    let oldest: string | undefined;
    for (const fan of this._fans.values()) {
      if (platformOf(fan) !== platform) continue;
      count++;
      oldest ??= fan.userId;
    }
    if (count > MAX_FANS && oldest !== undefined) this._fans.delete(oldest);
  }

  // The file's fans, [] without one, null when it's there but doesn't load
  private async _read(path: string): Promise<Fan[] | null> {
    if (!this._json) return null;
    const data = await this._json.loadOr(path, FansFileSchema, { fans: [] });
    return data && data.fans;
  }

  private _emit() {
    for (const listener of this._listeners) listener();
  }
}
