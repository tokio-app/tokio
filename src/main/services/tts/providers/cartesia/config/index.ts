export default {
  API_URL: "https://api.cartesia.ai",
  // Required on every request, and the only version the API takes now
  VERSION: "2026-08-14",
  MODEL_ID: "sonic-3.6",
  OUTPUT_FORMAT: { container: "mp3", sample_rate: 44100, bit_rate: 128000 },
  // A slow endpoint would otherwise hold the TTS queue
  REQUEST_TIMEOUT_MS: 15_000,
  // Every page of the voice list, which every voice picker waits for
  LIST_TIMEOUT_MS: 10_000,
  // A clip of up to 16 MB to upload
  CLONE_TIMEOUT_MS: 120_000,
  // Every voice picker lists the voices when it mounts
  VOICES_TTL_MS: 60_000,
  // The API's maximum
  PAGE_SIZE: 100,
  MAX_PAGES: 10,
};
