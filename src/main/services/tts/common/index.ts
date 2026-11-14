// Type only: `yarn tts:edge:check` runs this file under tsx, which can't load
// the locale files
import type { MessageKey } from "@/common/i18n";
import type { CloneLimits, VoiceSample } from "@/common/types";

export type GenerationResponse = {
  success: boolean;
  buffer?: Buffer<ArrayBuffer>;
  error?: Error;
};

// A voice as an engine knows it, TTSService adds the engine id. id is set
// when its names can repeat or change, and the engine is then given it.
export type ProviderVoice = {
  name: string;
  lang: string;
  id?: string;
};

export abstract class TTSProvider {
  // Shown to the user, e.g. as the group of its voices.
  public abstract readonly label: string;
  // Set when the engine takes a key, which is then editable in Settings: the
  // key of its name, which the window translates.
  public readonly keyLabel?: MessageKey;
  // True when its voices speak only with its key, unlike TikTok's
  public readonly needsKey: boolean = false;
  public abstract setKey(key: string): void;
  public abstract getVoices(): ProviderVoice[] | Promise<ProviderVoice[]>;
  // Unknown voices (e.g. another engine's) must fall back to a default, unless
  // the engine is never the active provider: ElevenLabs fails on an id it
  // doesn't know rather than speak another voice.
  public abstract generateBuffer(
    text: string,
    lang?: string,
    voice?: string,
  ): Promise<GenerationResponse>;
  // Both set when the engine clones voices from samples, which come within
  // its limits. language is the app's, for an engine that must be told the
  // samples' language. verify is true when the voice works only once the user
  // verifies it on the engine's website.
  public readonly cloning?: CloneLimits;
  public cloneVoice?(
    name: string,
    samples: VoiceSample[],
    language: string,
  ): Promise<{ id: string; verify: boolean }>;
  // Release any resources (e.g. child processes) held by the provider.
  public dispose(): void {}
}

/**
 * A failed request to an online engine: its HTTP status and the API's own
 * code, or one like `missing_api_key` or `network`. It never has a cause, so
 * the request's key can't reach the logs.
 */
export class TTSRequestError extends Error {
  constructor(
    // The engine's label, e.g. "ElevenLabs"
    public readonly engine: string,
    public readonly code: string,
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "TTSRequestError";
  }
}

/**
 * The text that says why a request failed (with `{engine}` and `{settings}`
 * params), or null when the caller's own message says it best.
 */
export function failureKey(
  error: unknown,
  { cloning = false }: { cloning?: boolean } = {},
): MessageKey | null {
  if (!(error instanceof TTSRequestError)) return null;
  if (error.code === "missing_api_key") return "main.tts.keyMissing";
  // Older ElevenLabs errors send an empty quota as a 401
  if (
    error.code === "quota_exceeded" ||
    error.code === "insufficient_credits"
  ) {
    return "main.tts.noCredits";
  }
  // ElevenLabs sends a key without a permission as a 401
  if (
    error.code === "missing_permissions" ||
    error.code === "insufficient_permissions"
  ) {
    return "main.tts.keyPermissions";
  }
  // Cartesia sends a plan that can't do it as a 402, like no credits
  if (error.code === "plan_required") return "main.tts.notAllowed";
  switch (error.status) {
    case 401:
      return "main.tts.keyRejected";
    case 402:
      return "main.tts.noCredits";
    case 403:
      return "main.tts.notAllowed";
    case 404:
      return "main.tts.voiceGone";
    case 429:
      return "main.tts.busy";
    case 400:
    case 422:
      return cloning ? "main.tts.badSamples" : null;
    default:
      return null;
  }
}
