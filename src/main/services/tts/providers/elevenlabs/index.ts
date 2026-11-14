import { VoiceSample } from "@/common/types";
import { MULTILINGUAL, VOICE_SAMPLES_MAX } from "@/common/util";
import { Buffer } from "node:buffer";
import { ProviderVoice } from "../../common";
import { appendSamples, KeyedTTSProvider } from "../../common/keyed";
import config from "./config";
import { CloneResponse, ErrorResponse, VoicesResponse } from "./types";

export class ElevenLabsTTS extends KeyedTTSProvider {
  public readonly label = "ElevenLabs";
  // ElevenLabs asks for 1 to 2 minutes: more adds little
  public readonly cloning = {
    samples: VOICE_SAMPLES_MAX,
    minSeconds: 60,
    maxSeconds: 120,
  };
  protected readonly config = config;

  protected _headers(key: string) {
    return { "xi-api-key": key };
  }

  protected async _list(key: string, signal: AbortSignal) {
    const voices: ProviderVoice[] = [];
    let token: string | null | undefined;
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

  protected async _speak(
    key: string,
    text: string,
    voice: string,
    _lang: string | undefined,
    signal: AbortSignal,
  ) {
    return await this._request(
      key,
      `/v1/text-to-speech/${encodeURIComponent(voice)}?output_format=${config.OUTPUT_FORMAT}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, model_id: config.MODEL_ID }),
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
    form.append("name", name);
    appendSamples(form, "files", samples);
    const res = await this._request<CloneResponse>(
      key,
      "/v1/voices/add",
      { method: "POST", body: form },
      signal,
      (res) => res.json(),
    );
    return { id: res.voice_id, verify: res.requires_verification === true };
  }

  // A 422's detail is a list, and older errors' a string
  protected _reason(body: ErrorResponse | undefined) {
    const detail = body?.detail;
    let code: string | undefined;
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
      code = detail.code || detail.status || undefined;
      reason = detail.message;
      if (detail.status === "missing_permissions") code = detail.status;
    }
    // A key without a permission gets a 401 "unauthorized", like a wrong key:
    // only the message tells them apart
    if (/missing the permission/i.test(reason ?? "")) {
      code = "missing_permissions";
    }
    return { code, reason };
  }
}
