import { CommandResult, GameStatus } from "@/common/types";
import { MINECRAFT_PORT } from "@/common/util";
import {
  Cipheriv,
  createCipheriv,
  createDecipheriv,
  createECDH,
  createHash,
  Decipheriv,
  randomBytes,
  randomUUID,
} from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";

type Options = {
  // How long a command waits for the game's answer
  timeoutMs?: number;
  // How long the game has to answer the encryption request
  handshakeMs?: number;
};

type Game = {
  socket: WebSocket;
  // Handshake done (or skipped): commands can be sent
  ready: boolean;
  handshake?: NodeJS.Timeout;
  cipher?: Cipheriv;
  decipher?: Decipheriv;
};

type Command = {
  command: string;
  resolve: (result: CommandResult) => void;
  timer?: NodeJS.Timeout;
};

type Frame = {
  header?: { requestId?: string; messagePurpose?: string };
  body?: {
    publicKey?: string;
    statusCode?: number;
    statusMessage?: unknown;
    message?: unknown;
  };
};

// The DER header of a P-384 public key (SubjectPublicKeyInfo), which the game
// sends and expects in front of the raw point.
const SPKI_PREFIX = Buffer.from(
  "3076301006072a8648ce3d020106052b81040022036200",
  "hex",
);
// The game refuses more than 100 commands in flight
const MAX_IN_FLIGHT = 50;
const MAX_WAITING = 500;
// Body version 42 parses today's syntax (execute … run); 1 doesn't
const COMMAND_VERSION = 42;

const request = (requestId: string, commandLine: string, version: number) =>
  JSON.stringify({
    header: {
      version: 1,
      requestId,
      messageType: "commandRequest",
      messagePurpose: "commandRequest",
    },
    body: { version, commandLine, origin: { type: "player" } },
  });

const failed = (command: string, message: string): CommandResult => ({
  command,
  ok: false,
  message,
});

/**
 * Minecraft connects to Tokio, not the other way round: while enabled,
 * Tokio listens on `port`, and the game joins with `/connect <address>:<port>`
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
  private readonly _timeoutMs: number;
  private readonly _handshakeMs: number;
  private _wss: WebSocketServer | null = null;
  private _listening: Promise<boolean> | null = null;
  private _game: Game | null = null;
  private readonly _inFlight = new Map<string, Command>();
  private readonly _waiting: Command[] = [];

  constructor(
    port: number = MINECRAFT_PORT,
    { timeoutMs = 10_000, handshakeMs = 5_000 }: Options = {},
  ) {
    this._port = port;
    this._timeoutMs = timeoutMs;
    this._handshakeMs = handshakeMs;
  }

  public get status(): GameStatus {
    return this._status;
  }

  // The port listened on, which differs from the one asked for with 0
  public get port(): number {
    const address = this._wss?.address();
    return typeof address === "object" && address ? address.port : this._port;
  }

  // One listener, GamesService
  public onStatus(listener: (status: GameStatus) => void) {
    this._listener = listener;
  }

  /** Starts or stops listening. False when the port can't be listened on. */
  public async setEnabled(enabled: boolean): Promise<boolean> {
    if (!enabled) {
      await this._stop();
      return true;
    }
    return (this._listening ??= this._listen());
  }

  /** Runs a command as the connected player, and resolves with its answer. */
  public send(command: string): Promise<CommandResult> {
    if (!this._game?.ready) {
      return Promise.resolve(failed(command, "Minecraft isn't connected."));
    }
    if (this._waiting.length >= MAX_WAITING) {
      return Promise.resolve(failed(command, "Too many commands are waiting."));
    }
    return new Promise((resolve) => {
      this._waiting.push({ command, resolve });
      this._pump();
    });
  }

  /** Stops listening and drops the game. */
  public close() {
    void this._stop();
  }

  private _listen(): Promise<boolean> {
    return new Promise((resolve) => {
      const wss = new WebSocketServer({
        // No host: phones and consoles on the LAN connect too
        port: this._port,
        maxPayload: 64 * 1024,
        // Browsers always send an Origin and the game never does, so no web
        // page can take the socket.
        verifyClient: ({ req }) => req.headers.origin === undefined,
      });
      this._wss = wss;

      wss.on("listening", () => {
        if (this._wss !== wss) return;
        this._set({ state: "waiting" });
        resolve(true);
      });
      wss.on("error", (err: NodeJS.ErrnoException) => {
        if (this._wss !== wss) return;
        this._wss = null;
        this._listening = null;
        wss.close();
        this._set({
          state: "error",
          error:
            err.code === "EADDRINUSE"
              ? `Port ${this._port} is in use.`
              : `Couldn't listen on port ${this._port}.`,
        });
        resolve(false);
      });
      // Stopped before it listened
      wss.on("close", () => resolve(false));
      wss.on("connection", (socket) => {
        if (this._wss !== wss) return socket.terminate();
        this._connect(socket);
      });
    });
  }

  private _stop(): Promise<void> {
    const wss = this._wss;
    this._wss = null;
    this._listening = null;
    this._drop();
    this._set({ state: "off" });
    return new Promise((resolve) =>
      wss ? wss.close(() => resolve()) : resolve(),
    );
  }

  private _connect(socket: WebSocket) {
    // A bad frame would otherwise throw in main; "close" follows it.
    socket.on("error", () => {});
    // A new game replaces the old one
    this._drop();
    this._set({ state: "waiting" });

    const game: Game = { socket, ready: false };
    this._game = game;

    const ecdh = createECDH("secp384r1");
    const publicKey = Buffer.concat([SPKI_PREFIX, ecdh.generateKeys()]);
    const salt = randomBytes(16);
    const handshakeId = randomUUID();

    socket.on("message", (data: Buffer, isBinary) => {
      // Binary frames are encrypted, text frames plain (the game's
      // "too many commands" errors come as text even after the handshake).
      const frame = this._parse(
        isBinary && game.decipher ? game.decipher.update(data) : data,
      );
      if (frame?.header?.requestId !== handshakeId) return this._answer(frame);
      if (game.cipher || typeof frame.body?.publicKey !== "string") return;
      // Here, not after an await: the game's next frame is already encrypted
      // and may come in the same chunk, and a missed frame desyncs the stream.
      try {
        const theirs = Buffer.from(frame.body.publicKey, "base64");
        const secret = ecdh.computeSecret(theirs.subarray(SPKI_PREFIX.length));
        const key = createHash("sha256").update(salt).update(secret).digest();
        const iv = key.subarray(0, 16);
        // Electron's BoringSSL has aes-256-cfb but not cfb8
        game.cipher = createCipheriv("aes-256-cfb", key, iv);
        game.decipher = createDecipheriv("aes-256-cfb", key, iv);
      } catch {
        return socket.terminate();
      }
      this._ready(game);
    });
    socket.on("close", () => {
      if (this._game !== game) return;
      this._drop();
      if (this._wss) this._set({ state: "waiting" });
    });

    const key = JSON.stringify(publicKey.toString("base64"));
    const saltText = JSON.stringify(salt.toString("base64"));
    socket.send(
      request(handshakeId, `enableencryption ${key} ${saltText} cfb`, 1),
    );
    // No answer: the player turned "Require Encrypted Websockets" off
    game.handshake = setTimeout(() => this._ready(game), this._handshakeMs);
  }

  private _ready(game: Game) {
    clearTimeout(game.handshake);
    if (this._game !== game || game.ready) return;
    game.ready = true;
    this._set({ state: "connected" });
  }

  // Forgets the game, failing the commands it had
  private _drop() {
    const game = this._game;
    if (!game) return;
    this._game = null;
    clearTimeout(game.handshake);
    game.socket.terminate();
    const commands = [...this._inFlight.values(), ...this._waiting];
    this._inFlight.clear();
    this._waiting.length = 0;
    for (const { command, resolve, timer } of commands) {
      clearTimeout(timer);
      resolve(failed(command, "Minecraft disconnected."));
    }
  }

  private _parse(data: Buffer): Frame | null {
    try {
      return JSON.parse(data.toString("utf8"));
    } catch {
      return null;
    }
  }

  private _answer(frame: Frame | null) {
    const purpose = frame?.header?.messagePurpose;
    if (purpose !== "commandResponse" && purpose !== "error") return;
    const requestId = frame?.header?.requestId ?? "";
    const pending = this._inFlight.get(requestId);
    if (!pending) return;
    const body = frame?.body ?? {};
    // say answers with only a message, execute with neither
    const message = body.statusMessage ?? body.message;
    this._finish(requestId, {
      command: pending.command,
      ok: typeof body.statusCode === "number" && body.statusCode >= 0,
      message: typeof message === "string" ? message : "",
    });
  }

  private _finish(requestId: string, result: CommandResult) {
    const pending = this._inFlight.get(requestId);
    if (!pending) return;
    this._inFlight.delete(requestId);
    clearTimeout(pending.timer);
    pending.resolve(result);
    this._pump();
  }

  // Sends waiting commands while there's room in flight
  private _pump() {
    const game = this._game;
    if (!game?.ready) return;
    while (this._inFlight.size < MAX_IN_FLIGHT) {
      const next = this._waiting.shift();
      if (!next) return;
      const requestId = randomUUID();
      next.timer = setTimeout(
        () =>
          this._finish(
            requestId,
            failed(next.command, "Minecraft didn't answer."),
          ),
        this._timeoutMs,
      );
      this._inFlight.set(requestId, next);
      const json = request(requestId, next.command, COMMAND_VERSION);
      // Once the keys are set, every frame goes encrypted, as binary
      game.socket.send(
        game.cipher ? game.cipher.update(Buffer.from(json, "utf8")) : json,
      );
    }
  }

  private _set(status: GameStatus) {
    if (
      this._status.state === status.state &&
      this._status.error === status.error
    ) {
      return;
    }
    this._status = status;
    this._listener?.(status);
  }
}
