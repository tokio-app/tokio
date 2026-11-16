import { ChatEvent, ChatTranslation, TranslationTest } from "@/common/types";
import { baseLanguage, delay, TRANSLATION_LANGUAGES } from "@/common/util";
import { hasKeyword, startsWithCommand } from "@/helper/chat";
import { Service } from "../shared";
import { Translated, TranslationError } from "./common";
import { translateWithGoogle } from "./providers/google";

// Repeats like "hi" are translated once
export const CACHE_SIZE = 500;
// How long translation rests after Google failed
export const PAUSE_MS = 60_000;
// Google refused 3 requests a second after about 60, and took 1 a second for
// minutes, bursts of 10 included (measured 2026-11-15). So requests go out at
// RATE_PER_SECOND, after a burst of up to RATE_BURST.
const RATE_PER_SECOND = 1;
export const RATE_BURST = 10;
// A message that would wait longer for its turn goes on as typed
export const MAX_WAIT_MS = 2000;

// The chat commands and keywords of the features that answer them, which
// stay as typed
export interface ChatCommands {
  // The TTS trigger, "" when TTS reads every message. It stays as typed at
  // the start, and the rest is translated.
  trigger: string;
  // Music controls' and overlays' commands, at the start of a message
  commands: string[];
  // The keywords of chat triggers that are on, anywhere in a message
  keywords: string[];
}

// A TikTok handle, not inside a word like an email address. It can't end in
// a dot, so a sentence's full stop stays out.
const MENTION = String.raw`(?<![\p{L}\p{N}_])@[\p{L}\p{N}_]+(?:\.[\p{L}\p{N}_]+)*`;
const LEADING = new RegExp(String.raw`^\s*(?:${MENTION}\s*)*`, "u");
const TRAILING = new RegExp(String.raw`(?:\s*${MENTION})*\s*$`, "u");
const MENTIONS = new RegExp(MENTION, "gu");
// What stands in for a mention in the middle, which Google keeps
const STAND_IN = /<\d+>/;
const standIn = (index: number) => `<${index}>`;
const LETTER = /\p{L}/u;

// A message split into what's sent and what stays as typed around it
type Parts = {
  head: string;
  body: string;
  mentions: string[];
  tail: string;
  // It has text that looks like a stand-in, so they couldn't be told apart
  ambiguous: boolean;
};

/**
 * The parts of a message to translate: the TTS trigger and the mentions at
 * the ends stay as typed, those in the middle become stand-ins. Null for a
 * command or a chat trigger's keyword.
 */
function split(content: string, commands: ChatCommands): Parts | null {
  if (commands.commands.some((command) => startsWithCommand(content, command)))
    return null;
  if (commands.keywords.some((k) => k.trim() && hasKeyword(content, k))) {
    return null;
  }
  // Matched as TTS matches it, in any case
  const { trigger } = commands;
  const triggered =
    trigger.trim() !== "" &&
    content.slice(0, trigger.length).toLowerCase() === trigger.toLowerCase();
  const start = triggered ? trigger.length : 0;
  const rest = content.slice(start);
  const lead = LEADING.exec(rest)![0];
  const middle = rest.slice(lead.length);
  const tail = TRAILING.exec(middle)![0];
  const typed = middle.slice(0, middle.length - tail.length);
  const mentions: string[] = [];
  const body = typed.replace(MENTIONS, (mention) =>
    standIn(mentions.push(mention) - 1),
  );
  const head = content.slice(0, start) + lead;
  return { head, body, mentions, tail, ambiguous: STAND_IN.test(typed) };
}

// The translation with the parts put back, null when a stand-in got lost
function join(parts: Parts, text: string): string | null {
  let out = text;
  for (const [index, mention] of parts.mentions.entries()) {
    const pieces = out.split(standIn(index));
    if (pieces.length !== 2) return null;
    out = pieces.join(mention);
  }
  return parts.head + out + parts.tail;
}

// Something to send: a letter once the mentions are out
const sendable = (parts: Parts) => !parts.ambiguous && LETTER.test(parts.body);

/**
 * Translates chat messages in other languages into the language Settings
 * picked, by Google's free endpoint, each message once as it arrives.
 */
export class TranslationService extends Service {
  // A code in TRANSLATION_LANGUAGES, "" when it's off
  private _language = "";
  // Until when translation rests after Google failed
  private _pausedUntil: number | null = null;
  // Translations by `${to}\n${text}`, oldest first
  private _cache = new Map<string, Promise<Translated>>();
  private _onFailure?: (error: unknown) => void;
  // The requests Google may get now, refilled at RATE_PER_SECOND up to
  // RATE_BURST, below 0 while some wait their turn
  private _tokens = RATE_BURST;
  private _filledAt: number | null = null;

  // A language outside the list turns it off
  public setLanguage(language: string) {
    this._language = TRANSLATION_LANGUAGES.some((code) => code === language)
      ? language
      : "";
  }

  // One listener, init.ts
  public onFailure(listener: (error: unknown) => void) {
    this._onFailure = listener;
  }

  /**
   * The chat with its translation, when it has one. Null at once, with no
   * request and no call to commands, unless it's in another language TikTok
   * named, has a letter, and translation isn't resting. Never rejects: a
   * failure, or no turn for Google soon enough, gives back the chat as typed.
   */
  public forChat(
    chat: ChatEvent,
    commands: () => ChatCommands | Promise<ChatCommands>,
  ): Promise<ChatEvent> | null {
    const to = this._language;
    const { content, lang } = chat.comment;
    if (!to || !lang || baseLanguage(lang) === baseLanguage(to)) return null;
    if (!LETTER.test(content)) return null;
    if (this._paused()) return null;
    return this._forChat(chat, to, commands).catch(() => chat);
  }

  private async _forChat(
    chat: ChatEvent,
    to: string,
    commands: () => ChatCommands | Promise<ChatCommands>,
  ): Promise<ChatEvent> {
    const parts = split(chat.comment.content, await commands());
    if (!parts || !sendable(parts)) return chat;
    const pending = this._cached(to, parts.body);
    if (!pending) return chat;
    const translation = this._translation(parts, await pending, to);
    if (!translation) return chat;
    return { ...chat, comment: { ...chat.comment, translation } };
  }

  /**
   * What the tester shows for a message. Like a chat's, without TikTok's
   * language, the cache, the pause or the turns. Throws a TranslationError
   * when Google fails.
   */
  public async test(
    text: string,
    commands: ChatCommands,
  ): Promise<TranslationTest> {
    const to = this._language;
    if (!to) throw new Error("Chat translation is off.");
    const parts = split(text, commands);
    if (!parts) return { kind: "command" };
    // Only mentions or emojis, which a chat would keep as typed
    if (!sendable(parts)) return { kind: "same", from: to.toLowerCase() };

    const result = await translateWithGoogle(parts.body, to);
    if (baseLanguage(result.from) === baseLanguage(to)) {
      return { kind: "same", from: result.from };
    }
    const translation = this._translation(parts, result, to);
    if (!translation) {
      throw new TranslationError(
        "lost_mention",
        "The translation lost a mention.",
      );
    }
    return { kind: "translated", translation };
  }

  // Null when Google read the target language, or lost a mention
  private _translation(
    parts: Parts,
    result: Translated,
    to: string,
  ): ChatTranslation | null {
    if (baseLanguage(result.from) === baseLanguage(to)) return null;
    const text = join(parts, result.text);
    return text === null
      ? null
      : { text, from: result.from, to: to.toLowerCase() };
  }

  private _paused() {
    return this._pausedUntil !== null && performance.now() < this._pausedUntil;
  }

  // How long a request waits for its turn, null when longer than MAX_WAIT_MS.
  // A turn taken is spent, so those waiting go out a second apart.
  private _turn(): number | null {
    const now = performance.now();
    if (this._filledAt !== null) {
      const refill = ((now - this._filledAt) / 1000) * RATE_PER_SECOND;
      this._tokens = Math.min(RATE_BURST, this._tokens + refill);
    }
    this._filledAt = now;
    const wait = Math.max(0, ((1 - this._tokens) / RATE_PER_SECOND) * 1000);
    if (wait > MAX_WAIT_MS) return null;
    this._tokens -= 1;
    return wait;
  }

  // One request per text and language. A failure leaves the cache; a text
  // with no turn soon enough is neither sent nor cached (null).
  private _cached(to: string, text: string): Promise<Translated> | null {
    const key = `${to}\n${text}`;
    const cached = this._cache.get(key);
    if (cached) return cached;
    const wait = this._turn();
    if (wait === null) return null;
    const request = this._request(to, text, wait);
    this._cache.set(key, request);
    if (this._cache.size > CACHE_SIZE) {
      this._cache.delete(this._cache.keys().next().value!);
    }
    request.catch(() => {
      if (this._cache.get(key) === request) this._cache.delete(key);
    });
    return request;
  }

  // A failure rests translation for PAUSE_MS
  private async _request(
    to: string,
    text: string,
    wait: number,
  ): Promise<Translated> {
    if (wait > 0) await delay(wait);
    // Google failed while it waited
    if (this._paused()) throw new Error("Chat translation is paused.");
    try {
      return await translateWithGoogle(text, to);
    } catch (error) {
      this._pausedUntil = performance.now() + PAUSE_MS;
      this._onFailure?.(error);
      throw error;
    }
  }
}
