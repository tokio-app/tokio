import { Profile } from "@/common/schemas";
import { ChatEvent, VoiceData, VoiceEngine } from "@/common/types";
import { formatError, TaskQueue } from "@/common/util";
import { removeEmojis } from "@/helper/chat";
import { hasPermission } from "@/helper/permissions";
import Logger from "@/logger";
import { ProviderService } from "../shared";
import { GenerationResponse, TTSProvider } from "./common";
import { EdgeTTS, TikTokTTS, WindowsTTS } from "./providers";

// Every provider is an engine, and voices name the engine that speaks them.
// The active provider only speaks voices with no engine, or an unknown one.
export class TTSService extends ProviderService<TTSProvider> {
  private _queue: TaskQueue;

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

  private _valid(settings: Profile["tts"], chat: ChatEvent) {
    // Nothing to read, like a comment of only emojis when they're removed
    if (this._clean(chat.comment.content, settings).trim() === "") {
      return false;
    }
    if (settings.format.trigger.mode !== "any") {
      if (!chat.comment.content.startsWith(settings.format.trigger.value)) {
        return false;
      }
    }

    const banned = this._hasBanned(chat.comment.content, settings);
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

  private _escapeRegExp(str: string) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  // Matches whole words. Ends that are symbols (e.g. ":)") match anywhere,
  // because \b would need a word character there.
  private _replacementRegExp(old: string) {
    const isWord = (char: string) => /[\p{L}\p{N}_]/u.test(char);
    const start = isWord(old.at(0) ?? "") ? "(?<![\\p{L}\\p{N}_])" : "";
    const end = isWord(old.at(-1) ?? "") ? "(?![\\p{L}\\p{N}_])" : "";
    return new RegExp(`${start}${this._escapeRegExp(old)}${end}`, "giu");
  }

  private _parseText(settings: Profile["tts"], chat: ChatEvent) {
    let template = settings.format?.template;
    const originalTemplate = template;

    let isValidTemplate = template && template.trim() !== "";

    if (isValidTemplate) {
      const variables = [
        { label: "{username}", value: chat.user.username },
        { label: "{comment}", value: chat.comment.content },
        { label: "{handle}", value: chat.user.handle },
      ];

      for (const variable of variables) {
        template = template.replaceAll(variable.label, variable.value);
      }

      if (template === originalTemplate) {
        isValidTemplate = false;
      }
    }

    if (!isValidTemplate) {
      template = chat.comment.content;
    }

    return this._clean(template, settings);
  }

  public clearTalk() {
    this._queue.stop();
  }

  public talk(
    chat: ChatEvent,
    settings: Profile["tts"],
    callback?: (res: {
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
    if (!this._valid(settings, chat)) return;
    const text = this._parseText(settings, chat);
    this._queue.setQueueOptions({
      gapTime: settings.protection.cooldown,
      maxQueueLength: settings.protection.queue_length,
    });
    this._queue.enqueue(async () => {
      const res = await this.generateBuffer(text, settings.voice);
      if (res.success) {
        callback?.({
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
