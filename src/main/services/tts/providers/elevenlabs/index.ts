import { VoiceSample } from "@/common/types";
import { formatError, MULTILINGUAL, VOICE_SAMPLE_TYPES } from "@/common/util";
import { Buffer } from "node:buffer";
import { extname } from "node:path";
import {
  GenerationResponse,
  ProviderVoice,
  TTSProvider,
  TTSRequestError,
} from "../../common";
import config from "./config";
import { CloneResponse, ErrorResponse, VoicesResponse } from "./types";

// Speaks with each user's own API key: Tokio never ships one.
export class ElevenLabsTTS extends TTSProvider {
  public readonly label = "ElevenLabs";
  public override readonly keyLabel = "voiceKeys.apiKey";
  private _key = "";
  // Bumped when the list may have changed, so a listing begun before isn't kept
  private _gen = 0;
  private _cache?: { voices: ProviderVoice[]; until: number };
  private _listing?: Promise<ProviderVoice[]>;

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
    const listing = (this._listing ??= this._list(key));
    try {
      const voices = await listing;
      if (gen === this._gen) {
        const until = performance.now() + config.VOICES_TTL_MS;
        this._cache = { voices, until };
      }
      return voices;
    } finally {
      if (this._listing === listing) this._listing = undefined;
    }
  }

  private async _list(key: string): Promise<ProviderVoice[]> {
    const voices: ProviderVoice[] = [];
    let token: string | null | undefined;
    // One deadline for every page: each voice picker waits for the list
    const signal = AbortSignal.timeout(config.LIST_TIMEOUT_MS);
    for (let page = 0; page < config.MAX_PAGES; page++) {
      const next = token ? `&next_page_token=${encodeURIComponent(token)}` : "";
      const data = await this._request<VoicesResponse>(
        key,
        `/v2/voices?page_size=${config.PAGE_SIZE}${next}`,
        { method: "GET" },
        signal,
        (res) => res.json(),
      );
      for (const voice of data.voices) {
        voices.push({
          id: voice.voice_id,
          name: voice.name,
          lang: MULTILINGUAL,
        });
      }
      token = data.next_page_token;
      if (!data.has_more || !token) break;
    }
    return voices;
  }

  // voice is the voice's id
  public async generateBuffer(
    text: string,
    _lang?: string,
    voice?: string,
  ): Promise<GenerationResponse> {
    try {
      if (!voice) {
        throw new TTSRequestError(this.label, "missing_voice", "No voice.");
      }
      const buffer = await this._request(
        this._requireKey(),
        `/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=${config.OUTPUT_FORMAT}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, model_id: config.MODEL_ID }),
        },
        AbortSignal.timeout(config.REQUEST_TIMEOUT_MS),
        async (res) => Buffer.from(await res.arrayBuffer()),
      );
      return { success: true, buffer };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e : new Error(formatError(e)),
      };
    }
  }

  public async cloneVoice(name: string, samples: VoiceSample[]) {
    const form = new FormData();
    form.append("name", name);
    samples.forEach((sample, i) => {
      const ext = extname(sample.name).slice(1).toLowerCase();
      // A copy, as Blob takes only arrays on an ArrayBuffer
      const data = new Uint8Array(sample.data);
      // Numbered, so the user's own file names stay on their computer
      form.append(
        "files",
        new Blob([data], { type: VOICE_SAMPLE_TYPES[ext] }),
        `sample-${i + 1}.${ext}`,
      );
    });
    const res = await this._request<CloneResponse>(
      this._requireKey(),
      "/v1/voices/add",
      { method: "POST", body: form },
      AbortSignal.timeout(config.CLONE_TIMEOUT_MS),
      (res) => res.json(),
    );
    this._clear();
    return { id: res.voice_id, verify: res.requires_verification === true };
  }

  private _requireKey() {
    if (!this._key) {
      throw new TTSRequestError(
        this.label,
        "missing_api_key",
        "No ElevenLabs API key set.",
      );
    }
    return this._key;
  }

  // The errors hold only the status and the API's code and message, never the
  // request, so the key can't reach the logs, which print errors whole.
  private async _request<T>(
    key: string,
    path: string,
    init: Omit<RequestInit, "headers"> & { headers?: Record<string, string> },
    signal: AbortSignal,
    read: (res: Response) => Promise<T>,
  ): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${config.API_URL}${path}`, {
        ...init,
        headers: { ...init.headers, "xi-api-key": key },
        signal,
      });
    } catch (error) {
      // oxlint-disable-next-line preserve-caught-error
      throw new TTSRequestError(
        this.label,
        "network",
        `ElevenLabs request failed: ${formatError(error)}`,
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
        `ElevenLabs sent an unreadable response: ${formatError(error)}`,
        res.status,
      );
    }
  }

  private async _failure(res: Response) {
    const body: ErrorResponse | undefined = await res
      .json()
      .catch(() => undefined);
    const detail = body?.detail;
    let code = `http_${res.status}`;
    let reason: string | undefined;
    if (typeof detail === "string") {
      reason = detail;
    } else if (Array.isArray(detail)) {
      code = "validation_error";
      reason = detail
        .map((d) => d?.msg)
        .filter((msg) => typeof msg === "string")
        .join("; ");
    } else if (detail && typeof detail === "object") {
      code = detail.code || detail.status || code;
      reason = detail.message;
    }
    const message = `ElevenLabs request failed: HTTP ${res.status} ${code}`;
    return new TTSRequestError(
      this.label,
      code,
      reason ? `${message} - ${reason}` : message,
      res.status,
    );
  }
}
