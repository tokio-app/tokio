import { EdgeConfig, EdgeConfigOverrides } from "../types";

// NOTE: Every value Microsoft can change lives here. Compare with edge-tts constants.py when it breaks, see README.md.
const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const BASE_URL =
  "speech.platform.bing.com/consumer/speech/synthesize/readaloud";

const defaults: EdgeConfig = {
  TRUSTED_CLIENT_TOKEN,
  WSS_URL: `wss://${BASE_URL}/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}`,
  VOICE_LIST_URL: `https://${BASE_URL}/voices/list?trustedclienttoken=${TRUSTED_CLIENT_TOKEN}`,
  CHROMIUM_FULL_VERSION: "143.0.3650.75",
  // Tried in order, the next one is used when the previous gets a 403.
  // Since 2026-10 synthesis requires v2, the voice list still accepts v1.
  TOKEN_VERSIONS: ["2", "1"],
  ORIGIN: "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
  OUTPUT_FORMAT: "audio-24khz-48kbitrate-mono-mp3",
  // Display name format, see edgeShortName in ../index.ts.
  DEFAULT_VOICE: { lang: "en-US", name: "Emma Multilingual" },
  MAX_CHUNK_BYTES: 4096,
  REQUEST_TIMEOUT_MS: 20000,
  VOICES_TTL_MS: 24 * 60 * 60 * 1000,
};

export function createConfig(overrides?: EdgeConfigOverrides): EdgeConfig {
  return { ...defaults, ...overrides };
}

export function buildHeaders(
  cfg: EdgeConfig,
  kind: "wss" | "voices",
): Record<string, string> {
  const major = cfg.CHROMIUM_FULL_VERSION.split(".")[0];
  const base = {
    "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${major}.0.0.0 Safari/537.36 Edg/${major}.0.0.0`,
    "Accept-Encoding": "gzip, deflate, br, zstd",
    "Accept-Language": "en-US,en;q=0.9",
  };

  if (kind === "wss") {
    return {
      Pragma: "no-cache",
      "Cache-Control": "no-cache",
      Origin: cfg.ORIGIN,
      ...base,
    };
  }

  return {
    Authority: "speech.platform.bing.com",
    "Sec-CH-UA": `" Not;A Brand";v="99", "Microsoft Edge";v="${major}", "Chromium";v="${major}"`,
    "Sec-CH-UA-Mobile": "?0",
    Accept: "*/*",
    "Sec-Fetch-Site": "none",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    ...base,
  };
}
