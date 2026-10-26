import {
  TimerAction,
  TimerProfile,
  TimerSettings,
  TimerSettingsSchema,
  TimerStatus,
} from "@/common/schemas";
import {
  TimerState,
  TOKIO_EVENTS,
  TokioEventMap,
  UserData,
} from "@/common/types";
import { formatError } from "@/common/util";
import { hasKeyword } from "@/helper/chat";
import { GiftStreaks } from "@/helper/streaks";
import Logger from "@/logger";
import type { StoreManagerService } from "../store";
import { Service } from "../shared";

// The live events that add time
export const TIMER_EVENTS = [
  TOKIO_EVENTS.GIFT,
  TOKIO_EVENTS.LIKE,
  TOKIO_EVENTS.SUPER_FAN,
  TOKIO_EVENTS.FOLLOW,
  TOKIO_EVENTS.SHARE,
  TOKIO_EVENTS.CHAT,
] as const;

type TimerEvent = (typeof TIMER_EVENTS)[number];

// The seconds each event adds, before the multiplier
type Triggers = {
  [K in TimerEvent]: (data: TokioEventMap[K]) => number;
};

const MINUTE_MS = 60_000;
// The longest setTimeout Node takes, a longer one fires right away
const MAX_TIMEOUT_MS = 2 ** 31 - 1;
export const SAVE_INTERVAL_MS = 5000;

/**
 * The active profile's countdown timer. It lives in main, so it runs with
 * the Tools page closed: Start, Pause, Stop and Reset, time added by live
 * events and by hand, and saving it into the profile it was loaded from.
 */
export class TimerService extends Service {
  private _store: Pick<StoreManagerService, "updateProfileData"> | null = null;
  private _interval: ReturnType<typeof setInterval> | null = null;
  // The profile file the timer was loaded from, null until a load
  private _file: string | null = null;
  private _settings = TimerSettingsSchema.parse({});
  private _status: TimerStatus = "idle";
  // The time left while it isn't running
  private _remaining = this._settings.start * MINUTE_MS;
  // When it ends while running, on performance.now()'s clock
  private _endsAt = 0;
  private _timeout: ReturnType<typeof setTimeout> | null = null;
  // Likes toward the next cycle
  private _likes = 0;
  // When each viewer's chat adds time again, by handle
  private _cooldowns = new Map<string, number>();
  private _streaks = new GiftStreaks();
  // Changed since the last save by something no request saves: added time,
  // the end, a pause on disconnect
  private _unsaved = false;
  private _listeners: ((deltaMs: number) => void)[] = [];

  private readonly _triggers: Triggers = {
    [TOKIO_EVENTS.GIFT]: (event) => {
      const { added } = this._streaks.add(event);
      return added * Math.max(0, event.gift.coins) * this._seconds().coin;
    },
    [TOKIO_EVENTS.LIKE]: ({ likeCount }) => {
      const { likes, likes_every } = this._seconds();
      this._likes += Math.max(0, likeCount);
      const cycles = Math.floor(this._likes / likes_every);
      this._likes %= likes_every;
      return cycles * likes;
    },
    [TOKIO_EVENTS.SUPER_FAN]: () => this._seconds().superfan,
    [TOKIO_EVENTS.FOLLOW]: () => this._seconds().follow,
    [TOKIO_EVENTS.SHARE]: () => this._seconds().share,
    // Only messages with the keyword, once per viewer in the cooldown
    [TOKIO_EVENTS.CHAT]: ({ user, comment }) =>
      hasKeyword(comment.content, this._settings.chat.keyword)
        ? this._once(user, this._seconds().chat)
        : 0,
  };

  public initialize({
    store,
  }: {
    store: Pick<StoreManagerService, "updateProfileData">;
  }) {
    this._store = store;
    // Once: startApp runs again after a failed load.
    // shortcut: a quit or crash while running loses up to 5 s (it comes back
    // with that much more), upgrade to a save on quit if streamers notice.
    // The updater's install can't wait for one.
    this._interval ??= setInterval(() => this._tick(), SAVE_INTERVAL_MS);
    this._interval.unref();
  }

  /** Takes a profile's timer and the file it came from. Running comes back paused. */
  public load(timer: TimerProfile, file: string) {
    this._clearTimeout();
    this._file = file;
    this._settings = timer.settings;
    this._status = timer.status === "running" ? "paused" : timer.status;
    this._remaining =
      this._status === "idle" ? this._startMs() : timer.remaining;
    this._likes = 0;
    this._cooldowns.clear();
    this._unsaved = false;
    this._emit(0);
  }

  public get(): { settings: TimerSettings; state: TimerState } {
    this._settle();
    return {
      settings: this._settings,
      state: { status: this._status, remaining: this._left() },
    };
  }

  /** Throws when the schema refuses them. While idle the clock follows start. */
  public setSettings(settings: TimerSettings) {
    this._settle();
    this._settings = TimerSettingsSchema.parse(settings);
    if (this._status === "idle") this._remaining = this._startMs();
    this._emit(0);
  }

  /** Actions that don't apply, like Start at 0, change nothing. */
  public control(action: TimerAction) {
    this._settle();
    const status = this._status;
    if (action === "start" && status !== "running") {
      const left = status === "idle" ? this._startMs() : this._remaining;
      if (left > 0) this._run(left);
    } else if (action === "pause" && status === "running") {
      this._hold("paused");
    } else if (
      action === "stop" &&
      (status === "running" || status === "paused")
    ) {
      this._hold("stopped");
    } else if (action === "reset") {
      this._clearTimeout();
      this._status = "idle";
      this._remaining = this._startMs();
      this._likes = 0;
      this._cooldowns.clear();
    }
    this._emit(0);
  }

  /** Adds the ms to the clock, or removes them when negative. Not while idle. */
  public adjust(ms: number) {
    this._settle();
    if (this._status !== "idle") this._add(Math.round(ms));
  }

  /** Adds the time a live event earns while the clock counts. */
  public handle<K extends TimerEvent>(type: K, data: TokioEventMap[K]) {
    this._settle();
    const counting = this._status === "running" || this._status === "paused";
    // Gifts go through the streaks even while it doesn't count, so a streak
    // begun before Start adds only what comes after it.
    if (!counting && type !== TOKIO_EVENTS.GIFT) return;
    const seconds = this._triggers[type](data);
    if (counting && seconds > 0) {
      this._add(Math.round(seconds * this._settings.multiplier * 1000));
    }
  }

  /**
   * Forgets the streaks and cooldowns, whose ends may be missed, and pauses a
   * running timer when pause_on_end is on. True when it paused.
   */
  public disconnected(): boolean {
    this._settle();
    this._streaks.clear();
    this._cooldowns.clear();
    if (!this._settings.pause_on_end || this._status !== "running") {
      return false;
    }
    this._hold("paused");
    this._unsaved = true;
    this._emit(0);
    return true;
  }

  /**
   * Saves the timer into the profile it was loaded from, as it is now. True
   * when nothing is loaded, as there's nothing to lose.
   */
  public async save(): Promise<boolean> {
    const file = this._file;
    if (!this._store || file === null) return true;
    const timer: TimerProfile = {
      settings: this._settings,
      status: this._status,
      remaining: this._left(),
    };
    this._unsaved = false;
    const saved = await this._store.updateProfileData({ timer }, file);
    // Tried again on the next interval
    if (!saved) this._unsaved = true;
    return saved;
  }

  /** The listener gets the change in ms from events or adjust, 0 for others. */
  public onChange(listener: (deltaMs: number) => void) {
    this._listeners.push(listener);
  }

  private _tick() {
    this._settle();
    const now = performance.now();
    for (const [key, until] of this._cooldowns) {
      if (until <= now) this._cooldowns.delete(key);
    }
    if (!this._unsaved && this._status !== "running") return;
    this.save().catch((error) => {
      Logger.error(
        `<Timer> Unable to save the timer -- ${formatError(error)}`,
        this._logFile,
        error,
      );
    });
  }

  private _seconds() {
    return this._settings.seconds;
  }

  private _startMs() {
    return this._settings.start * MINUTE_MS;
  }

  private _left(): number {
    if (this._status !== "running") return this._remaining;
    return Math.max(0, Math.round(this._endsAt - performance.now()));
  }

  // The seconds, at most once per chat cooldown for each viewer
  private _once(user: UserData, seconds: number): number {
    const cooldown = this._settings.chat.cooldown * 1000;
    if (seconds <= 0 || cooldown <= 0) return seconds;
    const key = user.handle || user.username;
    const now = performance.now();
    const until = this._cooldowns.get(key);
    if (until !== undefined && until > now) return 0;
    this._cooldowns.set(key, now + cooldown);
    return seconds;
  }

  // Added time stops at the cap without cutting what's there, removed at 0
  private _add(ms: number) {
    const left = this._left();
    const cap = this._settings.cap * MINUTE_MS;
    let next = left + ms;
    if (ms > 0 && cap > 0) next = Math.min(next, Math.max(left, cap));
    next = Math.max(0, next);
    const delta = next - left;
    if (delta === 0) return;

    this._unsaved = true;
    if (this._status !== "running") {
      this._remaining = next;
    } else if (next === 0) {
      this._end();
    } else {
      this._endsAt += delta;
      this._schedule();
    }
    this._emit(delta);
  }

  private _run(ms: number) {
    this._status = "running";
    this._endsAt = performance.now() + ms;
    this._schedule();
  }

  private _hold(status: "paused" | "stopped") {
    this._remaining = this._left();
    this._clearTimeout();
    this._status = status;
  }

  // A clock past its end stops at 0 before anything else happens to it, so a
  // gift right after the end can't bring it back
  private _settle() {
    if (this._status === "running" && performance.now() >= this._endsAt) {
      this._end();
      this._emit(0);
    }
  }

  private _end() {
    this._clearTimeout();
    this._status = "stopped";
    this._remaining = 0;
    this._unsaved = true;
  }

  // Waits for the end, again when it's further than a timeout can wait
  private _schedule() {
    this._clearTimeout();
    const wait = Math.min(this._endsAt - performance.now(), MAX_TIMEOUT_MS);
    this._timeout = setTimeout(
      () => {
        this._timeout = null;
        this._settle();
        if (this._status === "running") this._schedule();
      },
      Math.max(0, wait),
    );
  }

  private _clearTimeout() {
    if (this._timeout) clearTimeout(this._timeout);
    this._timeout = null;
  }

  private _emit(deltaMs: number) {
    for (const listener of this._listeners) listener(deltaMs);
  }
}
