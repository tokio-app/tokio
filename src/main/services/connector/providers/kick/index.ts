import { TOKIO_EVENTS } from "@/common/types";
import { formatError } from "@/common/util";
import Logger from "@/logger";
import { randomUUID } from "node:crypto";
import {
  connectFailure,
  ConnectorProvider,
  ConnectorResponse,
  fail,
  GiftResponse,
  kindOf,
  toFailure,
} from "../../common";
import { guestToken, lookup, parseInput, realtime, slugOf } from "./common/api";
import { eventName, fromPublication, type Mapped } from "./common/mapping";
import { isTerminal, KickSocket } from "./common/socket";
import defaults, { type KickConfig } from "./config";

type Connection = {
  slug: string;
  channelId: number;
  chatroomId: number;
  // The realtime client Kick knows this connection by; a new one after a
  // terminal close
  clientId: string;
  socket: KickSocket;
  // CONNECTED went out, so a stop sends DISCONNECTED
  up: boolean;
  reconnecting: boolean;
  live: boolean;
  // Live at connect or since, so the stream's end ends the connection
  wasLive: boolean;
  poll?: NodeJS.Timeout;
  // The viewers poll's offline answers in a row: two end the stream, in case
  // the feed missed its end
  offline: number;
  // The wait before a connect's or a reconnect's next try, and its end
  retry?: NodeJS.Timeout;
  wake?: () => void;
  // Each username's viewer id (kick:<id>) in this LIVE, by its lowercase,
  // from chat and Kicks or a lookup; undefined after a failed lookup
  ids: Map<string, Promise<string | undefined>>;
};

/**
 * Kick's chat with no account or key: it reads Kick's website API and its
 * chat feed the way kick.com's page does, as a guest, with an honest
 * User-Agent. Written from what kick.com sends; no Kick library's code.
 */
export class KickConnector extends ConnectorProvider {
  private _config: KickConfig;
  private _conn: Connection | null = null;
  // A connect during a connect gets this one
  private _connecting: Promise<ConnectorResponse> | null = null;
  // When each repeating error was last logged
  private _logged = new Map<string, number>();

  // Tests point the URLs, delays and fetch elsewhere
  constructor(options: Partial<KickConfig> = {}) {
    super();
    this._config = { ...defaults, ...options };
  }

  // Kick's chat needs no key
  public setKey() {}

  public connect(channel: string): Promise<ConnectorResponse> {
    return (this._connecting ??= this._connect(channel).finally(() => {
      this._connecting = null;
    }));
  }

  public async disconnect(): Promise<void> {
    if (this._conn) this._stop(this._conn);
  }

  // Also while connecting and coming back, so a profile can't switch then
  public isConnected(): boolean {
    return this._conn !== null || this._connecting !== null;
  }

  public override isReconnecting(): boolean {
    return this._conn?.reconnecting ?? false;
  }

  public async fetchGifts(): Promise<GiftResponse> {
    return { success: true, data: [] };
  }

  // --- PRIVATE ---

  private async _connect(channel: string): Promise<ConnectorResponse> {
    if (this._conn) return { success: true };
    const slug = parseInput(channel);
    if (!slug) return fail("notFound", "That names no Kick channel.");

    const conn = this._connection(slug);
    this._conn = conn;
    let viewers: number | null;
    try {
      for (let tries = 1; ; tries++) {
        try {
          viewers = await this._start(conn);
          break;
        } catch (err) {
          if (
            tries === this._config.CONNECT_TRIES ||
            kindOf(err) !== "network" ||
            isTerminal(err) ||
            this._conn !== conn
          ) {
            throw err;
          }
          Logger.info(
            `<Kick> Connecting again in ${this._config.CONNECT_RETRY_MS / 1000} s -- ${formatError(err)}`,
            this._logFile,
          );
          if (!(await this._pause(conn, this._config.CONNECT_RETRY_MS))) {
            throw err;
          }
        }
      }
    } catch (err) {
      // A Disconnect closed the socket or woke the pause: not the network
      if (this._conn !== conn) {
        return fail("canceled", "Disconnected while connecting.");
      }
      this._stop(conn);
      return { success: false, error: toFailure(err) };
    }
    // A stop between _start resolving and this
    if (this._conn !== conn) {
      return fail("canceled", "Disconnected while connecting.");
    }

    conn.up = true;
    Logger.info(
      `<Kick> Connected to @${conn.slug}${viewers !== null ? ", live" : ", not live"}.`,
      this._logFile,
    );
    this.emit(TOKIO_EVENTS.CONNECTED);
    if (viewers !== null) this._goLive(conn, viewers);
    return { success: true };
  }

  private _connection(slug: string): Connection {
    const conn: Connection = {
      slug,
      channelId: 0,
      chatroomId: 0,
      clientId: randomUUID(),
      up: false,
      reconnecting: false,
      live: false,
      wasLive: false,
      offline: 0,
      ids: new Map(),
      socket: new KickSocket(this._config, {
        publication: (_feed, event, data) => this._notify(conn, event, data),
        drop: (why, terminal) => this._drop(conn, why, terminal),
        token: () => guestToken(this._config, conn.clientId),
        log: (message) => Logger.debug(`<Kick> ${message}`, this._logFile),
        warn: (message) => this._logOnce(message, message),
      }),
    };
    return conn;
  }

  /**
   * The channel, a fresh socket on its four feeds, and whether it's live:
   * its viewers, or null. Throws when it couldn't, or the socket dropped
   * meanwhile.
   */
  private async _start(conn: Connection): Promise<number | null> {
    const channel = await lookup(this._config, conn.slug);
    conn.slug = channel.slug;
    conn.channelId = channel.channelId;
    conn.chatroomId = channel.chatroomId;
    const url = await realtime(this._config, conn.clientId);
    const token = await guestToken(this._config, conn.clientId);
    // A stop meanwhile already closed the socket: opening it would leak it
    if (this._conn !== conn) {
      throw connectFailure("canceled", "Disconnected while connecting.");
    }
    // Chat's first. Never chatrooms.<id>: it repeats the hosts.
    await conn.socket.open(url, token, [
      `chatrooms.${channel.chatroomId}.v2`,
      `chatroom_${channel.chatroomId}`,
      `channel.${channel.channelId}`,
      `channel_${channel.channelId}`,
    ]);
    return channel.viewers;
  }

  private _goLive(conn: Connection, viewers?: number) {
    conn.live = conn.wasLive = true;
    conn.offline = 0;
    if (viewers !== undefined) this._viewers(viewers);
    conn.poll ??= setInterval(() => {
      lookup(this._config, conn.slug).then(
        ({ viewers: count }) => {
          if (this._conn !== conn || !conn.live) return;
          if (count !== null) {
            conn.offline = 0;
            this._viewers(count);
          } else if (++conn.offline === 2) {
            this._offline(conn);
          }
        },
        (err) =>
          this._logOnce(
            "viewers",
            `Couldn't get the viewers -- ${formatError(err)}`,
          ),
      );
    }, this._config.VIEWERS_MS);
  }

  private _viewers(viewers: number) {
    this.emit(TOKIO_EVENTS.ROOM_USER, { ranks: [], viewers, views: 0 });
  }

  private _offline(conn: Connection) {
    clearInterval(conn.poll);
    conn.poll = undefined;
    conn.live = false;
    // Only a stream it saw live, so Pause when the LIVE ends works and a
    // channel connected to while offline stays connected
    if (conn.wasLive) this._stop(conn, "ended");
  }

  private _notify(conn: Connection, event: string, data: object) {
    if (this._conn !== conn) return;
    // The event's name only, never what a viewer wrote
    Logger.debug(`<Kick> Feed ${event}`, this._logFile);
    switch (eventName(event)) {
      case "StreamerIsLive":
        this._goLive(conn);
        return;
      case "StopStreamBroadcast":
        this._offline(conn);
        return;
    }
    let mapped: Mapped | null;
    try {
      mapped = fromPublication(event, data);
    } catch (err) {
      // Kick's feed is unofficial: an event whose shape changed is dropped
      // rather than thrown out of the socket's listener
      this._logOnce(
        `feed:${eventName(event)}`,
        `Couldn't read a ${eventName(event)} -- ${formatError(err)}`,
      );
      return;
    }
    if (!mapped) return;
    if (
      mapped.event === TOKIO_EVENTS.CHAT ||
      mapped.event === TOKIO_EVENTS.KICKS
    ) {
      const { username, userId } = mapped.data.user;
      if (userId) conn.ids.set(username.toLowerCase(), Promise.resolve(userId));
    }
    if (mapped.event === TOKIO_EVENTS.CHAT) {
      this.emitChat(mapped.data, () => this._conn === conn);
    } else if (
      mapped.event === TOKIO_EVENTS.GIFT_SUB ||
      mapped.event === TOKIO_EVENTS.SUBSCRIBE
    ) {
      void this._withId(conn, mapped);
    } else {
      this.emit(mapped.event, mapped.data);
    }
  }

  // Kick names a sub gifter or a subscriber by username alone: sent under
  // their id, so the subs land on their record, or without one when it can't
  // be found
  private async _withId(
    conn: Connection,
    mapped: Extract<
      Mapped,
      { event: TOKIO_EVENTS.GIFT_SUB | TOKIO_EVENTS.SUBSCRIBE }
    >,
  ) {
    const { user } = mapped.data;
    const userId = await this._userId(conn, user.username);
    if (this._conn !== conn) return;
    if (userId) mapped.data.user = { ...user, userId };
    this.emit(mapped.event, mapped.data);
  }

  // A username's id from this LIVE's chat and Kicks, else looked up once,
  // a failure logged and kept too
  private _userId(conn: Connection, username: string) {
    const name = username.toLowerCase();
    let id = conn.ids.get(name);
    if (!id) {
      id = name
        ? lookup(this._config, slugOf(name))
            .then(({ userId }) => {
              if (userId === null) throw new Error("It came without its id.");
              return `kick:${userId}`;
            })
            .catch((err: unknown) => {
              Logger.warn(
                `<Kick> Couldn't find the id of a viewer -- ${formatError(err)}`,
                this._logFile,
              );
              return undefined;
            })
        : Promise.resolve(undefined);
      conn.ids.set(name, id);
    }
    return id;
  }

  private _drop(conn: Connection, why: string, terminal: boolean) {
    // A drop while connecting or coming back fails that try instead
    if (this._conn !== conn || !conn.up || conn.reconnecting) return;
    Logger.warn(`<Kick> The connection dropped -- ${why}`, this._logFile);
    conn.reconnecting = true;
    clearInterval(conn.poll);
    conn.poll = undefined;
    this._onReconnect?.("reconnecting");
    void this._reconnect(conn, terminal);
  }

  // Tries again until it's back or the user disconnects. A failure waits
  // RECONNECT_MIN_MS doubling up to RECONNECT_MAX_MS; a terminal one waits
  // TERMINAL_MIN_MS doubling up to TERMINAL_MAX_MS, then comes back as a
  // new client.
  private async _reconnect(conn: Connection, terminal: boolean) {
    const { RECONNECT_MIN_MS, RECONNECT_MAX_MS } = this._config;
    const { TERMINAL_MIN_MS, TERMINAL_MAX_MS } = this._config;
    let viewers: number | null;
    let tries = 0;
    let terminals = 0;
    for (let attempt = 1; ; attempt++) {
      let delay: number;
      if (terminal) {
        const base = Math.min(
          TERMINAL_MAX_MS,
          TERMINAL_MIN_MS * 2 ** terminals++,
        );
        delay = base * (1 + Math.random() / 4);
        conn.clientId = randomUUID();
      } else {
        delay = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** tries++);
      }
      if (!(await this._pause(conn, delay))) return;
      // Once per try, so a drop that lasts says so again
      this._onReconnect?.("reconnecting");
      try {
        viewers = await this._start(conn);
        break;
      } catch (err) {
        if (this._conn !== conn) return;
        terminal = isTerminal(err);
        this._logOnce(
          "reconnect",
          `Couldn't reconnect (attempt ${attempt}) -- ${formatError(err)}`,
        );
      }
    }
    if (this._conn !== conn) return;
    conn.reconnecting = false;
    Logger.info(`<Kick> Reconnected to @${conn.slug}.`, this._logFile);
    this._onReconnect?.("reconnected");
    // The stream ended or started while away
    if (viewers !== null) this._goLive(conn, viewers);
    else if (conn.wasLive) this._offline(conn);
  }

  // The wait between tries: false when a stop ended it
  private _pause(conn: Connection, ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      conn.retry = setTimeout(() => resolve(true), ms);
      conn.wake = () => resolve(false);
    });
  }

  // Every stop: DISCONNECTED once a connect worked, after the events
  // already sent, as the TikTok provider does
  private _stop(conn: Connection, reason?: "ended") {
    if (this._conn !== conn) return;
    this._conn = null;
    conn.socket.close();
    clearInterval(conn.poll);
    clearTimeout(conn.retry);
    conn.wake?.();
    if (!conn.up) return;
    Logger.info(
      `<Kick> Disconnected${reason ? " -- the stream ended" : ""}.`,
      this._logFile,
    );
    setImmediate(() => {
      this.emit(TOKIO_EVENTS.DISCONNECTED, reason ? { reason } : undefined);
    });
  }

  // An error that can come on every try or event, logged once per
  // LOG_REPEAT_MS
  private _logOnce(code: string, message: string) {
    const now = Date.now();
    const last = this._logged.get(code);
    if (last !== undefined && now - last < this._config.LOG_REPEAT_MS) return;
    this._logged.set(code, now);
    Logger.warn(`<Kick> ${message}`, this._logFile);
  }
}
