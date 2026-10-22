import { Alert, AlertTts, Profile } from "@/common/schemas";
import {
  AppEvents,
  EMOTE_TRIGGER,
  MyInstantsSound,
  TOKIO_EVENTS,
  TokioEventMap,
} from "@/common/types";
import { formatAlertMessage, formatError, TaskQueue } from "@/common/util";
import { hasKeyword, isUser } from "@/helper/chat";
import Logger from "@/logger";
import type { TTSService } from "@/services/tts";
import { createHash } from "node:crypto";
import {
  access,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import { basename, extname, join } from "node:path";
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

export interface AlertAudio {
  data: Uint8Array;
  volume: number;
  channel: string;
  maxQueueLength: number;
  id?: string;
  // The sound's file or its TTS cache key, the same for every copy
  key: string;
  // A TTS alert's speed and pitch, for this sound only
  filters?: { speed: number; pitch: number };
}

// What TTS alerts speak with, the TTS service.
type Speaker = Pick<TTSService, "prepareText" | "generateBuffer">;

export const AUDIO_EXTENSIONS = ["mp3", "wav", "ogg"];

// Bytes of sounds kept in memory. Bigger sounds are refused, and ones saved
// before that are read from disk.
export const CACHE_MAX_BYTES = 32 * 1024 * 1024;
export const CACHE_MAX_FILE_BYTES = 8 * 1024 * 1024;

const hash = (data: string | Uint8Array) =>
  createHash("sha256").update(data).digest("hex").slice(0, 32);

export class AlertsService extends Service {
  private readonly BASE_URL = "https://www.myinstants.com";
  private readonly MAX_PER_PAGE = 36;
  // A slow MyInstants would otherwise keep the picker loading for minutes
  private readonly REQUEST_TIMEOUT_MS = 15_000;
  private _soundsFolder = "";
  // Keyed by sound file name, in least recently used order
  private _cache = new Map<string, Uint8Array>();
  private _cacheBytes = 0;
  // Reads in flight by file name, shared by the events that need the sound
  private _reading = new Map<string, Promise<Uint8Array>>();
  private _speaker: Speaker | null = null;
  // Alert messages waiting for the voice engine, see _queueSpeech
  private _speech = new TaskQueue();
  // Bumped by clearSpeech, so a message made after it is dropped
  private _speechRun = 0;

  public setLogFile(logFile: string): void {
    this._logFile = logFile;
  }

  public setSoundsFolder(folder: string): void {
    this._soundsFolder = folder;
  }

  public setSpeaker(speaker: Speaker): void {
    this._speaker = speaker;
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
  ): Promise<AlertsResult<NonNullable<Alert["sound"]>>> {
    const file = this._fileForUrl(url);
    if (await this._isSaved(file)) {
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
  public async importSound(
    srcPath: string,
  ): Promise<AlertsResult<NonNullable<Alert["sound"]>>> {
    try {
      const ext = extname(srcPath).slice(1).toLowerCase();
      if (!AUDIO_EXTENSIONS.includes(ext)) {
        throw new Error(`Unsupported audio format: ${ext}`);
      }
      this._checkSize((await stat(srcPath)).size);
      // Named by content, so importing the same file twice reuses it.
      const data = new Uint8Array(await readFile(srcPath));
      const file = `${hash(data)}.${ext}`;
      if (!(await this._isSaved(file))) {
        await this._save(file, data);
      }
      this._remember(file, data);
      return {
        success: true,
        data: { name: basename(srcPath, extname(srcPath)), file },
      };
    } catch (error) {
      return this._fail("Unable to import sound", error);
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
   * Stops the alert messages waiting to be spoken, and drops the one being
   * made.
   */
  public clearSpeech() {
    this._speechRun++;
    this._speech.stop();
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
    for (const alert of settings.items) {
      if (!this._matches(alert, type, payload)) continue;

      // By the alert's trigger, emote alerts come with chat events.
      const channel = settings.simultaneous
        ? `alerts:${alert.trigger.type}`
        : "alerts";
      const { tts, sound } = alert;
      const play = (data: Uint8Array, key: string) =>
        send({
          data,
          volume: alert.volume,
          channel,
          maxQueueLength: settings.queue_length,
          id: alert.id,
          key,
          filters: tts ? { speed: tts.speed, pitch: tts.pitch } : undefined,
        });

      // A message is spoken instead of the sound.
      if (tts) {
        this._queueSpeech(tts, payload, profile.tts, play, (error) =>
          onError?.(alert, error),
        );
        continue;
      }
      if (!sound) continue;

      // The caller reports it, once per notice
      const res = await this.readSound(sound.file, false);
      if (!res.success || !res.data) {
        onError?.(alert, res.error);
        continue;
      }
      play(res.data, basename(sound.file));
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
    const run = this._speechRun;
    this._speech.enqueue(async () => {
      const res = await this._generate(tts, text);
      // Cleared while it was being made
      if (run !== this._speechRun) return;
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

  private _matches(
    alert: Alert,
    type: AppEvents,
    payload: TokioEventMap[AppEvents],
  ) {
    if (!alert.enabled || (!alert.sound && !alert.tts)) return false;

    const chat =
      type === TOKIO_EVENTS.CHAT &&
      typeof payload === "object" &&
      payload !== null &&
      "comment" in payload
        ? payload.comment
        : null;

    // Emote alerts aren't a live event of their own, they match chats.
    if (alert.trigger.type === EMOTE_TRIGGER) {
      if (!chat) return false;
      const { emotes } = alert.trigger;
      return emotes.length === 0
        ? chat.emotes.length > 0
        : chat.emotes.some((emote) => emotes.includes(emote.emoteID));
    }

    if (alert.trigger.type !== type) return false;

    if (chat) return hasKeyword(chat.content, alert.trigger.keyword);

    if (
      (type === TOKIO_EVENTS.MEMBER_JOIN ||
        type === TOKIO_EVENTS.SUPER_FAN_JOIN) &&
      typeof payload === "object" &&
      payload !== null &&
      "user" in payload
    ) {
      return isUser(payload.user, alert.trigger.user);
    }

    if (
      type === TOKIO_EVENTS.GIFT &&
      typeof payload === "object" &&
      payload !== null &&
      "gift" in payload
    ) {
      const { gift } = payload;
      // Fire once per combo, not on every combo tick.
      if (!gift.repeatEnd) return false;
      const gifts = alert.trigger.gifts;
      return gifts.length === 0 || gifts.includes(Number(gift.id));
    }

    return true;
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
  private async _save(file: string, data: Uint8Array) {
    const path = join(this._soundsFolder, file);
    const temp = `${path}.tmp`;
    try {
      await writeFile(temp, data);
      await rename(temp, path);
    } catch (error) {
      await unlink(temp).catch(() => {});
      throw error;
    }
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

  private async _isSaved(file: string) {
    try {
      await access(join(this._soundsFolder, file));
      return true;
    } catch {
      return false;
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
