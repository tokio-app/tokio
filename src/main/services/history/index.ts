import {
  LiveHistory,
  LiveRecord,
  TOKIO_EVENTS,
  TokioEventMap,
  TopGifter,
} from "@/common/types";
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

type Json = Pick<JSONManagerService, "loadFile" | "saveFile">;

/**
 * Each profile's LIVEs and the viewers who sent gifts in them, in
 * history/<profile name>/: index.json with the finished LIVEs' summaries and
 * all time's gifters, and a <startedAt>.json per LIVE with all its gifters.
 */
export class HistoryService extends Service {
  public initialize(_deps: { json: Json; folder: string }) {}

  /** Loads a profile's history, adding a LIVE that a quit or a crash left. */
  public async load(_profileFile: string): Promise<void> {}

  /** Starts a LIVE on @username, ending one still open first. */
  public start(_username: string, _now = Date.now()) {}

  public record<K extends HistoryEvent>(_type: K, _data: TokioEventMap[K]) {}

  /** Ends the LIVE in progress, whose gifters join all time. */
  public end(_now = Date.now()) {}

  /** The top 10s overlays get, with both numbers on everyone. */
  public top(): { live: TopGifter[]; allTime: TopGifter[] } {
    return { live: [], allTime: [] };
  }

  /** The finished LIVEs, newest first, and all time's top gifters. */
  public getHistory(): LiveHistory {
    return { lives: [], gifters: [] };
  }

  /** A finished LIVE with its gifters, null when it isn't kept or unreadable. */
  public async getLive(_startedAt: number): Promise<LiveRecord | null> {
    return null;
  }

  /**
   * False when the index couldn't be saved: the LIVE is gone from memory, and
   * the next save tries again.
   */
  public async deleteLive(_startedAt: number): Promise<boolean> {
    return true;
  }

  /** False when the history couldn't be moved away, which changes nothing. */
  public async clear(): Promise<boolean> {
    return true;
  }

  /** Writes what changed. False when a write failed; the next save retries. */
  public async save(): Promise<boolean> {
    return true;
  }

  /** Called when the overlays' lists may have changed. */
  public onChange(_listener: () => void) {}
}
