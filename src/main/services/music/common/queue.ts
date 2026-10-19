import {
  MusicInfo,
  SongInfo,
  TOKIO_EVENTS,
  TokioEventMap,
} from "@/common/types";
import { cleanText } from "@/helper/chat";
import EventEmitter from "node:events";

type PlayAction = () => void | Promise<void>;

// Requests are compared like chat keywords
const requestKey = (text: string) => cleanText(text, { asciiOnly: true });

interface QueueItem {
  id: string;
  song: SongInfo;
  action: PlayAction;
  startTimeMs?: number;
}

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

export class MusicQueue {
  private _queue: QueueItem[];
  private _currentIndex: number;
  private _isPlaying: boolean;
  private _abortController: AbortController | null;
  private _events: EventEmitter;
  private _maxSize: number;
  private _onError?: (id: string, error: unknown) => void;

  constructor(
    maxSize: number = Infinity,
    onError?: (id: string, error: unknown) => void,
  ) {
    this._queue = [];
    this._currentIndex = 0;
    this._isPlaying = false;
    this._abortController = null;
    this._events = new EventEmitter();
    this._maxSize = maxSize;
    this._onError = onError;
  }

  /**
   * Configures the maximum size of the queue dynamically.
   * If the queue is already larger than the new size, it will immediately trim it.
   */
  public setMaxSize(size: number) {
    this._maxSize = Math.max(1, size); // Ensure size is at least 1
    this._trimQueue();
  }

  public getMaxSize(): number {
    return this._maxSize;
  }

  public on<K extends TOKIO_EVENTS>(
    event: K,
    listener: (data: TokioEventMap[K]) => void,
  ): void {
    this._events.on(event, listener);
  }

  public off<K extends TOKIO_EVENTS>(
    event: K,
    listener: (data: TokioEventMap[K]) => void,
  ): void {
    this._events.off(event, listener);
  }

  private emit<K extends TOKIO_EVENTS>(
    event: K,
    data?: TokioEventMap[K],
  ): void {
    this._events.emit(event, data);
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

  public addCurrentlyPlaying(
    id: string,
    song: SongInfo,
    currentTimeMs: number,
  ) {
    this._queue.push({
      id,
      song,
      action: () => {},
      startTimeMs: currentTimeMs,
    });
    this._trimQueue();
    this.play();
  }

  public play() {
    if (!this._isPlaying && this._currentIndex < this._queue.length) {
      this.processQueue();
    }
    this.emit(TOKIO_EVENTS.MUSIC_CHANGE, this.getSongs());
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

  public async triggerAt(index: number) {
    if (index >= 0 && index < this._queue.length) {
      this.pause();
      this._currentIndex = index;

      await Promise.resolve();
      this.play();
    }
  }

  public triggerById(id: string) {
    const index = this._queue.findIndex((item) => item.id === id);
    if (index !== -1) {
      this.triggerAt(index);
    }
  }

  public getQueueState() {
    return {
      isPlaying: this._isPlaying,
      maxSize: this._maxSize,
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
    this._abortController = new AbortController();

    while (this._currentIndex < this._queue.length && this._isPlaying) {
      const item = this._queue[this._currentIndex];

      this.emit(TOKIO_EVENTS.MUSIC_CHANGE, this.getSongs());

      try {
        await item.action();
      } catch (error) {
        this._onError?.(item.id, error);
      }

      const waitTime =
        item.startTimeMs !== undefined
          ? Math.max(0, item.song.duration - item.startTimeMs)
          : item.song.duration;

      item.startTimeMs = undefined;

      if (this._isPlaying && waitTime > 0) {
        await delayWithAbort(waitTime, this._abortController.signal);
      }

      if (!this._isPlaying) break;

      this._currentIndex++;
    }

    this._isPlaying = false;
  }
}
