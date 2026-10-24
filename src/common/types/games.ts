import { GamesSettings } from "../schemas";

// A game's connection: off, waiting for the game to connect, connected, or
// unable to work, with why in error, for the user.
export type GameStatus = {
  state: "off" | "waiting" | "connected" | "error";
  error?: string;
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
