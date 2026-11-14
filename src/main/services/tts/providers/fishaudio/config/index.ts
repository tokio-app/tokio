export default {
  API_URL: "https://api.fish.audio",
  // $15 per million UTF-8 bytes. "s2.1-pro-free" costs nothing but has no
  // latency or availability guarantee, which chat TTS can't wait on
  MODEL: "s2.1-pro",
  // A slow endpoint would otherwise hold the TTS queue
  REQUEST_TIMEOUT_MS: 15_000,
  // Every page of the voice list, which every voice picker waits for
  LIST_TIMEOUT_MS: 10_000,
  // Up to 10 samples to upload
  CLONE_TIMEOUT_MS: 120_000,
  // Every voice picker lists the voices when it mounts
  VOICES_TTL_MS: 60_000,
  PAGE_SIZE: 100,
  MAX_PAGES: 10,
  // The library's licensed voices, the most used first: every voice picker
  // shows each one
  LIBRARY_PAGES: 3,
};
