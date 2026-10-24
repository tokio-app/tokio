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
// type /connect <this PC's address>:37892 in the game's chat, and the docs
// show it.
export const MINECRAFT_PORT = 37892;

// NOTE: DO NOT CHANGE. The Tokio mod for Java Edition offers this WebSocket
// subprotocol, which tells Tokio the game is Java (see the mod's PROTOCOL.md).
export const MINECRAFT_JAVA_PROTOCOL = "tokio.java.v1";

// Overlays connect here with their id to get the events meant for them.
export const getOverlaySocketURL = (id: string) =>
  `ws://localhost:${SERVER_PORT}/?id=${encodeURIComponent(id)}`;
