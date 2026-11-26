import { TOKIO_EVENTS, UserData } from "@/common/types";
import { formatError } from "@/common/util";
import Logger from "@/logger";
import {
  AccountProvider,
  connectFailure,
  ConnectorProvider,
  ConnectorResponse,
  DeviceCode,
  fail,
  GiftResponse,
  kindOf,
  PlatformAccount,
  toFailure,
} from "../../common";
import { failureOf, TwitchAuth } from "./common/auth";
import { EventSub } from "./common/eventsub";
import {
  fromBits,
  fromFollow,
  fromNotification,
  fromRedemption,
  toChat,
  type Mapped,
} from "./common/mapping";
import defaults, { type TwitchConfig } from "./config";

// What Tokio listens to, for the signed-in account's own channel. The
// condition's other ids are the same account, as reader or moderator.
const SUBSCRIPTIONS: { type: string; version: string; as?: string }[] = [
  // The only one a connect needs
  { type: "channel.chat.message", version: "1", as: "user_id" },
  // Subs, resubs, gifted subs and raids
  { type: "channel.chat.notification", version: "1", as: "user_id" },
  { type: "channel.follow", version: "2", as: "moderator_user_id" },
  { type: "channel.bits.use", version: "1" },
  { type: "channel.channel_points_custom_reward_redemption.add", version: "1" },
  { type: "stream.online", version: "1" },
  { type: "stream.offline", version: "1" },
];
const CHAT = "channel.chat.message";

const MAPPERS: Record<string, (event: any) => Mapped | null> = {
  "channel.chat.notification": fromNotification,
  "channel.follow": fromFollow,
  "channel.bits.use": fromBits,
  "channel.channel_points_custom_reward_redemption.add": fromRedemption,
};

type Connection = {
  eventsub: EventSub;
  // The account's Twitch id, the broadcaster's
  userId: string;
  // CONNECTED went out, so a stop sends DISCONNECTED
  up: boolean;
  reconnecting: boolean;
  live: boolean;
  // Live at connect or since, so the stream's end ends the connection
  wasLive: boolean;
  poll?: NodeJS.Timeout;
  validate?: NodeJS.Timeout;
  // The wait before a connect's or a reconnect's next try, and its end
  retry?: NodeJS.Timeout;
  wake?: () => void;
  // Events waiting for their picture, which a stop sends without it
  held: Set<Mapped>;
};

/**
 * Twitch through the streamer's own account: EventSub over WebSocket for
 * the channel's events, Helix for whether it's live, its viewers and
 * pictures. Written from Twitch's docs.
 */
export class TwitchConnector
  extends ConnectorProvider
  implements AccountProvider
{
  private _config: TwitchConfig;
  private _auth: TwitchAuth;
  private _conn: Connection | null = null;
  // A connect during a connect gets this one
  private _connecting: Promise<ConnectorResponse> | null = null;
  // Viewers' pictures by Twitch id, the last looked up kept
  private _pictures = new Map<string, string>();
  // The picture lookups of the minute since lookupsSince
  private _lookups = 0;
  private _lookupsSince = 0;
  // When each repeating error was last logged
  private _logged = new Map<string, number>();

  // Tests point the URLs and delays elsewhere
  constructor(options: Partial<TwitchConfig> = {}) {
    super();
    this._config = { ...defaults, ...options };
    this._auth = new TwitchAuth(this._config, () => this._logFile);
    // A refused refresh or a revocation stops the connection
    this._auth.onLost = () => {
      if (this._conn) this._stop(this._conn, "lost");
    };
  }

  // --- ACCOUNT ---

  public setAccount(account: PlatformAccount) {
    this._auth.setAccount(account);
  }

  public onAccount(listener: (account: PlatformAccount) => Promise<boolean>) {
    this._auth.onAccount(listener);
  }

  public signIn(
    onCode: (code: DeviceCode) => void,
    signal: AbortSignal,
  ): Promise<PlatformAccount> {
    return this._auth.signIn(onCode, signal);
  }

  public async signOut() {
    await this.disconnect();
    await this._auth.signOut();
  }

  // --- CONNECTION ---

  // Twitch connects with the account, not a key
  public setKey() {}

  // The channel is the account's own, whatever the profile names
  public connect(_channel?: string): Promise<ConnectorResponse> {
    return (this._connecting ??= this._connect().finally(() => {
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

  private async _connect(): Promise<ConnectorResponse> {
    if (this._conn) return { success: true };
    if (!this._config.CLIENT_ID) {
      return fail("noKey", "Tokio has no Twitch client ID.");
    }
    if (!this._auth.account.key) {
      // Twitch refused the last account: the user signs in again
      return this._auth.lost
        ? fail("badKey", "Twitch signed the account out.")
        : fail("noKey", "No Twitch account is signed in.");
    }

    const conn = this._connection();
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
            this._conn !== conn
          ) {
            throw err;
          }
          Logger.info(
            `<Twitch> Connecting again in ${this._config.CONNECT_RETRY_MS / 1000} s -- ${formatError(err)}`,
            this._logFile,
          );
          if (!(await this._pause(conn, this._config.CONNECT_RETRY_MS))) {
            throw err;
          }
        }
      }
    } catch (err) {
      // A Disconnect closed the socket or woke the pause; a sign-out also
      // stops the connection but says so itself
      if (this._conn !== conn && !this._auth.lost) {
        return fail("canceled", "Disconnected while connecting.");
      }
      this._stop(conn);
      return { success: false, error: toFailure(err) };
    }

    conn.up = true;
    conn.validate = setInterval(
      () => this._revalidate(conn),
      this._config.VALIDATE_MS,
    );
    Logger.info(
      `<Twitch> Connected to @${this._auth.account.login}${viewers !== null ? ", live" : ", not live"}.`,
      this._logFile,
    );
    this.emit(TOKIO_EVENTS.CONNECTED);
    if (viewers !== null) this._goLive(conn, viewers);
    return { success: true };
  }

  private _connection(): Connection {
    const conn: Connection = {
      userId: this._auth.account.id,
      up: false,
      reconnecting: false,
      live: false,
      wasLive: false,
      held: new Set(),
      eventsub: new EventSub(
        this._config.EVENTSUB_URL,
        this._config.KEEPALIVE_GRACE_MS,
        this._config.REQUEST_TIMEOUT_MS,
        {
          notification: (type, event) => this._notify(conn, type, event),
          revocation: (sub) => {
            Logger.warn(
              `<Twitch> Twitch ended the ${sub.type} subscription -- ${sub.status}`,
              this._logFile,
            );
            if (
              sub.status === "authorization_revoked" ||
              sub.status === "user_removed"
            ) {
              void this._auth.lose();
            }
          },
          drop: (why) => this._drop(conn, why),
          log: (message) => Logger.debug(`<Twitch> ${message}`, this._logFile),
        },
      ),
    };
    return conn;
  }

  /**
   * A fresh socket with its subscriptions, and whether the channel is live:
   * its viewers, or null. Throws when it couldn't, or the socket dropped
   * meanwhile.
   */
  private async _start(conn: Connection): Promise<number | null> {
    const { userId, login } = await this._auth.validate();
    // Stopped meanwhile: a socket opened now would never be closed
    if (this._conn !== conn) {
      throw connectFailure("canceled", "Disconnected while connecting.");
    }
    conn.userId = userId;
    const session = await conn.eventsub.open();
    await this._subscribe(session, userId);
    const viewers = await this._streams(conn).catch((err) => {
      this._logOnce(
        "streams",
        `Couldn't check whether @${login} is live -- ${formatError(err)}`,
      );
      return null;
    });
    // Checked last, with nothing awaited after: a drop before it fails the
    // try, and one after it reconnects
    if (!conn.eventsub.connected) {
      throw connectFailure(
        "network",
        "The EventSub socket dropped while connecting.",
      );
    }
    return viewers;
  }

  private async _subscribe(session: string, userId: string) {
    const url = `${this._config.HELIX_URL}/eventsub/subscriptions`;
    await Promise.all(
      SUBSCRIPTIONS.map(async ({ type, version, as }) => {
        const condition: Record<string, string> = {
          broadcaster_user_id: userId,
        };
        if (as) condition[as] = userId;
        let res: Response;
        try {
          res = await this._auth.request(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              type,
              version,
              condition,
              transport: { method: "websocket", session_id: session },
            }),
          });
        } catch (err) {
          // A 429 skips the event like a 403; the network fails the try
          if (type === CHAT || kindOf(err) !== "rateLimited") throw err;
          this._logOnce(
            `subscribe:${type}`,
            `Skipped ${type} -- ${formatError(err)}`,
          );
          return;
        }
        if (res.ok) return;
        const failure = await failureOf(res, `subscription to ${type}`);
        if (type === CHAT) throw failure;
        // A channel that isn't affiliate has no Bits nor channel points (403)
        this._logOnce(`subscribe:${type}`, failure.message);
      }),
    );
  }

  // The channel's viewers while it's live, null while it isn't
  private async _streams(conn: Connection): Promise<number | null> {
    const res = await this._auth.request(
      `${this._config.HELIX_URL}/streams?user_id=${conn.userId}`,
    );
    if (!res.ok) throw await failureOf(res, "streams");
    const { data }: { data: { viewer_count: number }[] } = await res.json();
    return data[0]?.viewer_count ?? null;
  }

  private _goLive(conn: Connection, viewers?: number) {
    conn.live = conn.wasLive = true;
    if (viewers !== undefined) this._viewers(viewers);
    conn.poll ??= setInterval(() => {
      this._streams(conn).then(
        (count) => {
          if (this._conn === conn && conn.live && count !== null) {
            this._viewers(count);
          }
        },
        (err) =>
          this._logOnce(
            "streams",
            `Couldn't get the viewers -- ${formatError(err)}`,
          ),
      );
    }, this._config.STREAMS_POLL_MS);
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

  private _notify(conn: Connection, type: string, event: any) {
    if (this._conn !== conn) return;
    switch (type) {
      case CHAT: {
        const chat = toChat(event, conn.userId);
        if (chat) this.emitChat(chat, () => this._conn === conn);
        return;
      }
      case "stream.online":
        this._goLive(conn);
        return;
      case "stream.offline":
        this._offline(conn);
        return;
    }
    const mapped = MAPPERS[type]?.(event);
    if (!mapped) return;
    conn.held.add(mapped);
    void this._picture(mapped.data.user).then(() => {
      if (conn.held.delete(mapped) && this._conn === conn) {
        this.emit(mapped.event, mapped.data);
      }
    });
  }

  // shortcut: chat goes without pictures (Avatar shows the initial); look
  // them up in batches when chat pictures are worth the requests
  private async _picture(user: UserData) {
    const id = user.userId?.replace("twitch:", "");
    if (!id || user.profilePictures.length) return;
    let url = this._pictures.get(id);
    if (url === undefined) {
      const now = Date.now();
      if (now - this._lookupsSince >= 60_000) {
        this._lookupsSince = now;
        this._lookups = 0;
      }
      // Past the minute's lookups, it goes out without its picture
      if (this._lookups >= this._config.PICTURE_LOOKUPS) return;
      this._lookups++;
      try {
        const res = await this._auth.request(
          `${this._config.HELIX_URL}/users?id=${id}`,
        );
        if (!res.ok) throw await failureOf(res, "users");
        const { data }: { data: { profile_image_url?: string }[] } =
          await res.json();
        url = data[0]?.profile_image_url ?? "";
      } catch (err) {
        this._logOnce(
          "users",
          `Couldn't get a viewer's picture -- ${formatError(err)}`,
        );
        return;
      }
    }
    // The last used goes to the end, and the oldest out
    this._pictures.delete(id);
    this._pictures.set(id, url);
    if (this._pictures.size > this._config.PICTURES_KEPT) {
      this._pictures.delete(this._pictures.keys().next().value!);
    }
    if (url) user.profilePictures = [url];
  }

  // Twitch asks for a check every hour; a refused account stops it
  private _revalidate(conn: Connection) {
    this._auth.validate().catch((err) => {
      if (this._conn !== conn) return;
      if (kindOf(err) === "badKey") void this._auth.lose();
      else
        this._logOnce(
          "validate",
          `Couldn't check the token -- ${formatError(err)}`,
        );
    });
  }

  private _drop(conn: Connection, why: string) {
    // A drop while connecting or coming back fails that try instead
    if (this._conn !== conn || !conn.up || conn.reconnecting) return;
    Logger.warn(`<Twitch> The connection dropped -- ${why}`, this._logFile);
    conn.reconnecting = true;
    clearInterval(conn.poll);
    conn.poll = undefined;
    this._onReconnect?.("reconnecting");
    void this._reconnect(conn);
  }

  // Tries again until it's back or the user disconnects, the wait doubling
  // up to RECONNECT_MAX_MS. A fresh socket subscribes again.
  private async _reconnect(conn: Connection) {
    let viewers: number | null;
    for (let attempt = 0; ; attempt++) {
      const { RECONNECT_MIN_MS, RECONNECT_MAX_MS } = this._config;
      const delay = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** attempt);
      if (!(await this._pause(conn, delay))) return;
      // Once per try, so a drop that lasts says so again
      this._onReconnect?.("reconnecting");
      try {
        viewers = await this._start(conn);
        break;
      } catch (err) {
        if (this._conn !== conn) return;
        this._logOnce(
          "reconnect",
          `Couldn't reconnect (attempt ${attempt + 1}) -- ${formatError(err)}`,
        );
      }
    }
    if (this._conn !== conn) return;
    conn.reconnecting = false;
    Logger.info(
      `<Twitch> Reconnected to @${this._auth.account.login}.`,
      this._logFile,
    );
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
  private _stop(conn: Connection, reason?: "ended" | "lost") {
    if (this._conn !== conn) return;
    this._conn = null;
    conn.eventsub.close();
    clearInterval(conn.poll);
    clearInterval(conn.validate);
    clearTimeout(conn.retry);
    conn.wake?.();
    if (!conn.up) return;
    // Before DISCONNECTED, as they came before the stop
    for (const mapped of conn.held) this.emit(mapped.event, mapped.data);
    conn.held.clear();
    const why =
      reason === "ended"
        ? " -- the stream ended"
        : reason === "lost"
          ? " -- Twitch signed the account out"
          : "";
    Logger.info(`<Twitch> Disconnected${why}.`, this._logFile);
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
    Logger.warn(`<Twitch> ${message}`, this._logFile);
  }
}
