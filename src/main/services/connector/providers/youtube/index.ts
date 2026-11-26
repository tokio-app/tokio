import { TOKIO_EVENTS } from "@/common/types";
import { formatError } from "@/common/util";
import Logger from "@/logger";
import {
  connectFailure,
  ConnectorProvider,
  ConnectorResponse,
  fail,
  GiftResponse,
  kindOf,
  toFailure,
} from "../../common";
import { fromAction, type Mapped } from "./common/mapping";
import {
  findLive,
  parseInput,
  pollChat,
  pollViewers,
  readChat,
  type Chat,
  type Target,
} from "./common/page";
import defaults, { type YouTubeConfig } from "./config";

type Connection = {
  // Who and what, for the logs
  name: string;
  videoId: string;
  chat: Chat;
  // The next poll's
  continuation: string;
  // CONNECTED went out, so a stop sends DISCONNECTED
  up: boolean;
  reconnecting: boolean;
  // YouTube refused the continuation: read the chat page again
  stale: boolean;
  viewers?: NodeJS.Timeout;
  // The wait before the next poll or try, and its end
  retry?: NodeJS.Timeout;
  wake?: () => void;
  // Each handle's viewer id (youtube:<channel id>) in this LIVE, by its
  // lowercase, for Gifts, which name their sender by handle alone
  ids: Map<string, string>;
};

/**
 * YouTube's LIVE chat with no account or key: it reads the channel's public
 * pages and polls the chat the way youtube.com's own chat does, signed out.
 * Written from what youtube.com sends; no YouTube library's code.
 */
export class YouTubeConnector extends ConnectorProvider {
  private _config: YouTubeConfig;
  private _conn: Connection | null = null;
  // A connect during a connect gets this one
  private _connecting: Promise<ConnectorResponse> | null = null;
  // When each repeating error was last logged
  private _logged = new Map<string, number>();

  // Tests point the URLs, delays and fetch elsewhere
  constructor(options: Partial<YouTubeConfig> = {}) {
    super();
    this._config = { ...defaults, ...options };
  }

  // YouTube's chat needs no key
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
    const target = parseInput(channel);
    if (!target) {
      return fail("notFound", "The link names no YouTube channel or LIVE.");
    }

    const conn: Connection = {
      name: "",
      videoId: "",
      chat: { key: "", context: { client: {} }, continuation: "" },
      continuation: "",
      up: false,
      reconnecting: false,
      stale: false,
      ids: new Map(),
    };
    this._conn = conn;
    let wait: number;
    try {
      for (let tries = 1; ; tries++) {
        try {
          wait = await this._start(conn, target);
          break;
        } catch (err) {
          if (
            tries === this._config.CONNECT_TRIES ||
            kindOf(err) !== "network" ||
            this._conn !== conn
          ) {
            throw err;
          }
          Logger.info(
            `<YouTube> Connecting again in ${this._config.CONNECT_RETRY_MS / 1000} s -- ${formatError(err)}`,
            this._logFile,
          );
          if (!(await this._pause(conn, this._config.CONNECT_RETRY_MS))) {
            throw err;
          }
        }
      }
    } catch (err) {
      // A Disconnect woke the pause or came during a request: not the network
      if (this._conn !== conn) {
        return fail("canceled", "Disconnected while connecting.");
      }
      this._stop(conn);
      return { success: false, error: toFailure(err) };
    }
    // Its requests went on after a Disconnect
    if (this._conn !== conn) {
      return fail("canceled", "Disconnected while connecting.");
    }

    conn.up = true;
    Logger.info(
      `<YouTube> Connected to @${conn.name}'s LIVE ${conn.videoId}.`,
      this._logFile,
    );
    this.emit(TOKIO_EVENTS.CONNECTED);
    void this._viewers(conn);
    conn.viewers = setInterval(
      () => void this._viewers(conn),
      this._config.VIEWERS_MS,
    );
    void this._poll(conn, wait);
    return { success: true };
  }

  // The LIVE, its chat, and the first poll, whose actions are the chat's
  // history. Gives the wait before the next poll.
  private async _start(conn: Connection, target: Target): Promise<number> {
    const live = await findLive(this._config, target);
    conn.videoId = live.videoId;
    conn.name =
      "path" in target && target.path.startsWith("/@")
        ? decodeURIComponent(target.path.slice(2))
        : live.author;
    conn.chat = await readChat(this._config, live.videoId);
    const wait = await this._history(conn);
    if (wait === null) throw connectFailure("offline", "The chat ended.");
    return wait;
  }

  // Polls from the chat page's continuation and drops what comes: gifts
  // carry no time, so the history can't be told apart by it. Null when the
  // chat ended.
  private async _history(conn: Connection): Promise<number | null> {
    const answer = await pollChat(
      this._config,
      conn.chat,
      conn.chat.continuation,
    );
    if (!answer) return null;
    conn.continuation = answer.continuation;
    // Who chatted before, so their Gifts land on their channel id
    for (const action of answer.actions) this._named(conn, fromAction(action));
    return this._wait(answer.timeoutMs);
  }

  // What YouTube asks, at most POLL_MS and at least a third of it, so a
  // timeoutMs of 0 can't poll in a loop
  private _wait(timeoutMs = Infinity) {
    const { POLL_MS } = this._config;
    return Math.max(POLL_MS / 3, Math.min(timeoutMs, POLL_MS));
  }

  // Until the chat ends or a stop. A failed poll reconnects, the wait
  // doubling up to RECONNECT_MAX_MS, never giving up.
  private async _poll(conn: Connection, wait: number) {
    for (let attempt = 0; ;) {
      if (!(await this._pause(conn, wait))) return;
      // Once per try, so a drop that lasts says so again
      if (conn.reconnecting) this._onReconnect?.("reconnecting");
      let next: number | null;
      try {
        if (conn.stale) {
          conn.chat = await readChat(this._config, conn.videoId);
          if (this._conn !== conn) return;
          next = await this._history(conn);
          conn.stale = false;
        } else {
          next = await this._actions(conn);
        }
      } catch (err) {
        if (this._conn !== conn) return;
        const status = statusOf(err);
        // An expired continuation: a fresh one from the chat page
        if (status && status < 500 && status !== 429) conn.stale = true;
        Logger.debug(
          `<YouTube> A poll failed -- ${formatError(err)}`,
          this._logFile,
        );
        if (conn.reconnecting) {
          this._logOnce(
            "reconnect",
            `Couldn't reconnect (attempt ${attempt}) -- ${formatError(err)}`,
          );
        } else {
          Logger.warn(
            `<YouTube> The chat dropped -- ${formatError(err)}`,
            this._logFile,
          );
          conn.reconnecting = true;
          this._onReconnect?.("reconnecting");
        }
        const { RECONNECT_MIN_MS, RECONNECT_MAX_MS } = this._config;
        wait = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** attempt++);
        continue;
      }
      if (this._conn !== conn) return;
      if (next === null) {
        this._stop(conn, "ended");
        return;
      }
      if (conn.reconnecting) {
        conn.reconnecting = false;
        attempt = 0;
        Logger.info(`<YouTube> Reconnected to @${conn.name}.`, this._logFile);
        this._onReconnect?.("reconnected");
      }
      wait = next;
    }
  }

  // One poll's actions to listeners: the wait before the next, null when
  // the chat ended
  private async _actions(conn: Connection): Promise<number | null> {
    const answer = await pollChat(this._config, conn.chat, conn.continuation);
    if (this._conn !== conn || !answer) return null;
    conn.continuation = answer.continuation;
    for (const action of answer.actions) {
      const mapped = this._named(conn, fromAction(action));
      if (!mapped) continue;
      if (mapped.event === TOKIO_EVENTS.CHAT) {
        this.emitChat(mapped.data, () => this._conn === conn);
      } else {
        this.emit(mapped.event, mapped.data);
      }
    }
    return this._wait(answer.timeoutMs);
  }

  /**
   * Remembers a viewer's channel id by handle, and sends a Gift under it
   * when known. A handle not seen in this LIVE keeps youtube:@handle, with
   * no lookup: a Gift has no price, and they can come in bursts.
   */
  private _named(conn: Connection, mapped: Mapped | null): Mapped | null {
    if (!mapped) return null;
    const { user } = mapped.data;
    const handle = user.handle.toLowerCase();
    if (mapped.event !== TOKIO_EVENTS.GIFT) {
      if (user.userId && handle) conn.ids.set(handle, user.userId);
      return mapped;
    }
    const userId = conn.ids.get(handle);
    return userId
      ? { ...mapped, data: { ...mapped.data, user: { ...user, userId } } }
      : mapped;
  }

  // The viewers, until the LIVE ends: its count turns into the video's views
  // within 30 s, while the chat can answer for minutes more
  private async _viewers(conn: Connection) {
    let viewers: number | "ended" | undefined;
    try {
      viewers = await pollViewers(this._config, conn.chat, conn.videoId);
    } catch (err) {
      if (this._conn === conn) {
        this._logOnce(
          "viewers",
          `Couldn't get the viewers -- ${formatError(err)}`,
        );
      }
      return;
    }
    if (this._conn !== conn || viewers === undefined) return;
    if (viewers === "ended") this._stop(conn, "ended");
    else this.emit(TOKIO_EVENTS.ROOM_USER, { ranks: [], viewers, views: 0 });
  }

  // The wait between polls or tries: false when a stop ended it
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
    clearInterval(conn.viewers);
    clearTimeout(conn.retry);
    conn.wake?.();
    if (!conn.up) return;
    Logger.info(
      `<YouTube> Disconnected${reason ? " -- the LIVE ended" : ""}.`,
      this._logFile,
    );
    setImmediate(() => {
      this.emit(TOKIO_EVENTS.DISCONNECTED, reason ? { reason } : undefined);
    });
  }

  // An error that can come on every try or poll, logged once per
  // LOG_REPEAT_MS
  private _logOnce(code: string, message: string) {
    const now = Date.now();
    const last = this._logged.get(code);
    if (last !== undefined && now - last < this._config.LOG_REPEAT_MS) return;
    this._logged.set(code, now);
    Logger.warn(`<YouTube> ${message}`, this._logFile);
  }
}

// shortcut: the connect retries, waits, stops and _logOnce above copy
// Twitch's and Kick's providers; share them when a fourth provider copies
// them again

// What YouTube answered a failed request with
const statusOf = (error: unknown) =>
  error instanceof Error &&
  "status" in error &&
  typeof error.status === "number"
    ? error.status
    : undefined;
