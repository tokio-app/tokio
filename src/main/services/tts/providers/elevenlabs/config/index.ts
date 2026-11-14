export default {
  API_URL: "https://api.elevenlabs.io",
  // Half the credits of eleven_multilingual_v2, and the fastest
  MODEL_ID: "eleven_flash_v2_5",
  // Every plan has it
  OUTPUT_FORMAT: "mp3_44100_128",
  // A slow endpoint would otherwise hold the TTS queue
  REQUEST_TIMEOUT_MS: 15_000,
  // Every page of the voice list, which every voice picker waits for
  LIST_TIMEOUT_MS: 10_000,
  // Up to 10 samples of 25 MB to upload
  CLONE_TIMEOUT_MS: 120_000,
  // Every voice picker lists the voices when it mounts
  VOICES_TTL_MS: 60_000,
  PAGE_SIZE: 100,
  MAX_PAGES: 10,
};
