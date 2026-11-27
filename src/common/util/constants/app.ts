// Tokio's source, linked from the About page.
export const REPOSITORY_URL = "https://github.com/tokio-app/tokio";

// yarn dev:live: every platform connects to a made-up LIVE, with the data in
// ~/.tokio-dev. The build fixes the mode, so a release never has it.
export const FAKE_LIVE = import.meta.env.MODE === "live";

// Euler Stream signs the TikTok LIVE connection, with the user's own key.
export const EULER_STREAM_URL = "https://www.eulerstream.com";
export const EULER_SIGNUP_URL = `${EULER_STREAM_URL}/register`;
export const EULER_PRICING_URL = `${EULER_STREAM_URL}/pricing`;

// How to install the Tokio mod for Minecraft Java Edition, linked from Games.
export const MINECRAFT_MOD_DOCS_URL =
  "https://tokio.ialfaro.com/docs/features/games/#java-edition";
