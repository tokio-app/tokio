import { MusicInfo, SongInfo, TOKIO_EVENTS } from "@/common/types";
import { cleanText } from "@/helper/chat";
import { TokioEmitter } from "../../shared/emitter";

type PlayAction = () => void | Promise<void>;

// Requests are compared like chat keywords
const requestKey = (text: string) => cleanText(text, { asciiOnly: true });

interface QueueItem {
  id: string;
  song: SongInfo;
  action: PlayAction;
  startTimeMs?: number;
}

interface QueueHooks {
  // A song failed to start.
  onError?: (id: string, error: unknown) => void;
  // A song started, with the songs as they are then.
  onStart?: (songs: MusicInfo[]) => void;
  // The ms the player still has to play of a song: 0 once another song
  // plays, null when it can't tell, like while the song is paused.
  remaining?: (song: SongInfo) => Promise<number | null>;
}

// The player is asked what's left this long before a song's listed end,
// which is rounded, and late after an ad.
const END_CHECK_MS = 5000;
// The next song starts this early, so a song's last moment, often silent,
// covers part of the time the player takes to switch.
const START_LEAD_MS = 300;
// Taken as the length of a song whose length didn't parse, so the player is
// first asked once it has loaded the song.
// shortcut: when the player can't tell either, such a song plays 15 s, or
// 10 s when it reports no length; parse more formats if songs get cut.
const UNKNOWN_LENGTH_MS = 3 * END_CHECK_MS;

const delayWithAbort = (ms: number, signal?: AbortSignal) => {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) return resolve();

    const timeoutId = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timeoutId);
      resolve();
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
};

export class MusicQueue extends TokioEmitter {
  private _queue: QueueItem[];
  private _currentIndex: number;
  private _isPlaying: boolean;
  private _abortController: AbortController | null;
  private _maxSize: number;
  private _hooks: QueueHooks;

  constructor(hooks: QueueHooks = {}) {
    super();
    this._queue = [];
    this._currentIndex = 0;
    this._isPlaying = false;
    this._abortController = null;
    this._maxSize = Infinity;
    this._hooks = hooks;
  }

  /**
   * Configures the maximum size of the queue dynamically.
   * If the queue is already larger than the new size, it will immediately trim it.
   */
  public setMaxSize(size: number) {
    this._maxSize = Math.max(1, size); // Ensure size is at least 1
    this._trimQueue();
  }

  /**
   * Enforces the maximum queue size by removing history first.
   * If there is no history, it removes from the end of the queue.
   */
  private _trimQueue() {
    while (this._queue.length > this._maxSize) {
      if (this._currentIndex > 0) {
        this._queue.shift();
        this._currentIndex--;
      } else {
        this._queue.pop();
      }
    }
  }

  public enqueue(id: string, song: SongInfo, action: PlayAction) {
    this._queue.push({ id, song, action });
    this._trimQueue();
    this.play();
  }

  // The song the player is playing. Its action plays it when the queue
  // comes back to it.
  public addCurrentlyPlaying(
    id: string,
    song: SongInfo,
    currentTimeMs: number,
    action: PlayAction,
  ) {
    this._queue.push({ id, song, action, startTimeMs: currentTimeMs });
    this._trimQueue();
    this.play();
  }

  public play() {
    // The loop emits when it starts a song.
    if (!this._isPlaying && this._currentIndex < this._queue.length) {
      this.processQueue();
    } else {
      this.emit(TOKIO_EVENTS.MUSIC_CHANGE, this.getSongs());
    }
  }

  public pause() {
    this._isPlaying = false;
    this._abortController?.abort();
  }

  public clear() {
    this.pause();
    this._queue = [];
    this._currentIndex = 0;
  }

  // Removes every request for the song that's still waiting, whatever its
  // case, spaces and accents. Songs that played or are playing stay.
  public revoke(id: string) {
    const key = requestKey(id);
    if (!key) return;
    const kept = this._queue.filter(
      (item, index) =>
        index <= this._currentIndex || requestKey(item.id) !== key,
    );
    if (kept.length === this._queue.length) return;

    this._queue = kept;
    this.emit(TOKIO_EVENTS.MUSIC_CHANGE, this.getSongs());
  }

  public async triggerNext() {
    if (this._currentIndex < this._queue.length - 1) {
      this.pause();
      this._currentIndex++;

      await Promise.resolve();
      this.play();
    }
  }

  public async triggerPrevious() {
    if (this._currentIndex > 0) {
      this.pause();
      this._currentIndex--;

      await Promise.resolve();
      this.play();
    }
  }

  // Playing, or stopped at a song the player couldn't start
  public getQueueState() {
    return {
      isPlaying: this._isPlaying || this._currentIndex < this._queue.length,
    };
  }

  public getSongs(): MusicInfo[] {
    return this._queue.map((m, i) => ({
      title: m.song.title,
      thumbnail: m.song.thumbnail,
      playing: this._currentIndex === i,
      played: this._currentIndex > i,
    }));
  }

  private async processQueue() {
    this._isPlaying = true;
    // A loop stopped while awaiting can wake up after a new one started.
    const controller = (this._abortController = new AbortController());
    const active = () => !controller.signal.aborted;
    let failures = 0;

    while (this._currentIndex < this._queue.length && active()) {
      const item = this._queue[this._currentIndex];

      this.emit(TOKIO_EVENTS.MUSIC_CHANGE, this.getSongs());

      // A song that fails to start is skipped right away. Two in a row mean
      // the player is gone: the loop goes back to the first and stops there,
      // so a new request tries both again and no song is lost.
      let waitTime = 0;
      try {
        // Playing the player's own song again would restart it
        if (item.startTimeMs === undefined) {
          await item.action();
          // Not for a song skipped while it loaded
          if (active()) this._hooks.onStart?.(this.getSongs());
        }
        failures = 0;
        waitTime =
          item.startTimeMs !== undefined
            ? Math.max(0, item.song.duration - item.startTimeMs)
            : item.song.duration;
        if (item.song.duration <= 0) waitTime = UNKNOWN_LENGTH_MS;
      } catch (error) {
        this._hooks.onError?.(item.id, error);
        if (++failures === 2 && active()) {
          this._currentIndex--;
          this.emit(TOKIO_EVENTS.MUSIC_CHANGE, this.getSongs());
          break;
        }
      }

      item.startTimeMs = undefined;

      if (active() && waitTime > 0) {
        await this._waitForEnd(item.song, waitTime, controller.signal);
      }

      if (!active()) break;

      this._currentIndex++;
    }

    if (this._abortController === controller) this._isPlaying = false;
  }

  // Until the song ends, by what the player says is left near its listed
  // end, and by the listed time when the player can't tell.
  private async _waitForEnd(
    song: SongInfo,
    waitTime: number,
    signal: AbortSignal,
  ) {
    const listedEnd = Date.now() + waitTime;
    const { remaining } = this._hooks;
    if (!remaining) return delayWithAbort(waitTime, signal);

    await delayWithAbort(Math.max(0, waitTime - END_CHECK_MS), signal);
    while (!signal.aborted) {
      const left = await remaining(song).catch(() => null);
      if (left === null) {
        // shortcut: a song paused past its listed end is cut, which also
        // restarts music after YouTube's "Continue watching?"; wait out
        // pauses if streamers ask
        await delayWithAbort(Math.max(0, listedEnd - Date.now()), signal);
        return;
      }
      // Still far from the end, like after an ad: asked again near it
      if (left > END_CHECK_MS) {
        await delayWithAbort(left - END_CHECK_MS, signal);
        continue;
      }
      // One timer from here: asked again this close to the end, a slow
      // player like Spotify's API would answer after it
      if (left > START_LEAD_MS) {
        await delayWithAbort(left - START_LEAD_MS, signal);
      }
      return;
    }
  }
}
