import { Fan, TOKIO_EVENTS, UserData } from "@/common/types";
import Logger from "@/logger";
import { access } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import type { JSONManagerService } from "../json";
import { Service } from "../shared";

// The live events whose viewer can carry a fan level. Room Users' ranks carry
// no badges.
export const FAN_EVENTS = [
  TOKIO_EVENTS.CHAT,
  TOKIO_EVENTS.GIFT,
  TOKIO_EVENTS.LIKE,
  TOKIO_EVENTS.SHARE,
  TOKIO_EVENTS.FOLLOW,
  TOKIO_EVENTS.SUPER_FAN,
  TOKIO_EVENTS.MEMBER_JOIN,
  TOKIO_EVENTS.SUPER_FAN_JOIN,
] as const;

// Kept per profile, the ones not seen for the longest dropped first
export const MAX_FANS = 5000;
// What overlays get
export const SENT_FANS = 100;

const FanSchema: z.ZodType<Fan> = z.object({
  userId: z.string(),
  username: z.string(),
  handle: z.string(),
  fanLevel: z.number(),
  fanBadge: z.string().default(""),
  seenAt: z.number(),
});

// Least recently seen first
const FansFileSchema = z.object({ fans: z.array(FanSchema) });

type Json = Pick<JSONManagerService, "loadFile" | "saveFile">;

/**
 * The fans the active profile has seen in its LIVEs, by TikTok user id. TikTok
 * sends a viewer's fan level only when they do something, so overlays get the
 * ones seen before from here. They're saved in their own file,
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
   * is left as it is, and nothing is recorded until another load.
   */
  public async load(profileFile: string) {
    const path = join(this._folder, profileFile);
    this._loading = path;
    this._file = null;
    this._fans.clear();
    this._unsaved = false;
    const fans = await this._read(path);
    if (this._loading !== path) return;
    if (fans) {
      for (const fan of fans.slice(-MAX_FANS)) this._fans.set(fan.userId, fan);
      this._file = path;
    } else {
      Logger.warn(
        `<Fans> Not recording fans, ${path} didn't load`,
        this._logFile,
      );
    }
    this._emit();
  }

  /** Keeps a viewer with a fan level, as they show now. */
  public record(user: UserData) {
    // A missing badge isn't proof they left the fan club, so 0 changes nothing.
    const level = user.fanLevel ?? 0;
    if (this._file === null || !user.userId || level <= 0) return;
    // Set again, so it's the most recently seen
    this._fans.delete(user.userId);
    this._fans.set(user.userId, {
      userId: user.userId,
      username: user.username,
      handle: user.handle,
      fanLevel: level,
      fanBadge: user.fanBadge ?? "",
      seenAt: Date.now(),
    });
    if (this._fans.size > MAX_FANS) {
      const [oldest] = this._fans.keys();
      this._fans.delete(oldest);
    }
    this._unsaved = true;
    this._emit();
  }

  /** What overlays get: the highest levels, then the most recently seen. */
  public list(): Fan[] {
    return [...this._fans.values()]
      .sort((a, b) => b.fanLevel - a.fanLevel || b.seenAt - a.seenAt)
      .slice(0, SENT_FANS);
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

  // The file's fans, [] without one, null when it's there but doesn't load
  private async _read(path: string): Promise<Fan[] | null> {
    if (!this._json) return null;
    const data = await this._json.loadFile(path, FansFileSchema);
    if (data) return data.fans;
    // loadFile logged why a file it found doesn't load
    return access(path).then(
      () => null,
      (error: NodeJS.ErrnoException) => (error.code === "ENOENT" ? [] : null),
    );
  }

  private _emit() {
    for (const listener of this._listeners) listener();
  }
}
