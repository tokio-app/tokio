// NOTE: DO NOT CHANGE. browser sources and overlays point at this address.
export const SERVER_PORT = 37891;
export const APP_HOSTNAME = "tokio-app.local";

export const getOverlayURL = (id: string) =>
  `http://${APP_HOSTNAME}:${SERVER_PORT}/${encodeURIComponent(id)}/`;

// NOTE: DO NOT CHANGE. Each alert's overlay is served at /alerts/<alert id>/,
// and browser sources point at it.
export const ALERTS_PATH = "alerts";

export const getAlertOverlayURL = (id: string) =>
  `http://${APP_HOSTNAME}:${SERVER_PORT}/${ALERTS_PATH}/${encodeURIComponent(id)}/`;

// NOTE: DO NOT CHANGE. The countdown timer's overlay is served at /timer/,
// connects with this id, and browser sources point at it.
export const TIMER_PATH = "timer";

// NOTE: DO NOT CHANGE. Minecraft connects to Tokio on this port: players
// type /connect localhost:37892 in the game's chat, and the docs show it.
export const MINECRAFT_PORT = 37892;

// Overlays connect here with their id to get the events meant for them.
export const getOverlaySocketURL = (id: string) =>
  `ws://localhost:${SERVER_PORT}/?id=${encodeURIComponent(id)}`;
