import type { MessageKey } from "@/common/i18n";
import type { CloneLimits, VoiceSample } from "@/common/types";
import { formatError, VOICE_SAMPLE_TYPES } from "@/common/util";
import { extname } from "node:path";
import {
  GenerationResponse,
  ProviderVoice,
  TTSProvider,
  TTSRequestError,
} from ".";

export type KeyedConfig = {
  API_URL: string;
  // A slow endpoint would otherwise hold the TTS queue
  REQUEST_TIMEOUT_MS: number;
  // Every page of the voice list, which every voice picker waits for
  LIST_TIMEOUT_MS: number;
  // Samples to upload
  CLONE_TIMEOUT_MS: number;
  // Every voice picker lists the voices when it mounts
  VOICES_TTL_MS: number;
};

// Each sample as a part typed by its extension and numbered, so the user's own
// file names stay on their computer
export function appendSamples(
  form: FormData,
  field: string,
  samples: VoiceSample[],
) {
  samples.forEach((sample, i) => {
    const ext = extname(sample.name).slice(1).toLowerCase();
    // A copy, as Blob takes only arrays on an ArrayBuffer
    const data = new Uint8Array(sample.data);
    form.append(
      field,
      new Blob([data], { type: VOICE_SAMPLE_TYPES[ext] }),
      `sample-${i + 1}.${ext}`,
    );
  });
}

export type KeyedRequest = Omit<RequestInit, "headers" | "signal"> & {
  headers?: Record<string, string>;
};

/**
 * An online engine that speaks and clones with each user's own API key:
 * Tokio never ships one. It keeps the voice list for a while, and its errors
 * are TTSRequestErrors holding only the status and the API's code and message,
 * never the request, so the key can't reach the logs, which print errors whole.
 */
export abstract class KeyedTTSProvider extends TTSProvider {
  // TTSService reads these through TTSProvider, which fallow can't follow
  // fallow-ignore-next-line unused-class-member
  public override readonly keyLabel: MessageKey = "voiceKeys.apiKey";
  // fallow-ignore-next-line unused-class-member
  public abstract override readonly cloning: CloneLimits;
  // fallow-ignore-next-line unused-class-member
  public override readonly needsKey = true;
  protected abstract readonly config: KeyedConfig;
  private _key = "";
  // Bumped when the list may have changed, so a listing begun before isn't kept
  private _gen = 0;
  private _cache?: { voices: ProviderVoice[]; until: number };
  private _listing?: Promise<ProviderVoice[]>;

  // The account's voices, every page under the one signal
  protected abstract _list(
    key: string,
    signal: AbortSignal,
  ): Promise<ProviderVoice[]>;

  // The audio of the text in the voice, by its id. lang is the voice's.
  protected abstract _speak(
    key: string,
    text: string,
    voice: string,
    lang: string | undefined,
    signal: AbortSignal,
  ): Promise<Buffer<ArrayBuffer>>;

  protected abstract _clone(
    key: string,
    name: string,
    samples: VoiceSample[],
    language: string,
    signal: AbortSignal,
  ): Promise<{ id: string; verify: boolean }>;

  // The headers every request carries, the key's among them
  protected abstract _headers(key: string): Record<string, string>;

  // The API's own code and message in a failure's body, undefined when it
  // isn't JSON. Without a code the failure's is `http_<status>`. An engine
  // types the body as its API documents it.
  protected abstract _reason(body: unknown): { code?: string; reason?: string };

  // Called on every autosave pause in Settings, so it never fetches
  public setKey(key: string) {
    this._key = key;
    this._clear();
  }

  private _clear() {
    this._gen++;
    this._cache = undefined;
    this._listing = undefined;
  }

  public async getVoices(): Promise<ProviderVoice[]> {
    const key = this._key;
    if (!key) return [];
    // Not Date.now(), so a clock change can't keep the list for hours
    if (this._cache && performance.now() < this._cache.until) {
      return this._cache.voices;
    }
    const gen = this._gen;
    // One deadline for every page: each voice picker waits for the list
    const listing = (this._listing ??= this._list(
      key,
      AbortSignal.timeout(this.config.LIST_TIMEOUT_MS),
    ));
    try {
      const voices = await listing;
      if (gen === this._gen) {
        const until = performance.now() + this.config.VOICES_TTL_MS;
        this._cache = { voices, until };
      }
      return voices;
    } finally {
      if (this._listing === listing) this._listing = undefined;
    }
  }

  // voice is the voice's id
  public async generateBuffer(
    text: string,
    lang?: string,
    voice?: string,
  ): Promise<GenerationResponse> {
    try {
      if (!voice) {
        throw new TTSRequestError(this.label, "missing_voice", "No voice.");
      }
      const buffer = await this._speak(
        this._requireKey(),
        text,
        voice,
        lang,
        AbortSignal.timeout(this.config.REQUEST_TIMEOUT_MS),
      );
      return { success: true, buffer };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e : new Error(formatError(e)),
      };
    }
  }

  public override async cloneVoice(
    name: string,
    samples: VoiceSample[],
    language: string,
  ) {
    const res = await this._clone(
      this._requireKey(),
      name,
      samples,
      language,
      AbortSignal.timeout(this.config.CLONE_TIMEOUT_MS),
    );
    // So the new voice shows
    this._clear();
    return res;
  }

  private _requireKey() {
    if (!this._key) {
      throw new TTSRequestError(
        this.label,
        "missing_api_key",
        `No ${this.label} API key set.`,
      );
    }
    return this._key;
  }

  protected async _request<T>(
    key: string,
    path: string,
    init: KeyedRequest,
    signal: AbortSignal,
    read: (res: Response) => Promise<T>,
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${this.config.API_URL}${path}`, {
        ...init,
        headers: { ...init.headers, ...this._headers(key) },
        signal,
      });
    } catch (error) {
      // oxlint-disable-next-line preserve-caught-error
      throw new TTSRequestError(
        this.label,
        "network",
        `${this.label} request failed: ${formatError(error)}`,
      );
    }
    if (!res.ok) throw await this._failure(res);
    try {
      return await read(res);
    } catch (error) {
      // oxlint-disable-next-line preserve-caught-error
      throw new TTSRequestError(
        this.label,
        "bad_response",
        `${this.label} sent an unreadable response: ${formatError(error)}`,
        res.status,
      );
    }
  }

  private async _failure(res: Response) {
    const body: unknown = await res.json().catch(() => undefined);
    const { code = `http_${res.status}`, reason } = this._reason(body);
    const message = `${this.label} request failed: HTTP ${res.status} ${code}`;
    return new TTSRequestError(
      this.label,
      code,
      reason ? `${message} - ${reason}` : message,
      res.status,
    );
  }
}
