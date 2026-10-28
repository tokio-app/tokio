import { formatError } from "@/common/util";
import { Buffer } from "node:buffer";
import { GenerationResponse, ProviderVoice, TTSProvider } from "../../common";
import { handleStatusError, prepareText, Voices, VoicesData } from "./common";
import config from "./config";
import { TTSResponse, TTSResponseALT } from "./types";

export class TikTokTTS extends TTSProvider {
  public readonly label = "TikTok";
  public override readonly keyLabel = "voiceKeys.sessionId";
  private sessionId: string | undefined;

  private getURL(text: string, speaker: string, lang: string) {
    // prepareText joins the words with +, the query's spaces, so a "#" or "%"
    // in a word can't cut or garble the text.
    const words = prepareText(text, lang).split("+").map(encodeURIComponent);
    return `${config.API_URL}/?text_speaker=${encodeURIComponent(speaker)}&req_text=${words.join("+")}&speaker_map_type=0&aid=1233`;
  }

  private async generateB64TTSALT(
    text: string,
    voice: string,
  ): Promise<string> {
    const res = await fetch(config.API_URL_ALT, {
      method: "POST",
      headers: config.HEADERS,
      body: JSON.stringify({ text, voice }),
      signal: AbortSignal.timeout(config.REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      // The body of an error status may still name the reason.
      const body: Partial<TTSResponseALT> | undefined = await res
        .json()
        .catch(() => undefined);
      throw new Error(
        `TTS generation failed: ${body?.error ?? `HTTP ${res.status}`}`,
      );
    }
    const data: TTSResponseALT = await res.json();
    if (!data.success) {
      throw new Error(`TTS generation failed: ${data.error}`);
    }
    return data.data;
  }

  private checkStatusCode(statusCode?: number) {
    if (statusCode !== undefined && statusCode !== 0) {
      handleStatusError(statusCode);
    }
  }

  private async generateB64TTS(
    text: string,
    lang: string,
    voice: string,
  ): Promise<string> {
    let res: Response;
    let data: Partial<TTSResponse> | undefined;
    try {
      res = await fetch(this.getURL(text, voice, lang), {
        method: "POST",
        headers: { ...config.HEADERS, Cookie: `sessionid=${this.sessionId}` },
        signal: AbortSignal.timeout(config.REQUEST_TIMEOUT_MS),
      });
      // An error status may still name the reason in status_code.
      data = await res.json().catch((error: unknown) => {
        if (res.ok) throw error;
        return undefined;
      });
    } catch (error) {
      // A failed request's error could hold the session cookie, so it must not reach the logs.
      // oxlint-disable-next-line preserve-caught-error
      throw new Error(`TikTok TTS request failed: ${formatError(error)}`);
    }

    this.checkStatusCode(data?.status_code);
    if (!res.ok || !data?.data) {
      throw new Error(`TikTok TTS request failed: HTTP ${res.status}`);
    }
    return data.data.v_str;
  }

  public setKey(session: string) {
    this.sessionId = session;
  }

  public getB64TTS(text: string, lang: string, voice: string): Promise<string> {
    const speaker = VoicesData[voice] ?? config.DEFAULT_VOICE;
    if (!this.sessionId) {
      return this.generateB64TTSALT(text, speaker);
    } else {
      return this.generateB64TTS(text, lang, speaker);
    }
  }

  public async generateBuffer(
    text: string,
    lang?: string,
    voice?: string,
  ): Promise<GenerationResponse> {
    try {
      const base64Audio = await this.getB64TTS(
        text,
        lang || "en",
        voice || config.DEFAULT_VOICE,
      );
      const audioBuffer = Buffer.from(base64Audio, "base64");
      return { buffer: audioBuffer, success: true };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e : new Error(formatError(e)),
      };
    }
  }

  public getVoices(): ProviderVoice[] {
    return Voices;
  }
}
