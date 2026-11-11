import type { StudioCamera, StudioCameraQuality } from "../../schemas/studio";

// NOTE: DO NOT CHANGE. browser sources and overlays point at this address.
export const SERVER_PORT = 37891;
export const APP_HOSTNAME = "tokio-app.local";

export const getOverlayURL = (id: string) =>
  `http://${APP_HOSTNAME}:${SERVER_PORT}/${encodeURIComponent(id)}/`;

// NOTE: DO NOT CHANGE. Each alert's overlay is served at /alerts/<alert id>/,
// and browser sources point at it.
export const ALERTS_PATH = "alerts";

// A media library file, where the server mounts the folder for the alerts' pages
export const alertMediaPath = (file: string) =>
  `/${ALERTS_PATH}/media/${encodeURIComponent(file)}`;

export const getAlertOverlayURL = (id: string) =>
  `http://${APP_HOSTNAME}:${SERVER_PORT}/${ALERTS_PATH}/${encodeURIComponent(id)}/`;

// NOTE: DO NOT CHANGE. The countdown timer's overlay is served at /timer/,
// connects with this id, and browser sources point at it.
export const TIMER_PATH = "timer";

// NOTE: DO NOT CHANGE. Each Overlay Studio overlay is served at
// /studio/<overlay id>/, connects with studio:<overlay id>, and browser
// sources point at it.
export const STUDIO_PATH = "studio";

export const getStudioOverlayURL = (id: string) =>
  `http://${APP_HOSTNAME}:${SERVER_PORT}/${STUDIO_PATH}/${encodeURIComponent(id)}/`;

// What a studio overlay's socket id starts with, for onConnect to spot it
export const STUDIO_SOCKET_PREFIX = `${STUDIO_PATH}:`;

// The socket id a studio overlay's page connects with
export const studioSocketId = (id: string) => `${STUDIO_SOCKET_PREFIX}${id}`;

// Where a camera element's frames stream from. Pages get the whole URL from
// main, with the overlay server's key for this run, so it's never a
// browser-source link. A studio overlay's id is a UUID, never "camera".
export const STUDIO_CAMERA_PATH = `${STUDIO_PATH}/camera`;

// A camera's stream: null is the default camera
export const studioCameraPath = (
  key: string,
  camera: StudioCamera | null,
  quality: StudioCameraQuality,
) =>
  `/${STUDIO_CAMERA_PATH}/${encodeURIComponent(key)}?${new URLSearchParams({
    device: camera?.id ?? "",
    label: camera?.label ?? "",
    quality,
  })}`;

// NOTE: DO NOT CHANGE. Each game's overlay is served under /games/<game>/
// and connects with this id.
export const GAMES_PATH = "games";

// NOTE: DO NOT CHANGE. Browser sources point at Minecraft's overlay: every
// column at /games/minecraft/, one at /games/minecraft/<column>/. Its
// pictures are under /games/minecraft/pictures/.
export const MINECRAFT_OVERLAY_PATH = `${GAMES_PATH}/minecraft`;
export const MINECRAFT_PICTURES_PATH = `${MINECRAFT_OVERLAY_PATH}/pictures`;

export const getMinecraftOverlayURL = (column?: number) =>
  `http://${APP_HOSTNAME}:${SERVER_PORT}/${MINECRAFT_OVERLAY_PATH}/${column ? `${column}/` : ""}`;

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
