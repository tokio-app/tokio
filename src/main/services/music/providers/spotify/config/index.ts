export default {
  SCOPES: "user-modify-playback-state user-read-playback-state",
  CALLBACK: "http://127.0.0.1:5173/callback",
  AUTHORIZE_URL: "https://accounts.spotify.com/authorize",
  TOKEN_URL: "https://accounts.spotify.com/api/token",
  REQUEST_TIMEOUT_MS: 15_000,
  // How the token endpoint describes an invalid_client for a Client ID
  // Spotify has no app for (2026-11): "Failed to get client", "Invalid
  // client" when malformed, nothing when empty
  UNKNOWN_CLIENT: /^(invalid client|failed to get client)?$/i,
};
