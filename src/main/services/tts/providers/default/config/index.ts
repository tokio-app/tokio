const USER_AGENT =
  "com.zhiliaoapp.musically/2022600030 (Linux; U; Android 7.1.2; es_ES; SM-G988N; Build/NRD90M;tt-ok/3.12.13.1)";

export default {
  API_URL: "https://api16-normal-v6.tiktokv.com/media/api/text/speech/invoke",
  API_URL_ALT: "https://tiktok-tts.weilnet.workers.dev/api/generation",
  DEFAULT_VOICE: "en_us_001",
  // A slow endpoint would otherwise hold the TTS queue
  REQUEST_TIMEOUT_MS: 15_000,
  HEADERS: {
    "User-Agent": USER_AGENT,
    "Accept-Encoding": "gzip,deflate,compress",
    "Content-Type": "application/json",
  },
};
