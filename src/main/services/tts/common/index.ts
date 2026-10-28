// Type only: `yarn tts:edge:check` runs this file under tsx, which can't load
// the locale files
import type { MessageKey } from "@/common/i18n";

export type GenerationResponse = {
  success: boolean;
  buffer?: Buffer<ArrayBuffer>;
  error?: Error;
};

// A voice as an engine knows it, TTSService adds the engine id.
export type ProviderVoice = {
  name: string;
  lang: string;
};

export abstract class TTSProvider {
  // Shown to the user, e.g. as the group of its voices.
  public abstract readonly label: string;
  // Set when the engine takes a key, which is then editable in Settings: the
  // key of its name, which the window translates.
  public readonly keyLabel?: MessageKey;
  public abstract setKey(key: string): void;
  public abstract getVoices(): ProviderVoice[] | Promise<ProviderVoice[]>;
  // Unknown voices (e.g. another engine's) must fall back to a default.
  public abstract generateBuffer(
    text: string,
    lang?: string,
    voice?: string,
  ): Promise<GenerationResponse>;
  // Release any resources (e.g. child processes) held by the provider.
  public dispose(): void {}
}
