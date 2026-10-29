import { Buffer } from "node:buffer";
import { GenerationResponse, ProviderVoice, TTSProvider } from "../../common";
import { SapiHost } from "./common/host";
import config from "./config";
import { SapiVoice } from "./types";

export class WindowsTTS extends TTSProvider {
  public readonly label = "Windows";
  private _host = new SapiHost();
  private _voices: SapiVoice[] | null = null;

  private async _fetchVoices(): Promise<SapiVoice[]> {
    this._voices = await this._host.request({ type: "voices" });
    return this._voices;
  }

  public setKey(_key: string) {}

  public async getVoices(): Promise<ProviderVoice[]> {
    // Asking starts the PowerShell host, so they're listed once a run: a
    // voice installed meanwhile shows after a restart
    const voices = this._voices ?? (await this._fetchVoices());
    return voices.map(({ name, lang }) => ({ name, lang }));
  }

  public async generateBuffer(
    text: string,
    _lang?: string,
    voice?: string,
  ): Promise<GenerationResponse> {
    try {
      const voices = this._voices ?? (await this._fetchVoices());
      // Unknown voices (e.g. a TikTok voice name from the profile) fall back to the system default.
      const installed = voices.find((v) => v.name === voice);
      const base64Audio = await this._host.request({
        type: "speak",
        text,
        voice: installed?.name,
        engine: installed?.engine,
        rate: config.DEFAULT_RATE,
        volume: config.DEFAULT_VOLUME,
      });
      return { buffer: Buffer.from(base64Audio, "base64"), success: true };
    } catch (e) {
      return {
        success: false,
        error: e instanceof Error ? e : new Error(String(e)),
      };
    }
  }

  public override dispose() {
    this._host.dispose();
  }
}
