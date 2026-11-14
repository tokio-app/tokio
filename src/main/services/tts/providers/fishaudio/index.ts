import { VoiceSample } from "@/common/types";
import { MULTILINGUAL, VOICE_SAMPLES_MAX } from "@/common/util";
import { Buffer } from "node:buffer";
import { ProviderVoice, TTSRequestError } from "../../common";
import { appendSamples, KeyedTTSProvider } from "../../common/keyed";
import config from "./config";
import { CloneResponse, ErrorResponse, Model, VoicesResponse } from "./types";

export class FishAudioTTS extends KeyedTTSProvider {
  public readonly label = "Fish Audio";
  // At least 10 s, and 30 to 60 s helps a voice that sounds robotic
  public readonly cloning = {
    samples: VOICE_SAMPLES_MAX,
    minSeconds: 10,
    maxSeconds: 60,
  };
  protected readonly config = config;

  protected _headers(key: string) {
    return { Authorization: `Bearer ${key}` };
  }

  // The account's own voices, and the library's licensed ones, whose owners
  // agreed: the rest of the library is anyone's uploads
  protected async _list(key: string, signal: AbortSignal) {
    const [own, library] = await Promise.all([
      this._models(key, "self=true", config.MAX_PAGES, signal),
      this._models(
        key,
        "licensed=true&sort_by=task_count",
        config.LIBRARY_PAGES,
        signal,
      ),
    ]);
    const mine = new Set(own.map((m) => m._id));
    return [
      // S2.1 speaks 80+ languages in any voice, a clone of the user's too
      ...own.map((m) => ({ id: m._id, name: m.title, lang: MULTILINGUAL })),
      // Under the language each was made in, so the filter finds them
      ...library
        .filter((m) => !mine.has(m._id))
        .map((m) => ({
          id: m._id,
          name: m.title,
          lang: m.languages?.length === 1 ? m.languages[0] : MULTILINGUAL,
        })),
    ] satisfies ProviderVoice[];
  }

  // A listing's voices that can speak, page by page
  private async _models(
    key: string,
    query: string,
    pages: number,
    signal: AbortSignal,
  ) {
    const models: Model[] = [];
    for (let n = 1; n <= pages; n++) {
      const data = await this._request<VoicesResponse>(
        key,
        `/model?${query}&page_size=${config.PAGE_SIZE}&page_number=${n}`,
        { method: "GET" },
        signal,
        (res) => res.json(),
      );
      // One still training can't speak yet
      models.push(
        ...data.items.filter((m) => m.type === "tts" && m.state === "trained"),
      );
      if (
        data.has_more === false ||
        data.items.length < config.PAGE_SIZE ||
        n * config.PAGE_SIZE >= data.total
      ) {
        break;
      }
    }
    return models;
  }

  protected async _speak(
    key: string,
    text: string,
    voice: string,
    // Not sent: Fish detects the text's language
    _lang: string | undefined,
    signal: AbortSignal,
  ) {
    return await this._request(
      key,
      "/v1/tts",
      {
        method: "POST",
        headers: { "Content-Type": "application/json", model: config.MODEL },
        body: JSON.stringify({
          text,
          reference_id: voice,
          format: "mp3",
          mp3_bitrate: 128,
          latency: "normal",
        }),
      },
      signal,
      async (res) => Buffer.from(await res.arrayBuffer()),
    );
  }

  protected async _clone(
    key: string,
    name: string,
    samples: VoiceSample[],
    _language: string,
    signal: AbortSignal,
  ) {
    const form = new FormData();
    form.append("type", "tts");
    form.append("title", name);
    // The voice can be used right away
    form.append("train_mode", "fast");
    form.append("visibility", "private");
    appendSamples(form, "voices", samples);
    const res = await this._request<CloneResponse>(
      key,
      "/model",
      { method: "POST", body: form },
      signal,
      (res) => res.json(),
    );
    if (res.state === "failed") {
      // 422, so failureKey says the samples were unusable
      throw new TTSRequestError(
        this.label,
        "training_failed",
        "Fish Audio couldn't train the voice.",
        422,
      );
    }
    return { id: res._id, verify: false };
  }

  // No code: the HTTP status names it
  protected _reason(body: ErrorResponse | undefined) {
    const { message, reason } = body ?? {};
    if (typeof message !== "string") return {};
    return {
      reason: typeof reason === "string" ? `${message} (${reason})` : message,
    };
  }
}
