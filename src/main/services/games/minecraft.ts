import { CommandResult, GameStatus } from "@/common/types";
import { MINECRAFT_PORT } from "@/common/util";

type Options = {
  // How long a command waits for the game's answer
  timeoutMs?: number;
  // How long the game has to answer the encryption request
  handshakeMs?: number;
};

/**
 * Minecraft connects to Tokio, not the other way round: while enabled,
 * Tokio listens on `port`, and the game joins with `/connect localhost:<port>`
 * from its chat. Commands run as the player who connected.
 *
 * Statuses: off while disabled; waiting while listening with no game;
 * connected once the game's handshake is done; waiting again when it leaves.
 * When the port is taken: error "Port <port> is in use."
 */
export class MinecraftConnection {
  private _status: GameStatus = { state: "off" };
  private _listener?: (status: GameStatus) => void;
  private readonly _port: number;

  constructor(port: number = MINECRAFT_PORT, _options: Options = {}) {
    this._port = port;
  }

  public get status(): GameStatus {
    return this._status;
  }

  // One listener, GamesService
  public onStatus(listener: (status: GameStatus) => void) {
    this._listener = listener;
  }

  /** Starts or stops listening. False when the port can't be listened on. */
  public async setEnabled(enabled: boolean): Promise<boolean> {
    // Placeholder until the connection lands: it never listens.
    this._set(
      enabled
        ? { state: "error", error: `Port ${this._port} is in use.` }
        : { state: "off" },
    );
    return !enabled;
  }

  /** Runs a command as the connected player, and resolves with its answer. */
  public async send(command: string): Promise<CommandResult> {
    return { command, ok: false, message: "Minecraft isn't connected." };
  }

  /** Stops listening and drops the game. */
  public close() {
    this._set({ state: "off" });
  }

  private _set(status: GameStatus) {
    this._status = status;
    this._listener?.(status);
  }
}
