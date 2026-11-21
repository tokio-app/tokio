// What the provider passes fetch, so tests can read it
export type FetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};

const config = {
  BASE_URL: "https://www.youtube.com",
  // youtube.com's own pages and chat, as a desktop browser reads them
  USER_AGENT:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36",

  // Each request, so a dead network fails a connect instead of holding it
  REQUEST_TIMEOUT_MS: 10_000,
  // The chat's next poll waits what YouTube says, at most this: alerts need
  // low latency, and 3 s held for over 30 minutes on seven LIVEs with no 429
  POLL_MS: 3000,
  // How often the viewers are asked for
  VIEWERS_MS: 30_000,

  // A connect that failed on the network is tried this many times in all,
  // this far apart, as the TikTok provider does
  CONNECT_TRIES: 3,
  CONNECT_RETRY_MS: 3000,
  // A failed poll is tried again after the first delay, doubling up to the
  // last, and never given up while the user stays connected
  RECONNECT_MIN_MS: 2000,
  RECONNECT_MAX_MS: 15_000,

  // A repeating error is logged at most this often
  LOG_REPEAT_MS: 30_000,

  // Tests answer for YouTube
  fetch: (url: string, init: FetchInit): Promise<Response> => fetch(url, init),
};

export type YouTubeConfig = typeof config;

export default config;
