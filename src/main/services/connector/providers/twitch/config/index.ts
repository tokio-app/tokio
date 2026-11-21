const config = {
  // Tokio's app on dev.twitch.tv, a public client: its id isn't a secret
  CLIENT_ID: "brjks26o7j8vq80et6yfq1vwheeeg2",
  SCOPES:
    "user:read:chat moderator:read:followers bits:read channel:read:redemptions",

  DEVICE_URL: "https://id.twitch.tv/oauth2/device",
  TOKEN_URL: "https://id.twitch.tv/oauth2/token",
  VALIDATE_URL: "https://id.twitch.tv/oauth2/validate",
  REVOKE_URL: "https://id.twitch.tv/oauth2/revoke",
  HELIX_URL: "https://api.twitch.tv/helix",
  // Twitch sends a keepalive when nothing else came for this many seconds
  EVENTSUB_URL: "wss://eventsub.wss.twitch.tv/ws?keepalive_timeout_seconds=30",

  // A keepalive can come this late before the socket counts as dropped
  KEEPALIVE_GRACE_MS: 5000,
  // Each request, so a dead network fails a connect instead of holding it
  REQUEST_TIMEOUT_MS: 10_000,
  // How often the viewers are asked for while the stream is live
  STREAMS_POLL_MS: 30_000,
  // Twitch asks apps to validate their token every hour
  VALIDATE_MS: 3_600_000,

  // A connect that failed on the network is tried this many times in all,
  // this far apart, as the TikTok provider does
  CONNECT_TRIES: 3,
  CONNECT_RETRY_MS: 3000,
  // A drop is tried again after the first delay, doubling up to the last,
  // and never given up while the user stays connected
  RECONNECT_MIN_MS: 1000,
  RECONNECT_MAX_MS: 15_000,

  // Viewers whose pictures are kept, the last ones looked up
  PICTURES_KEPT: 500,
  // A repeating error is logged at most this often
  LOG_REPEAT_MS: 30_000,
};

export type TwitchConfig = typeof config;

export default config;
