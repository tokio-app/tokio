import { GamesOverlay, GamesSettings, MinecraftEdition } from "../schemas";

// A game's connection: off, waiting for the game to connect, connected, or
// unable to work, with why in error, for the user.
export type GameStatus = {
  state: "off" | "waiting" | "connected" | "error";
  error?: string;
  // The connected game's edition, only while connected
  edition?: MinecraftEdition;
};

export const MINECRAFT_EDITION_NAMES: Record<MinecraftEdition, string> = {
  bedrock: "Bedrock Edition",
  java: "Java Edition",
};

// Keyed by game, like the settings
export type GamesStatus = Record<keyof GamesSettings, GameStatus>;

// What main sends the Games page about the connections
export type GamesData = {
  settings: GamesSettings;
  status: GamesStatus;
};

// What the game answered to one command
export type CommandResult = {
  command: string;
  ok: boolean;
  // The game's reply, or why the command didn't run
  message: string;
};

// One action on the games overlay: its event, an arrow, then its picture and
// name, see gameOverlayRows
export type GameOverlayRow = {
  // The action's, which tokio:games:run names
  id: string;
  // The event's pictures, its gifts' or emotes', and its text
  pictures: string[];
  event: string;
  // Where the action's picture loads from, null for none
  image: string | null;
  // Empty for none
  name: string;
};

// What the games overlay gets (tokio:games), and its preview draws
export type GamesOverlayData = {
  look: GamesOverlay;
  rows: GameOverlayRow[];
};
