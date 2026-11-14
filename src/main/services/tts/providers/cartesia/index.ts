import { VoiceSample } from "@/common/types";
import { MULTILINGUAL } from "@/common/util";
import { Buffer } from "node:buffer";
import { ProviderVoice } from "../../common";
import { appendSamples, KeyedTTSProvider } from "../../common/keyed";
import config from "./config";
import { CloneResponse, ErrorResponse, VoicesResponse } from "./types";

// "en-US" is "en": Cartesia takes the base language
const baseLanguage = (lang: string) => lang.split(/[-_]/)[0].toLowerCase();

export class CartesiaTTS extends KeyedTTSProvider {
  public readonly label = "Cartesia";
  // One clip: 10 s is enough, and up to 60 s keeps the accent on Sonic 3.6
  public readonly cloning = { samples: 1, minSeconds: 10, maxSeconds: 60 };
  protected readonly config = config;

  protected _headers(key: string) {
    return {
      Authorization: `Bearer ${key}`,
      "Cartesia-Version": config.VERSION,
    };
  }

  // The account's own first: its library nears the pages' cap, which would
  // leave a clone out
  protected async _list(key: string, signal: AbortSignal) {
    const [own, all] = await Promise.all([
      this._voices(key, "&is_owner=true", signal),
      this._voices(key, "", signal),
    ]);
    const mine = new Set(own.map((v) => v.id));
    return [...own, ...all.filter((v) => !mine.has(v.id))];
  }

  private async _voices(key: string, filter: string, signal: AbortSignal) {
    const voices: ProviderVoice[] = [];
    let cursor: string | null | undefined;
    for (let page = 0; page < config.MAX_PAGES; page++) {
      const next = cursor
        ? `&starting_after=${encodeURIComponent(cursor)}`
        : "";
      const res = await this._request<VoicesResponse>(
        key,
        `/voices?limit=${config.PAGE_SIZE}${filter}${next}`,
        { method: "GET" },
        signal,
        (res) => res.json(),
      );
      for (const voice of res.data) {
        // Each voice is built for one language
        voices.push({
          id: voice.id,
          name: voice.name,
          lang: voice.language || MULTILINGUAL,
        });
      }
      cursor = res.next_page;
      if (!res.has_more || !cursor) break;
    }
    return voices;
  }

  protected async _speak(
    key: string,
    text: string,
    voice: string,
    lang: string | undefined,
    signal: AbortSignal,
  ) {
    return await this._request(
      key,
      "/tts/bytes",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model_id: config.MODEL_ID,
          transcript: text,
          voice: { id: voice },
          output_format: config.OUTPUT_FORMAT,
          // Without it the model's default speaks, not the text's language
          ...(lang &&
            lang !== MULTILINGUAL && { language: baseLanguage(lang) }),
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
    language: string,
    signal: AbortSignal,
  ) {
    const form = new FormData();
    // Main lets through only one
    appendSamples(form, "clip", samples.slice(0, 1));
    form.append("name", name);
    // shortcut: the app's language, add a language field to the dialog if streamers clone voices in other languages
    form.append("language", baseLanguage(language));
    const res = await this._request<CloneResponse>(
      key,
      "/voices/clone",
      { method: "POST", body: form },
      signal,
      (res) => res.json(),
    );
    return { id: res.id, verify: false };
  }

  protected _reason(body: ErrorResponse | undefined) {
    const b = body ?? {};
    const error = typeof b.error === "object" ? b.error : undefined;
    const reason = [b.message, b.error, error?.message, b.detail, b.title].find(
      (s): s is string => typeof s === "string" && s !== "",
    );
    const code = [b.code, error?.code].find(
      (s): s is string => typeof s === "string" && s !== "",
    );
    // A free plan gets a 402, like no credits: only the message tells them apart
    if (/free tier|upgrade your subscription/i.test(reason ?? "")) {
      return { code: "plan_required", reason };
    }
    return { code, reason };
  }
}
