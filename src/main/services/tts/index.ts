import { Profile } from "@/common/schemas";
import { ChatEvent, VoiceData, VoiceEngine } from "@/common/types";
import {
  delay,
  formatAlertMessage,
  formatError,
  TaskQueue,
} from "@/common/util";
import { removeEmojis } from "@/helper/chat";
import { hasPermission } from "@/helper/permissions";
import Logger from "@/logger";
import { escapeRegExp } from "es-toolkit";
import { ProviderService } from "../shared";
import { GenerationResponse, TTSProvider } from "./common";
import { EdgeTTS, TikTokTTS, WindowsTTS } from "./providers";

// A message the window never says it played stops holding the next ones
// after this long, like the ones it had when it reloaded or crashed.
const HOLD_TIMEOUT_MS = 2 * 60_000;

// Every provider is an engine, and voices name the engine that speaks them.
// The active provider only speaks voices with no engine, or an unknown one.
export class TTSService extends ProviderService<TTSProvider> {
  private _queue: TaskQueue;
  // Bumped by clearTalk, so a message made after it is dropped
  private _run = 0;
  // The id of the last message sent, never reset so a late ack can't match
  private _lastId = 0;
  // Messages sent that the window hasn't finished playing
  private _held = new Set<number>();

  constructor() {
    super();
    this._queue = new TaskQueue();
    this.addProvider("Default", new TikTokTTS(), true); // NOTE: DO NOT CHANGE, Add your providers below.
    if (process.platform === "win32") {
      this.addProvider("Windows", new WindowsTTS());
    }
    this.addProvider("Edge", new EdgeTTS());
  }

  protected override _validProvider(provider: TTSProvider): boolean {
    return provider instanceof TTSProvider;
  }

  public getEngines(): VoiceEngine[] {
    return [...(this._providerPool?.entries() ?? [])].map(([id, provider]) => ({
      id,
      label: provider.label,
      keyLabel: provider.keyLabel,
    }));
  }

  public setEngineKey(engine: string, key: string) {
    this._providerPool?.get(engine)?.setKey(key);
  }

  // The voices of every engine. An engine that fails is left out.
  public async getVoices(): Promise<VoiceData[]> {
    const engines = [...(this._providerPool?.entries() ?? [])];
    const results = await Promise.allSettled(
      engines.map(async ([, provider]) => provider.getVoices()),
    );
    return results.flatMap((res, i) => {
      const [engine] = engines[i];
      if (res.status === "fulfilled") {
        return res.value.map((voice) => ({ engine, ...voice }));
      }
      Logger.error(
        `<TTS> Unable to get the ${engine} voices - ${formatError(res.reason)}`,
        this._logFile,
        res.reason,
      );
      return [];
    });
  }

  public dispose() {
    for (const provider of this._providerPool?.values() ?? []) {
      provider.dispose();
    }
  }

  // Voices saved before the engines were combined have no engine, and
  // imported profiles may name one that isn't available here.
  private _engineOf(voice?: VoiceData): TTSProvider | null {
    const engine = voice?.engine && this._providerPool?.get(voice.engine);
    return engine || this._current?.provider || null;
  }

  public async generateBuffer(
    text: string,
    voice?: VoiceData,
  ): Promise<GenerationResponse> {
    const engine = this._engineOf(voice);
    if (!engine) return { success: false };
    return await engine.generateBuffer(text, voice?.lang, voice?.name);
  }

  // The comment without its trigger, which isn't read
  private _comment(settings: Profile["tts"], chat: ChatEvent) {
    const { trigger } = settings.format;
    const content = chat.comment.content;
    if (trigger.mode === "any") return content;
    return content.slice(trigger.value.length).trim();
  }

  private _valid(settings: Profile["tts"], chat: ChatEvent, comment: string) {
    if (settings.format.trigger.mode !== "any") {
      if (!chat.comment.content.startsWith(settings.format.trigger.value)) {
        return false;
      }
    }
    // Nothing to read, like only the trigger, or only emojis when they're
    // removed
    if (this._clean(comment, settings).trim() === "") {
      return false;
    }

    // What the viewer wrote, their name included. Not the template's words.
    const { username, handle } = chat.user;
    const banned = this._hasBanned(
      [username, handle, comment].join("\n"),
      settings,
    );
    const over_length =
      chat.comment.content.length > settings.protection.comment_length;

    if (banned || over_length) return false;

    return hasPermission(settings.permissions, chat.user);
  }

  private _hasBanned(text: string, settings: Profile["tts"]) {
    const lower = text.toLowerCase();
    return settings.protection.banned.some((b) =>
      lower.includes(b.toLowerCase()),
    );
  }

  private _replace(text: string, settings: Profile["tts"]) {
    let out = text;
    for (const repl of settings.replacements) {
      if (!repl.old) continue;
      // A function keeps "$&" and the like in the new text literal.
      out = out.replace(this._replacementRegExp(repl.old), () => repl.new);
    }
    return out;
  }

  // The replacements, then the emojis they left when emojis aren't read. A
  // space keeps the words around an emoji apart ("I❤️you").
  private _clean(text: string, settings: Profile["tts"]) {
    const out = this._replace(text, settings);
    if (!settings.format.remove_emojis) return out;
    return removeEmojis(out, " ").replace(/\s+/g, " ").trim();
  }

  /**
   * Text from elsewhere than chat, such as an alert's message, with the
   * same protection: null when it has a banned word or nothing to read,
   * otherwise with the replacements applied and, when set, the emojis
   * removed.
   */
  public prepareText(text: string, settings: Profile["tts"]): string | null {
    if (this._hasBanned(text, settings)) return null;
    const out = this._clean(text, settings);
    return out.trim() === "" ? null : out;
  }

  // Matches whole words. Ends that are symbols (e.g. ":)") match anywhere,
  // because \b would need a word character there.
  private _replacementRegExp(old: string) {
    const isWord = (char: string) => /[\p{L}\p{N}_]/u.test(char);
    const start = isWord(old.at(0) ?? "") ? "(?<![\\p{L}\\p{N}_])" : "";
    const end = isWord(old.at(-1) ?? "") ? "(?![\\p{L}\\p{N}_])" : "";
    return new RegExp(`${start}${escapeRegExp(old)}${end}`, "giu");
  }

  // Filled in one pass, so a name or comment that looks like a variable is
  // read as written. A template without variables reads the comment.
  private _parseText(
    settings: Profile["tts"],
    chat: ChatEvent,
    comment: string,
  ) {
    const template = settings.format.template;
    const text = formatAlertMessage(template, {
      ...chat,
      comment: { ...chat.comment, content: comment },
    });
    const filled = template.trim() !== "" && text !== template;
    return this._clean(filled ? text : comment, settings);
  }

  /**
   * Stops the messages waiting to be spoken, and drops the one being made.
   */
  public clearTalk() {
    this._run++;
    this._held.clear();
    this._queue.stop();
  }

  /** The window finished playing the message, or dropped it. */
  public played(id: number) {
    this._held.delete(id);
  }

  /** The window reloaded, so the messages it held are gone. */
  public releaseHeld() {
    this._held.clear();
  }

  public talk(
    chat: ChatEvent,
    settings: Profile["tts"],
    callback?: (res: {
      // Sent back with played() once the window is done with it
      id: number;
      data: GenerationResponse["buffer"];
      filters: Profile["tts"]["filters"];
      queueOptions: {
        gapTime: number;
        maxQueueLength: number;
      };
    }) => void,
    // Called when the audio can't be generated
    onError?: (error?: Error) => void,
  ) {
    const comment = this._comment(settings, chat);
    if (!this._valid(settings, chat, comment)) return;
    const text = this._parseText(settings, chat, comment);
    this._queue.setQueueOptions({
      gapTime: settings.protection.cooldown,
      maxQueueLength: settings.protection.queue_length,
    });
    const run = this._run;
    this._queue.enqueue(async () => {
      // The window gets one message to play and the next one ready. The rest
      // wait here, where the queue length drops what's too many.
      const held = Math.min(2, settings.protection.queue_length);
      const until = Date.now() + HOLD_TIMEOUT_MS;
      // shortcut: polls every 250 ms, wake it from played() if the gap is heard
      while (this._held.size >= held && run === this._run) {
        if (Date.now() >= until) {
          this._held.clear();
          break;
        }
        await delay(250);
      }
      if (run !== this._run) return;

      const res = await this.generateBuffer(text, settings.voice);
      // Cleared while it was being made
      if (run !== this._run) return;
      if (res.success) {
        const id = ++this._lastId;
        this._held.add(id);
        callback?.({
          id,
          data: res.buffer,
          filters: settings.filters,
          queueOptions: {
            gapTime: settings.protection.cooldown,
            maxQueueLength: settings.protection.queue_length,
          },
        });
      } else {
        Logger.error(
          `<TTS> Unable to generate audio - ${formatError(res.error)}`,
          this._logFile,
          res.error,
        );
        onError?.(res.error);
      }
    });
  }
}
