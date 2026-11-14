export default {
  API_URL: "https://api.inworld.ai",
  // $15 per million characters on demand, against $25 for inworld-tts-2, and
  // both take cloned voices
  MODEL_ID: "inworld-tts-2-flash",
  // A slow endpoint would otherwise hold the TTS queue
  REQUEST_TIMEOUT_MS: 15_000,
  // Every page of the voice list, which every voice picker waits for
  LIST_TIMEOUT_MS: 10_000,
  // One sample to upload
  CLONE_TIMEOUT_MS: 120_000,
  // Every voice picker lists the voices when it mounts
  VOICES_TTL_MS: 60_000,
  // The API's most is 2,000
  PAGE_SIZE: 500,
  MAX_PAGES: 10,
};
