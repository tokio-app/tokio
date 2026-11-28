// Kick's chat feed: a Centrifugo server, spoken in its JSON protocol the
// way kick.com's page does as a guest. Commands and replies are one JSON
// object per line, several to a frame.
import { formatError } from "@/common/util";
import WebSocket from "ws";
import { connectFailure, ConnectorFailure, discard } from "../../../common";
import type { KickConfig } from "../config";
import { decode } from "./mapping";

export interface KickSocketHandlers {
  publication(feed: string, event: string, data: object): void;
  // The socket closed or went quiet. Terminal when Kick said not to come
  // back as the same client.
  drop(why: string, terminal: boolean): void;
  // A new guest token for the same client, before the last one lapses
  token(): Promise<string>;
  // Detailed logs, and the warnings worth a line
  log(message: string): void;
  warn(message: string): void;
}

type Reply = {
  id?: number;
  error?: { code?: number; message?: string; temporary?: boolean };
  connect?: { ttl?: number; ping?: number };
  refresh?: { ttl?: number };
  push?: {
    channel?: string;
    pub?: { data?: { event?: string; data?: unknown } };
    disconnect?: { code?: number; reason?: string };
  };
};

type SocketFailure = ConnectorFailure & { terminal?: boolean };

// Centrifugo's codes that say reconnecting as before would be refused again
const isTerminalCode = (code: number) =>
  (code >= 3500 && code < 4000) || (code >= 4500 && code < 5000);

export const isTerminal = (error: unknown) =>
  error instanceof Error && "terminal" in error && error.terminal === true;

// A refusal worth trying again at once: an expired token, or temporary
const isRetryable = (error: NonNullable<Reply["error"]>) =>
  error.code === 109 || error.temporary === true;

export class KickSocket {
  private _socket: WebSocket | null = null;
  private _opening: {
    resolve: () => void;
    reject: (error: Error) => void;
    // The subscribes not answered yet
    waiting: Set<number>;
    connected: boolean;
  } | null = null;
  // What each command sent was: "connect", "refresh" or a feed
  private _commands = new Map<number, string>();
  private _id = 0;
  // The first feed, chat's: a connect fails without it
  private _chat = "";
  // How long the socket can go quiet, null when the server doesn't ping
  private _quietMs: number | null = null;
  private _watchdog?: NodeJS.Timeout;
  private _refresh?: NodeJS.Timeout;

  constructor(
    private _config: KickConfig,
    private _handlers: KickSocketHandlers,
  ) {}

  // A fresh socket: resolves once the server took the token and answered
  // every subscribe. Rejects with a failure that says whether it's terminal.
  public open(url: string, token: string, feeds: string[]): Promise<void> {
    this.close();
    this._chat = feeds[0];
    return new Promise((resolve, reject) => {
      this._opening = { resolve, reject, waiting: new Set(), connected: false };
      const socket = new WebSocket(url, {
        origin: this._config.ORIGIN,
        headers: { "user-agent": this._config.USER_AGENT },
        handshakeTimeout: this._config.REQUEST_TIMEOUT_MS,
      });
      this._socket = this._attach(socket);
      // Until the connect reply, which says how often the server pings
      this._quietMs = this._config.REQUEST_TIMEOUT_MS;
      this._feed(socket);
      socket.on("open", () => {
        this._send(socket, "connect", { connect: { token, name: "js" } });
        for (const channel of feeds) {
          const id = this._send(socket, channel, { subscribe: { channel } });
          this._opening?.waiting.add(id);
        }
      });
    });
  }

  public close() {
    this._teardown()?.reject(
      connectFailure("network", "The chat socket was closed."),
    );
  }

  // Drops the socket and its timers, and hands back the open still waiting
  private _teardown() {
    clearTimeout(this._watchdog);
    clearTimeout(this._refresh);
    discard(this._socket);
    this._socket = null;
    this._commands.clear();
    const opening = this._opening;
    this._opening = null;
    return opening;
  }

  private _send(socket: WebSocket, what: string, command: object): number {
    const id = ++this._id;
    this._commands.set(id, what);
    socket.send(JSON.stringify({ id, ...command }));
    return id;
  }

  private _attach(socket: WebSocket): WebSocket {
    let error: Error | undefined;
    socket.on("error", (err) => {
      error = err;
    });
    socket.on("message", (raw: Buffer) => {
      if (socket !== this._socket) return;
      this._feed(socket);
      for (const line of raw.toString("utf8").split("\n")) {
        if (!line.trim()) continue;
        let reply: Reply;
        try {
          reply = JSON.parse(line);
        } catch {
          continue;
        }
        this._reply(socket, reply);
        // A reply can close the socket
        if (socket !== this._socket) return;
      }
    });
    socket.on("close", (code, reason) => {
      if (socket !== this._socket) return;
      const text = reason.toString();
      this._fail(
        `closed (${code}${text ? ` ${text}` : ""})${error ? ` -- ${formatError(error)}` : ""}`,
        isTerminalCode(code),
        error,
      );
    });
    return socket;
  }

  private _reply(socket: WebSocket, reply: Reply) {
    // The server's ping: an empty object, answered with one
    if (Object.keys(reply).length === 0) {
      socket.send("{}");
      return;
    }
    if (reply.push) {
      const { pub, disconnect } = reply.push;
      if (disconnect) {
        const code = disconnect.code ?? 0;
        this._fail(
          `disconnected (${code}${disconnect.reason ? ` ${disconnect.reason}` : ""})`,
          isTerminalCode(code),
        );
        return;
      }
      const event = pub?.data?.event;
      const data = decode(pub?.data?.data);
      if (reply.push.channel && event && data) {
        // Thrown out of the listener, it would stop the feed (an error box too)
        try {
          this._handlers.publication(reply.push.channel, event, data);
        } catch (err) {
          this._handlers.warn(
            `Kick couldn't read ${event}: ${formatError(err)}`,
          );
        }
      }
      return;
    }
    if (reply.id === undefined) return;
    const what = this._commands.get(reply.id);
    this._commands.delete(reply.id);
    if (what === "connect") this._connected(socket, reply);
    else if (what === "refresh") this._refreshed(socket, reply);
    else if (what) this._subscribed(reply.id, what, reply);
  }

  private _connected(socket: WebSocket, reply: Reply) {
    const { error, connect } = reply;
    if (error || !connect) {
      // Any other refusal would be refused again
      this._fail(
        `refused the token (${error?.code} ${error?.message})`,
        !error || !isRetryable(error),
      );
      return;
    }
    this._quietMs = connect.ping
      ? connect.ping * 1000 + this._config.PING_GRACE_MS
      : null;
    this._feed(socket);
    this._scheduleRefresh(socket, connect.ttl);
    if (this._opening) this._opening.connected = true;
    this._settle();
  }

  private _subscribed(id: number, feed: string, reply: Reply) {
    const { error } = reply;
    if (error) {
      const why = `refused ${feed} (${error.code} ${error.message})`;
      // Tried again by the reconnect
      if (isRetryable(error)) return this._fail(why, false);
      if (feed === this._chat) {
        return this._fail(why, false, undefined, "unknown");
      }
      // Kick refuses a guest some feeds: the rest go on
      this._handlers.warn(`Kick ${why}: its events are left out.`);
    }
    this._opening?.waiting.delete(id);
    this._settle();
  }

  // Opened once connected with every subscribe answered
  private _settle() {
    const opening = this._opening;
    if (!opening?.connected || opening.waiting.size) return;
    this._opening = null;
    opening.resolve();
  }

  // A new token before this one lapses, for the same client
  private _scheduleRefresh(socket: WebSocket, ttl?: number) {
    clearTimeout(this._refresh);
    if (!ttl) return;
    this._refresh = setTimeout(
      async () => {
        let token: string;
        try {
          token = await this._handlers.token();
        } catch (err) {
          // The token lapses soon: a reconnect gets a new one
          if (socket === this._socket) {
            this._fail(
              `couldn't refresh the token -- ${formatError(err)}`,
              false,
            );
          }
          return;
        }
        if (socket !== this._socket) return;
        this._send(socket, "refresh", { refresh: { token } });
      },
      ttl * 1000 * this._config.REFRESH_AT,
    );
  }

  private _refreshed(socket: WebSocket, reply: Reply) {
    if (reply.error) {
      // Kick ends the connection once the token lapses: that reconnects
      this._handlers.warn(
        `Kick refused the new token (${reply.error.code} ${reply.error.message}).`,
      );
      return;
    }
    this._handlers.log("Refreshed the guest token.");
    this._scheduleRefresh(socket, reply.refresh?.ttl);
  }

  // Any frame shows the socket is alive; none for a ping's time and the
  // grace means it dropped without closing
  private _feed(socket: WebSocket) {
    clearTimeout(this._watchdog);
    const ms = this._quietMs;
    if (ms === null) return;
    this._watchdog = setTimeout(() => {
      if (socket === this._socket) {
        this._fail(`no message for ${ms / 1000} s`, false);
      }
    }, ms);
  }

  // The socket is done: fails the open, or tells of the drop
  private _fail(
    why: string,
    terminal: boolean,
    cause?: Error,
    kind: ConnectorFailure["kind"] = "network",
  ) {
    const opening = this._teardown();
    if (opening) {
      const failure: SocketFailure = Object.assign(
        connectFailure(kind, `The chat socket ${why}`, { cause }),
        { terminal },
      );
      opening.reject(failure);
    } else {
      this._handlers.drop(why, terminal);
    }
  }
}
