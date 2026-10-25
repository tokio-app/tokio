import {
  Alert,
  AlertSound,
  AlertTts,
  MediaFile,
  Profile,
} from "@/common/schemas";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  AppEvents,
  AppEventsMap,
  AppEventsResponseMap,
  MyInstantsSound,
  TOKIO_EVENTS,
  TokioEventMap,
} from "@/common/types";
import {
  ALERTS_PATH,
  AUDIO_EXTENSIONS,
  formatAlertMessage,
  formatError,
  MEDIA_EXTENSIONS,
  mediaKind,
  TaskQueue,
} from "@/common/util";
import { writeFileAtomic } from "@/helper/fs";
import { hash, importFile, isSaved } from "@/helper/library";
import { GiftStreaks } from "@/helper/streaks";
import { giftOf, matchesTrigger } from "@/helper/triggers";
import Logger from "@/logger";
import type { ServerService } from "@/services/server";
import type { TTSService } from "@/services/tts";
import { readFile, unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { Service } from "../shared";

export interface AlertsResult<T> {
  success: boolean;
  error?: string;
  data?: T;
}

export interface MyInstantsPage {
  sounds: MyInstantsSound[];
  hasNextPage: boolean;
}

export type AlertAudio = AppEventsResponseMap[APP_EVENTS_RESPONSE.ALERT_AUDIO];

// What TTS alerts speak with, the TTS service.
type Speaker = Pick<TTSService, "prepareText" | "generateBuffer">;

// Sends alert media to the overlays connected with the alert's id.
type Server = Pick<ServerService, "sendToClient">;

// Media is streamed from disk to the overlays, never kept in memory.
export const MEDIA_MAX_BYTES = 50 * 1024 * 1024;

// What the alert overlay page (services/server/alert.html) reads
const SHOW_MEDIA = "tokio:alert:media";
const CLEAR_MEDIA = "tokio:alert:clear";

// Node fires timeouts longer than 2^31 ms at once.
const MAX_SECONDS = 24 * 60 * 60;

const clamp = (value: number, max: number) => Math.min(Math.max(value, 0), max);

// Bytes of sounds kept in memory. Bigger sounds are refused, and ones saved
// before that are read from disk.
export const CACHE_MAX_BYTES = 32 * 1024 * 1024;
export const CACHE_MAX_FILE_BYTES = 8 * 1024 * 1024;

export class AlertsService extends Service {
  private readonly BASE_URL = "https://www.myinstants.com";
  private readonly MAX_PER_PAGE = 36;
  // A slow MyInstants would otherwise keep the picker loading for minutes
  private readonly REQUEST_TIMEOUT_MS = 15_000;
  private _soundsFolder = "";
  private _mediaFolder = "";
  private _server: Server | null = null;
  // Media waiting for its turn, see showMedia
  private _shows = new Set<NodeJS.Timeout>();
  // Alerts whose overlay showed media since the last clear
  private _shown = new Set<string>();
  // Keyed by sound file name, in least recently used order
  private _cache = new Map<string, Uint8Array>();
  private _cacheBytes = 0;
  // Reads in flight by file name, shared by the events that need the sound
  private _reading = new Map<string, Promise<Uint8Array>>();
  private _speaker: Speaker | null = null;
  // Alert messages waiting for the voice engine, see _queueSpeech
  private _speech = new TaskQueue();
  // Bumped by clear, so a sound read or a message made after it is dropped
  private _run = 0;
  // Each viewer's streak of a gift, see GiftStreaks
  private _streaks = new GiftStreaks();

  public setLogFile(logFile: string): void {
    this._logFile = logFile;
  }

  public setSoundsFolder(folder: string): void {
    this._soundsFolder = folder;
  }

  public setMediaFolder(folder: string): void {
    this._mediaFolder = folder;
  }

  public setSpeaker(speaker: Speaker): void {
    this._speaker = speaker;
  }

  public setServer(server: Server): void {
    this._server = server;
  }

  /**
   * Gets trending/latest sounds from the homepage.
   */
  public async getTrending(
    page: number = 1,
  ): Promise<AlertsResult<MyInstantsPage>> {
    const url = new URL(this.BASE_URL);
    if (page > 1) url.searchParams.append("page", page.toString());
    return this._fetchPage(url, page);
  }

  /**
   * Searches MyInstants for sounds matching the query.
   */
  public async search(
    query: string,
    page: number = 1,
  ): Promise<AlertsResult<MyInstantsPage>> {
    const url = new URL(`${this.BASE_URL}/search/`);
    url.searchParams.append("name", query);
    url.searchParams.append("page", page.toString());
    return this._fetchPage(url, page);
  }

  /**
   * Gets a MyInstants sound without saving it, e.g. for previews.
   * Uses memory or the downloaded file before going to the network.
   */
  public async fetchSound(url: string): Promise<AlertsResult<Uint8Array>> {
    try {
      if (!this._isMyInstantsUrl(url)) {
        throw new Error(`Refusing to fetch non MyInstants url: ${url}`);
      }

      const file = this._fileForUrl(url);
      const local = await this.readSound(file, false);
      if (local.success) return local;

      const response = await this._fetch(url);
      if (!response.ok) {
        throw new Error(`MyInstants responded with status: ${response.status}`);
      }
      const data = new Uint8Array(await response.arrayBuffer());
      this._checkSize(data.byteLength);
      this._remember(file, data);
      return { success: true, data };
    } catch (error) {
      return this._fail("Unable to fetch sound", error);
    }
  }

  /**
   * Downloads a MyInstants sound into the sounds folder.
   * A sound is only written once, however many alerts use it.
   */
  public async downloadSound(
    url: string,
    name: string,
  ): Promise<AlertsResult<AlertSound>> {
    const file = this._fileForUrl(url);
    if (await isSaved(join(this._soundsFolder, file))) {
      return { success: true, data: { name, file } };
    }

    const res = await this.fetchSound(url);
    if (!res.success || !res.data) return { success: false, error: res.error };

    try {
      await this._save(file, res.data);
      return { success: true, data: { name, file } };
    } catch (error) {
      return this._fail("Unable to save sound", error);
    }
  }

  /**
   * Copies a local audio file into the sounds folder.
   */
  public async importSound(srcPath: string): Promise<AlertsResult<AlertSound>> {
    try {
      const { data, entry } = await importFile(
        srcPath,
        this._soundsFolder,
        AUDIO_EXTENSIONS,
        CACHE_MAX_FILE_BYTES,
      );
      this._remember(entry.file, data);
      return { success: true, data: entry };
    } catch (error) {
      return this._fail("Unable to import sound", error);
    }
  }

  /**
   * Copies a local image or video into the media folder.
   */
  public async importMedia(srcPath: string): Promise<AlertsResult<MediaFile>> {
    try {
      const { entry } = await importFile(
        srcPath,
        this._mediaFolder,
        MEDIA_EXTENSIONS,
        MEDIA_MAX_BYTES,
      );
      return { success: true, data: entry };
    } catch (error) {
      return this._fail("Unable to import media", error);
    }
  }

  public async deleteMedia(file: string): Promise<AlertsResult<void>> {
    try {
      await unlink(join(this._mediaFolder, basename(file)));
      return { success: true };
    } catch (error) {
      return this._fail("Unable to delete media", error);
    }
  }

  public async deleteSound(file: string): Promise<AlertsResult<void>> {
    const name = basename(file);
    this._forget(name);
    this._reading.delete(name);
    try {
      await unlink(join(this._soundsFolder, name));
      return { success: true };
    } catch (error) {
      return this._fail("Unable to delete sound", error);
    }
  }

  public async readSound(
    file: string,
    logMissing: boolean = true,
  ): Promise<AlertsResult<Uint8Array>> {
    // basename keeps a stored value from pointing outside the sounds folder
    const name = basename(file);
    const cached = this._cache.get(name);
    if (cached) {
      this._remember(name, cached);
      return { success: true, data: cached };
    }

    try {
      return { success: true, data: await this._read(name) };
    } catch (error) {
      if (!logMissing) return { success: false, error: formatError(error) };
      return this._fail("Unable to read sound", error);
    }
  }

  /**
   * Speaks a TTS alert's message, filled with the live event's values. The
   * TTS settings' banned words and replacements apply: skipped is set when
   * there's nothing to say.
   */
  public async speak(
    tts: AlertTts,
    payload: TokioEventMap[AppEvents],
    settings: Profile["tts"],
  ): Promise<AlertsResult<Uint8Array> & { skipped?: boolean }> {
    const text = this._message(tts, payload, settings);
    if (text === null) return { success: false, skipped: true };
    return this._generate(tts, text);
  }

  /**
   * Shows an alert's media on the alert's overlay in `delay` seconds, when its
   * turn in the window's queue comes. The window times the queue, main sends,
   * so clear() can drop the media still waiting.
   */
  public showMedia({
    id,
    file,
    delay,
    duration,
    volume,
  }: AppEventsMap[APP_EVENTS.SHOW_ALERT_MEDIA]) {
    const kind = mediaKind(file);
    if (
      basename(file) !== file ||
      !kind ||
      ![delay, duration, volume].every(Number.isFinite)
    ) {
      Logger.warn(
        `<Alerts> Refused to show "${file}" on the overlay of alert ${id}.`,
        this._logFile,
      );
      return;
    }

    const timer = setTimeout(
      () => {
        this._shows.delete(timer);
        const sent = this._server?.sendToClient(id, {
          type: SHOW_MEDIA,
          data: {
            src: `/${ALERTS_PATH}/media/${file}`,
            kind,
            duration: clamp(duration, MAX_SECONDS),
            volume: clamp(volume, 100),
          },
        });
        if (sent) this._shown.add(id);
      },
      clamp(delay, MAX_SECONDS) * 1000,
    );
    this._shows.add(timer);
  }

  /**
   * Stops the alert messages waiting to be spoken, drops the one being made,
   * the sounds being read and the media waiting for its turn, hides the media
   * on the overlays and forgets the gift streaks, as their ends may be missed.
   */
  public clear() {
    this._run++;
    this._speech.stop();
    this._streaks.clear();
    for (const timer of this._shows) clearTimeout(timer);
    this._shows.clear();
    for (const id of this._shown) {
      this._server?.sendToClient(id, { type: CLEAR_MEDIA });
    }
    this._shown.clear();
  }

  /**
   * Plays every enabled alert that matches the live event.
   */
  public async handle<K extends AppEvents>(
    type: K,
    payload: TokioEventMap[K],
    profile: Pick<Profile, "alerts" | "tts">,
    send: (audio: AlertAudio) => void,
    // Called for an alert whose sound can't be read or spoken
    onError?: (alert: Alert, error?: string) => void,
  ) {
    const settings = profile.alerts;
    const run = this._run;
    // Once per event, whichever alerts it plays
    const gift = giftOf(type, payload);
    const { added, total } = gift
      ? this._streaks.add(gift)
      : { added: 0, total: 0 };
    // A message's {count} is the streak's count so far, not TikTok's
    const speech = gift
      ? { ...gift, gift: { ...gift.gift, comboCount: total } }
      : payload;
    for (const alert of settings.items) {
      if (!alert.enabled || (!alert.sound && !alert.tts && !alert.media)) {
        continue;
      }
      if (!matchesTrigger(alert.trigger, type, payload, added, total)) continue;

      // An alert on every gift plays once for each, as many as the queue takes
      const times =
        alert.trigger.type === TOKIO_EVENTS.GIFT && alert.trigger.every_gift
          ? Math.min(added, settings.queue_length)
          : 1;
      // By the alert's trigger, emote alerts come with chat events.
      const channel = settings.simultaneous
        ? `alerts:${alert.trigger.type}`
        : "alerts";
      const { tts, sound, media } = alert;
      // Sent once, and the window queues its copies
      const play = (
        data?: Uint8Array,
        key?: string,
        cut?: Pick<AlertAudio, "start" | "end">,
      ) =>
        send({
          data,
          volume: alert.volume,
          channel,
          maxQueueLength: settings.queue_length,
          id: alert.id,
          key,
          filters: tts ? { speed: tts.speed, pitch: tts.pitch } : undefined,
          media: media ?? undefined,
          repeat: times,
          ...cut,
        });

      // A message is spoken instead of the sound.
      if (tts) {
        this._queueSpeech(tts, speech, profile.tts, play, (error) =>
          onError?.(alert, error),
        );
        continue;
      }
      // Media alone still takes its turn in the window's queue.
      if (!sound) {
        play();
        continue;
      }

      // The caller reports it, once per notice
      const res = await this.readSound(sound.file, false);
      // Cleared while it was read
      if (run !== this._run) return;
      if (!res.success || !res.data) {
        onError?.(alert, res.error);
        continue;
      }
      play(res.data, basename(sound.file), {
        start: sound.start,
        end: sound.end ?? undefined,
      });
    }
  }

  /**
   * Like chat TTS: messages are made one at a time, with the TTS cooldown
   * between them and no more than its queue length waiting, so a burst of
   * events can't flood the voice engine. The rest are dropped.
   */
  private _queueSpeech(
    tts: AlertTts,
    payload: TokioEventMap[AppEvents],
    settings: Profile["tts"],
    play: (data: Uint8Array, key: string) => void,
    onError: (error?: string) => void,
  ) {
    // Checked before queueing, so blocked messages don't take a place.
    const text = this._message(tts, payload, settings);
    if (text === null) return;

    const { cooldown, queue_length } = settings.protection;
    this._speech.setQueueOptions({
      gapTime: cooldown,
      maxQueueLength: queue_length,
    });
    const run = this._run;
    this._speech.enqueue(async () => {
      const res = await this._generate(tts, text);
      // Cleared while it was being made
      if (run !== this._run) return;
      if (res.success && res.data) play(res.data, this._ttsKey(tts, text));
      else onError(res.error);
    });
  }

  // The message filled with the event, null when the TTS settings block it.
  private _message(
    tts: AlertTts,
    payload: TokioEventMap[AppEvents],
    settings: Profile["tts"],
  ): string | null {
    const text = formatAlertMessage(tts.message, payload);
    if (!this._speaker) return text;
    // Like chat TTS, banned words are checked in the event's values only.
    const variables = (tts.message.match(/\{\w+\}/g) ?? []).join("\n");
    const values = formatAlertMessage(variables, payload);
    return this._speaker.prepareText(text, settings, values);
  }

  private async _generate(
    tts: AlertTts,
    text: string,
  ): Promise<AlertsResult<Uint8Array>> {
    try {
      if (!this._speaker) throw new Error("No TTS to speak with.");

      // Fixed messages, like a thanks for following, are only made once.
      const key = this._ttsKey(tts, text);
      const cached = this._cache.get(key);
      if (cached) {
        this._remember(key, cached);
        return { success: true, data: cached };
      }

      const res = await this._speaker.generateBuffer(text, tts.voice);
      if (!res.success || !res.buffer) {
        throw res.error ?? new Error("The engine returned no audio.");
      }
      const data = new Uint8Array(res.buffer);
      this._remember(key, data);
      return { success: true, data };
    } catch (error) {
      return this._fail("Unable to speak alert", error);
    }
  }

  private _ttsKey({ voice }: AlertTts, text: string) {
    return `tts:${hash(`${voice.engine}|${voice.lang}|${voice.name}|${text}`)}`;
  }

  private async _fetchPage(
    url: URL,
    page: number,
  ): Promise<AlertsResult<MyInstantsPage>> {
    try {
      if (page < 1) throw new Error("Page must be a positive integer.");

      const response = await this._fetch(url.toString());

      if (!response.ok) {
        if (response.status === 404) {
          return { success: true, data: { sounds: [], hasNextPage: false } };
        }
        throw new Error(`MyInstants responded with status: ${response.status}`);
      }

      const sounds = await this._parseSoundsFromHtml(await response.text());

      return {
        success: true,
        data: { sounds, hasNextPage: sounds.length === this.MAX_PER_PAGE },
      };
    } catch (error) {
      return this._fail("Unable to fetch MyInstants page", error);
    }
  }

  /**
   * Parses the HTML to extract sound buttons.
   */
  private async _parseSoundsFromHtml(html: string): Promise<MyInstantsSound[]> {
    // Loaded on the first search. The slim build skips parse5 and undici.
    const { load } = await import("cheerio/slim");
    const $ = load(html);
    const sounds: MyInstantsSound[] = [];

    $("#instants_container > div.instants.result-page > .instant").each(
      (_, element) => {
        const name = $(element).find("a.instant-link").text().trim();
        const playScript = $(element)
          .find("button.small-button")
          .attr("onclick");

        const match = playScript?.match(/play\('([^']+)'/);
        if (name && match?.[1]) {
          const url = `${this.BASE_URL}${match[1]}`;
          sounds.push({ name, url, file: this._fileForUrl(url) });
        }
      },
    );

    return sounds;
  }

  // The signal also covers reading the body.
  private _fetch(url: string) {
    return fetch(url, { signal: AbortSignal.timeout(this.REQUEST_TIMEOUT_MS) });
  }

  private _fileForUrl(url: string) {
    return `${hash(url)}.mp3`;
  }

  // Whole or not at all: names are hashes, so a half-written file would pass
  // for the sound forever
  private _save(file: string, data: Uint8Array) {
    return writeFileAtomic(join(this._soundsFolder, file), data);
  }

  private _read(name: string): Promise<Uint8Array> {
    const pending = this._reading.get(name);
    if (pending) return pending;
    const read = readFile(join(this._soundsFolder, name))
      .then((buf) => {
        const data = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
        // Not when the sound was deleted while it was read
        if (this._reading.get(name) === read) this._remember(name, data);
        return data;
      })
      .finally(() => {
        if (this._reading.get(name) === read) this._reading.delete(name);
      });
    this._reading.set(name, read);
    return read;
  }

  private _checkSize(bytes: number) {
    if (bytes > CACHE_MAX_FILE_BYTES) {
      throw new Error(`The sound is over ${CACHE_MAX_FILE_BYTES} bytes.`);
    }
  }

  private _remember(file: string, data: Uint8Array) {
    this._forget(file);
    if (data.byteLength > CACHE_MAX_FILE_BYTES) return;
    this._cache.set(file, data);
    this._cacheBytes += data.byteLength;
    // Maps keep insertion order, so the first key is the least recently used.
    for (const oldest of this._cache.keys()) {
      if (this._cacheBytes <= CACHE_MAX_BYTES) break;
      this._forget(oldest);
    }
  }

  private _forget(file: string) {
    const data = this._cache.get(file);
    if (!data) return;
    this._cache.delete(file);
    this._cacheBytes -= data.byteLength;
  }

  private _isMyInstantsUrl(url: string) {
    try {
      return new URL(url).origin === this.BASE_URL;
    } catch {
      return false;
    }
  }

  private _fail(action: string, error: unknown) {
    const message = formatError(error);
    Logger.error(`<Alerts> ${action} -- ${message}`, this._logFile, error);
    return { success: false, error: message };
  }
}
