import { VoiceSample } from "@/common/types";
import { MULTILINGUAL } from "@/common/util";
import { Buffer } from "node:buffer";
import { ProviderVoice, TTSRequestError } from "../../common";
import { KeyedTTSProvider } from "../../common/keyed";
import config from "./config";
import {
  CloneResponse,
  ErrorResponse,
  SpeakResponse,
  VoicesResponse,
} from "./types";

export class InworldTTS extends KeyedTTSProvider {
  public readonly label = "Inworld";
  // One clip: 10 to 30 s works best, and it cuts longer ones at 30 s
  public readonly cloning = { samples: 1, minSeconds: 10, maxSeconds: 30 };
  protected readonly config = config;

  // The key is the Base64 credentials the Portal shows, already encoded
  protected _headers(key: string) {
    return { Authorization: `Basic ${key}` };
  }

  protected async _list(key: string, signal: AbortSignal) {
    const voices: ProviderVoice[] = [];
    let token: string | undefined;
    for (let page = 0; page < config.MAX_PAGES; page++) {
      const next = token ? `&pageToken=${encodeURIComponent(token)}` : "";
      const data = await this._request<VoicesResponse>(
        key,
        `/voices/v1/voices?pageSize=${config.PAGE_SIZE}${next}`,
        { method: "GET" },
        signal,
        (res) => res.json(),
      );
      for (const voice of data.voices) {
        voices.push({
          id: voice.voiceId,
          name: voice.displayName,
          lang: voice.languageCode || MULTILINGUAL,
        });
      }
      token = data.nextPageToken;
      if (!token) break;
    }
    return voices;
  }

  // No language sent: Inworld detects the text's
  protected async _speak(
    key: string,
    text: string,
    voice: string,
    _lang: string | undefined,
    signal: AbortSignal,
  ) {
    return await this._request(
      key,
      "/tts/v1/voice",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          voiceId: voice,
          modelId: config.MODEL_ID,
          audioConfig: { audioEncoding: "MP3" },
        }),
      },
      signal,
      async (res) => {
        const { audioContent }: SpeakResponse = await res.json();
        if (!audioContent) throw new Error("no audio");
        return Buffer.from(audioContent, "base64");
      },
    );
  }

  // The language is left out, so Inworld detects it
  protected async _clone(
    key: string,
    name: string,
    samples: VoiceSample[],
    _language: string,
    signal: AbortSignal,
  ) {
    const res = await this._request<CloneResponse>(
      key,
      "/voices/v1/voices:clone",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: name,
          voiceSamples: [
            { audioData: Buffer.from(samples[0].data).toString("base64") },
          ],
        }),
      },
      signal,
      (res) => res.json(),
    );
    const id = res.voice?.voiceId;
    if (!id) {
      const why = (res.audioSamplesValidated ?? [])
        .flatMap((sample) => sample.errors ?? [])
        .map((error) => error.text)
        .filter((text) => typeof text === "string")
        .join("; ");
      // A 422 is what failureKey reads as unusable samples
      throw new TTSRequestError(
        this.label,
        "invalid_samples",
        why
          ? `Inworld couldn't clone the voice: ${why}`
          : "Inworld couldn't clone the voice.",
        422,
      );
    }
    return { id, verify: false };
  }

  // The HTTP status already says what the gRPC code does
  protected _reason(body: ErrorResponse | undefined) {
    const message = body?.message;
    return { reason: typeof message === "string" ? message : undefined };
  }
}
