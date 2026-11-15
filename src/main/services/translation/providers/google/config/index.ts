export default {
  // Its free endpoint, not an official public API, like Edge's Read Aloud
  API_URL: "https://translate.googleapis.com/translate_a/single",
  // A translated chat waits this long at most. The slowest answer measured
  // took 1.8 s, and a timeout pauses translation.
  REQUEST_TIMEOUT_MS: 3000,
  // Google's own codes for the languages it names otherwise
  CODES: {
    he: "iw",
    nb: "no",
    "zh-Hans": "zh-CN",
    "zh-Hant": "zh-TW",
  } as Record<string, string>,
};
