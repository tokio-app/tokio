import { GenerationResponse, ProviderVoice, TTSProvider } from "../../common";
import { listVoices, synthesize } from "./common/protocol";
import { EdgeTTSError } from "./common/errors";
import { createConfig } from "./config";
import { EdgeConfig, EdgeConfigOverrides, EdgeVoice } from "./types";

export { EdgeTTSError } from "./common/errors";

// Display names are reversible, so synthesis never needs the voice list:
// "es-MX-JorgeNeural" <-> { lang: "es-MX", name: "Jorge" },
// "en-US-EmmaMultilingualNeural" <-> { lang: "en-US", name: "Emma Multilingual" }.
export function edgeDisplayName(voice: EdgeVoice): string {
  const prefix = `${voice.Locale}-`;
  const suffix = voice.ShortName.startsWith(prefix)
    ? voice.ShortName.slice(prefix.length)
    : voice.ShortName;
  return suffix.replace(/Neural$/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2");
}

// Also accepts the raw suffix (e.g. "JorgeNeural") saved by earlier versions,
// and a whole ShortName, the display name of a voice whose ShortName doesn't
// start with its Locale. Names alone have no "-".
export function edgeShortName({ lang, name }: ProviderVoice): string {
  const suffix = name.replaceAll(" ", "");
  const neural = suffix.endsWith("Neural") ? suffix : `${suffix}Neural`;
  return suffix.includes("-") ? neural : `${lang}-${neural}`;
}

export class EdgeTTS extends TTSProvider {
  public readonly label = "Edge";
  private _config: EdgeConfig;
  private _voices: { list: ProviderVoice[]; fetchedAt: number } | null = null;
  // Shared by every voice picker and message waiting for the list
  private _listing?: Promise<ProviderVoice[]>;

  constructor(overrides?: EdgeConfigOverrides) {
    super();
    this._config = createConfig(overrides);
  }

  public get config(): Readonly<EdgeConfig> {
    return this._config;
  }

  public setKey(_key: string) {}

  public async getVoices(): Promise<ProviderVoice[]> {
    const cached = this._voices;
    // Not Date.now(), so a clock change can't keep the list for days
    if (
      cached &&
      performance.now() - cached.fetchedAt < this._config.VOICES_TTL_MS
    ) {
      return cached.list;
    }
    return (this._listing ??= this._fetchVoices(cached).finally(() => {
      this._listing = undefined;
    }));
  }

  private async _fetchVoices(
    cached: EdgeTTS["_voices"],
  ): Promise<ProviderVoice[]> {
    try {
      const list = (await listVoices(this._config)).map((v) => ({
        lang: v.Locale,
        name: edgeDisplayName(v),
      }));
      this._voices = { list, fetchedAt: performance.now() };
      return list;
    } catch (error) {
      if (!cached) throw error;
      // Stale is better than nothing, and the next try waits as long, so
      // each picker doesn't wait for Edge again
      this._voices = { list: cached.list, fetchedAt: performance.now() };
      return cached.list;
    }
  }

  private _resolveShortName(lang?: string, voice?: string): string {
    const fallback = edgeShortName(this._config.DEFAULT_VOICE);
    if (!lang || !voice) return fallback;
    const shortName = edgeShortName({ lang, name: voice });
    const known = this._voices?.list;
    // Profiles may still hold another provider's voice (e.g. TikTok "Default").
    if (known && !known.some((v) => edgeShortName(v) === shortName)) {
      return fallback;
    }
    return shortName;
  }

  public async generateBuffer(
    text: string,
    lang?: string,
    voice?: string,
  ): Promise<GenerationResponse> {
    // The fallback needs the list; a failed fetch speaks as given and the next message tries again
    if (!this._voices) await this.getVoices().catch(() => {});
    try {
      const buffer = await synthesize(
        this._config,
        text,
        this._resolveShortName(lang, voice),
      );
      return { buffer, success: true };
    } catch (e) {
      return {
        success: false,
        error:
          e instanceof Error ? e : new EdgeTTSError("synthesis", String(e)),
      };
    }
  }
}
