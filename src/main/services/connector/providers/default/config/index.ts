export default {
  GEO_API_URL: "https://ipapi.co/json/",
  // Each request, so a slow network can't hold up startup on a first run.
  REQUEST_TIMEOUT_MS: 8000,
  HEADERS: {
    Accept: "application/json",
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  },
};
