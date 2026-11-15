import type { ControlState } from "@/common/types";
import type { AlertAudio } from "@/services/alerts";
import { Service } from "../shared";

/**
 * What the live controls keep, in memory only: whether reactions are paused,
 * and the last LIVE event's alerts, for a replay.
 */
export class ControlsService extends Service {
  private _paused = false;
  private _alerts: readonly AlertAudio[] = [];
  private _listeners: ((state: ControlState) => void)[] = [];

  public isPaused() {
    return this._paused;
  }

  /** Returns whether it changed, which is when the listeners hear of it. */
  public setPaused(paused: boolean): boolean {
    if (this._paused === paused) return false;
    this._paused = paused;
    for (const listener of this._listeners) listener({ paused });
    return true;
  }

  public onChange(listener: (state: ControlState) => void) {
    this._listeners.push(listener);
  }

  // Kept by reference: spoken alerts made later join the same event's group
  public recordAlerts(group: AlertAudio[]) {
    this._alerts = group;
  }

  public lastAlerts(): readonly AlertAudio[] {
    return this._alerts;
  }
}
