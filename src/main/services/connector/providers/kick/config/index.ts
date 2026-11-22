import { app } from "electron";

// What the provider passes fetch, so tests can read it
export type FetchInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
};

const config = {
  // The channel's lookup, on kick.com's own API
  API_URL: "https://kick.com/api/v2",
  // Where kick.com's page gets the chat feed's server and a guest token
  REALTIME_URL: "https://web.kick.com/api/v1/realtime",
  // Kick's socket refuses a handshake from any other Origin
  ORIGIN: "https://kick.com",
  // Honest, on every request and the socket: Kick refuses a non-browser
  // that sends a browser's (403 "Request blocked by security policy")
  USER_AGENT: `Tokio/${app.getVersion()}`,

  // Each request, so a dead network fails a connect instead of holding it
  REQUEST_TIMEOUT_MS: 10_000,
  // How often the viewers are asked for while the channel is live
  VIEWERS_MS: 60_000,
  // The server pings every few seconds (its connect reply says): none for
  // that long and this much more is a dead socket
  PING_GRACE_MS: 10_000,
  // A new guest token is sent at this share of the last one's life
  REFRESH_AT: 0.8,

  // A connect that failed on the network is tried this many times in all,
  // this far apart, as the TikTok provider does
  CONNECT_TRIES: 3,
  CONNECT_RETRY_MS: 3000,
  // A drop is tried again after the first delay, doubling up to the last,
  // and never given up while the user stays connected
  RECONNECT_MIN_MS: 1000,
  RECONNECT_MAX_MS: 30_000,
  // After a close Kick says not to retry as is: the wait before coming back
  // as a new client, doubling up to the last, plus up to a quarter at
  // random so clients refused together don't return together
  TERMINAL_MIN_MS: 5 * 60_000,
  TERMINAL_MAX_MS: 30 * 60_000,

  // A repeating error is logged at most this often
  LOG_REPEAT_MS: 30_000,

  // Tests answer for Kick
  fetch: (url: string, init: FetchInit): Promise<Response> => fetch(url, init),
};

export type KickConfig = typeof config;

export default config;
