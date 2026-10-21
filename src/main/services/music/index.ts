import { Profile } from "@/common/schemas";
import {
  ChatEvent,
  MusicInfo,
  TOKIO_EVENTS,
  TokioEventMap,
} from "@/common/types";
import { formatError, TaskQueue } from "@/common/util";
import { hasPermission } from "@/helper/permissions";
import Logger from "@/logger";
import { ProviderService } from "@/services/shared";
import { ConnectionResponse, MusicProvider, MusicQueue } from "./common";
import { Spotify, YouTubeMusic } from "./providers";

export class MusicService extends ProviderService<MusicProvider> {
  private _queue: TaskQueue;
  private _music_queue: MusicQueue;
  private _onPlaybackError?: (id: string, error: unknown) => void;
  private _onSongChange?: (songs: MusicInfo[]) => void;
  // When the last command was taken, for the cooldown
  private _lastCommand = -Infinity;
  constructor() {
    super();
    this._queue = new TaskQueue();
    this._music_queue = new MusicQueue({
      onError: (id, error) => this._playbackFailed(id, error),
      onStart: (songs) => this._onSongChange?.(songs),
      // What's left of the song while the player plays it, after an ad
      // too. Paused, it can't tell when the song ends. Times are in ms.
      remaining: async (song) => {
        const sent = Date.now();
        const status = await this._current.provider.playerStatus();
        if (!status) return null;
        if (status.track !== song.track && status.title !== song.title) {
          return 0;
        }
        if (!status.playing) return null;
        // The player read its time about halfway through the request
        const age = (Date.now() - sent) / 2;
        return Math.max(0, status.duration - status.time - age);
      },
    });
    this.addProvider("YouTube", new YouTubeMusic(), true);
    this.addProvider("Spotify", new Spotify());
  }

  public override setLogFile(logFile: string): void {
    super.setLogFile(logFile);
    this._providerPool.forEach((provider) => provider.setLogFile(logFile));
  }

  public connect(): Promise<ConnectionResponse> {
    return this._current.provider.connect();
  }

  public disconnect() {
    this.clearHandler();
    this._current.provider.disconnect();
  }

  public isActive() {
    return this._current.provider.isActive();
  }

  public on<K extends TOKIO_EVENTS>(
    event: K,
    listener: (data: TokioEventMap[K]) => void,
  ): void {
    this._current.provider.on(event, listener);
    this._music_queue.on(event, listener);
  }

  public off<K extends TOKIO_EVENTS>(
    event: K,
    listener: (data: TokioEventMap[K]) => void,
  ): void {
    this._current.provider.off(event, listener);
    this._music_queue.off(event, listener);
  }

  // Called when a requested track can't be played.
  public onPlaybackError(listener: (id: string, error: unknown) => void) {
    this._onPlaybackError = listener;
  }

  // Called once when a song starts, unlike MUSIC_CHANGE, which also comes
  // when the queue changes.
  public onSongChange(listener: (songs: MusicInfo[]) => void) {
    this._onSongChange = listener;
  }

  public clearHandler() {
    this._queue.stop();
    this._music_queue.clear();
  }

  public handle(chat: ChatEvent, settings: Profile["music"]) {
    const match = this._match(settings, chat);
    if (!match) return;
    // One command per cooldown, whoever sends it
    const now = Date.now();
    if (now - this._lastCommand < settings.protection.cooldown * 1000) return;
    this._lastCommand = now;
    const { control, args } = match;

    this._queue.setQueueOptions({
      maxQueueLength: settings.protection.queue_length,
    });

    this._music_queue.setMaxSize(settings.protection.queue_length);

    const { controls } = settings;
    if (control === controls.play) {
      this._queue.enqueue(() => this._request(args));
    } else if (control === controls.next) {
      this._queue.enqueue(() => this.next());
    } else if (control === controls.last) {
      this._queue.enqueue(() => this.previous());
    } else if (control === controls.revoke) {
      this._queue.enqueue(() => this.revoke(args));
    }
  }

  // A song request that can't be found or started is reported like a song
  // that couldn't be played.
  private async _request(query: string) {
    try {
      await this.play(query);
    } catch (error) {
      this._playbackFailed(query, error);
    }
  }

  private _playbackFailed(id: string, error: unknown) {
    Logger.error(
      `<Music> Unable to play track [${id}] -- ${formatError(error)}`,
      this._logFile,
      error,
    );
    this._onPlaybackError?.(id, error);
  }

  private async play(query: string) {
    if (!this._music_queue.getQueueState().isPlaying) {
      const current = await this._current.provider.playerStatus();
      if (current && current.playing) {
        this._music_queue.addCurrentlyPlaying(
          current.title,
          current,
          current.time,
        );
      }
    }

    const info = await this._current.provider.searchSong(query);

    if (info === null) return;

    this._music_queue.enqueue(query, info, () =>
      this._current.provider.play(info),
    );
  }

  private async next() {
    await this._music_queue.triggerNext();
  }

  private async previous() {
    await this._music_queue.triggerPrevious();
  }

  private async revoke(query: string) {
    this._music_queue.revoke(query);
  }

  // The control a chat calls, with its command in any case, alone or followed
  // by a space and the args. Empty commands call nothing. Null when the
  // control is off or the viewer may not use it.
  private _match(settings: Profile["music"], chat: ChatEvent) {
    const { content } = chat.comment;
    const control = Object.values(settings.controls).find(({ command }) => {
      const name = command.trim().toLowerCase();
      if (!name) return false;
      if (content.slice(0, name.length).toLowerCase() !== name) return false;
      const next = content.charAt(name.length);
      return next === "" || /\s/.test(next);
    });
    if (!control?.enabled) return null;
    if (!hasPermission(settings.permissions, chat.user)) return null;

    return {
      control,
      args: content.slice(control.command.trim().length).trim(),
    };
  }
}
