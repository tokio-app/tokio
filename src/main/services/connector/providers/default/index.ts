import {
  ChatEvent,
  GiftEvent,
  RoomUserEvent,
  TOKIO_EVENTS,
  UserData,
} from "@/common/types";
import {
  EulerSigner,
  isConnectorError,
  isStreakable,
  isStreakEnd,
  TikTokLiveConnection,
  WebcastEvent,
  RateLimitError,
  SignError,
  type Badge,
  type User,
  type UserIdentity,
} from "@tokioapp/connector";
import { formatError } from "@/common/util";
import Logger from "@/logger";
import { app } from "electron";
import {
  ConnectErrorKind,
  connectFailure,
  ConnectorFailure,
  ConnectorProvider,
  ConnectorResponse,
  GiftResponse,
} from "../../common";
import config from "./config";

// A message type TikTok changed fails on every message, so an error code is
// logged at most this often.
const LOG_REPEAT_MS = 30_000;

// TikTok ends a streak 3 to 4 s after its last gift, so a combo it never ends
// ends this long after its last one.
const COMBO_END_MS = 4000;

// Never gives up while the user stays connected, and once a drop lasts, tries
// every 7.5 to 15 s, so it's back soon after the network (the user's calls).
const RECONNECT = { maxAttempts: Infinity, maxDelayMs: 15_000 };

// Euler's signed connect took over 10 s on flaky networks, failing reconnects
// and losing gaps; TikTok's own requests keep the library's 10 s, so a dead
// network still fails a connect as fast (the user's call).
const SIGN_TIMEOUT_MS = 20_000;

// A connect that failed on the network is tried this many times in all, this
// far apart. Any other failure is told at once (the user's call).
const CONNECT_TRIES = 3;
const CONNECT_RETRY_MS = 3000;

// After an abnormal stop, the LIVE is looked for this long, a try this often
// (the user's call).
const WAIT_MS = 120_000;
const WAIT_TRY_MS = 10_000;

export class TikTokLiveConnector extends ConnectorProvider {
  private _connection: TikTokLiveConnection | null = null;
  // The user's Euler Stream API key, which signs the connection
  private _key = "";
  // When each error code was last logged
  private _logged = new Map<string, number>();
  // A connect during a connect gets this one, so only one connection opens
  private _connecting: Promise<ConnectorResponse> | null = null;
  // Ends the wait between a connect's tries, for disconnect()
  private _cancelRetry?: () => void;
  // The look for the LIVE after an abnormal stop, and when it ends
  private _waiting: { timer?: NodeJS.Timeout } | null = null;
  private _waitUntil = 0;

  // --- PUBLIC API ---

  public setKey(key: string) {
    this._key = key;
  }

  // One the user asked for replaces the look for the LIVE.
  public connect(username: string): Promise<ConnectorResponse> {
    this._stopWaiting();
    return this._open(username);
  }

  private _open(username: string): Promise<ConnectorResponse> {
    return (this._connecting ??= this._connect(username).finally(() => {
      this._connecting = null;
    }));
  }

  private async _connect(username: string): Promise<ConnectorResponse> {
    if (this._live()) return { success: true };
    const name = username.replace("@", "");
    if (!name) {
      return {
        success: false,
        error: connectFailure("notFound", "No username was set."),
      };
    }
    if (!this._key) {
      return {
        success: false,
        error: connectFailure("noKey", "No Euler Stream API key was set."),
      };
    }

    let connection: TikTokLiveConnection | undefined;
    try {
      connection = new TikTokLiveConnection(name, {
        signer: new EulerSigner({ apiKey: this._key }),
        reconnect: RECONNECT,
        signTimeoutMs: SIGN_TIMEOUT_MS,
        // Its warnings and errors explain drops and failed reconnects, and its
        // info lines when it connects, tries again and stops. The rest is
        // routine, so only Detailed logs write it.
        logger: (level, message, data) => {
          if (level === "warn") {
            // A drop's error holds the close code and reason
            const why = data?.error ? ` -- ${formatError(data.error)}` : "";
            Logger.warn(`<Connector> ${message}${why}`, this._logFile);
          } else if (level === "error") {
            const error = data?.error;
            const code = isConnectorError(error) ? error.code : message;
            const now = Date.now();
            const last = this._logged.get(code);
            if (last !== undefined && now - last < LOG_REPEAT_MS) return;
            this._logged.set(code, now);
            Logger.error(`<Connector> ${message}`, this._logFile, error);
          } else if (level === "info") {
            const attempt =
              typeof data?.attempt === "number" && data.attempt > 0
                ? ` (attempt ${data.attempt})`
                : "";
            // A stop's failure, whose own line the repeat limit may have dropped
            const why = data?.error ? ` -- ${formatError(data.error)}` : "";
            Logger.info(
              `<Connector> ${message}${attempt}${why}`,
              this._logFile,
            );
          } else {
            Logger.debug(`<Connector> ${message}`, this._logFile);
          }
        },
      });
      // Before connecting, so no event of the LIVE is missed.
      this._listen(connection);
      this._connection = connection;
      for (let tries = 1; ; tries++) {
        try {
          await connection.connect();
          return { success: true };
        } catch (err) {
          if (tries === CONNECT_TRIES || !canRetry(err)) throw err;
          Logger.info(
            `<Connector> Connecting again in ${CONNECT_RETRY_MS / 1000} s -- ${formatError(err)}`,
            this._logFile,
          );
          if (!(await this._pause(CONNECT_RETRY_MS))) throw err;
        }
      }
    } catch (err) {
      // A first connect that fails never emits disconnected.
      connection?.removeAllListeners();
      if (this._connection === connection) this._connection = null;
      return { success: false, error: toFailure(err) };
    }
  }

  public async disconnect(): Promise<void> {
    this._stopWaiting();
    this._cancelRetry?.();
    // The connection then emits disconnected, with reason "user".
    await this._connection?.disconnect();
  }

  // Also while connecting, coming back and looking for the LIVE again, so a
  // profile can't switch then.
  public isConnected(): boolean {
    return this._live() || this._connecting !== null || this._waiting !== null;
  }

  public override isReconnecting(): boolean {
    return this._connection?.state === "reconnecting";
  }

  public override isWaiting(): boolean {
    return this._waiting !== null;
  }

  public async fetchGifts(): Promise<GiftResponse> {
    try {
      // Gifts are fetched at startup, before any connect. Without a room
      // the connection only asks for the region's list, which needs neither
      // a user nor the signer, so any username does.
      const connection =
        this._connection ??
        new TikTokLiveConnection("tiktok", {
          requestTimeoutMs: config.REQUEST_TIMEOUT_MS,
        });
      const { gifts } = await connection.fetchGifts({
        region: app.getLocaleCountryCode() || "US",
        language: app.getLocale(),
      });

      return {
        data: gifts.map((g) => ({
          id: Number(g.id),
          name: g.name,
          coins: g.diamondCount,
          image: g.image?.urlList[0] ?? "",
        })),
        success: true,
      };
    } catch (err) {
      return {
        success: false,
        data: [],
        error: new Error("Failed to fetch Gifts", { cause: err }),
      };
    }
  }

  // -- Private API --

  // The connection's own state: connecting, connected or coming back
  private _live(): boolean {
    const state = this._connection?.state;
    return (
      state === "connecting" ||
      state === "connected" ||
      state === "reconnecting"
    );
  }

  // The wait between a connect's tries: false when disconnect() ended it
  private _pause(ms: number): Promise<boolean> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this._cancelRetry = undefined;
        resolve(true);
      }, ms);
      this._cancelRetry = () => {
        clearTimeout(timer);
        this._cancelRetry = undefined;
        resolve(false);
      };
    });
  }

  // Looks for the LIVE again after an abnormal stop, a try every WAIT_TRY_MS.
  // A LIVE it connects to that stops again keeps the first stop's deadline, so
  // a room that ends at once can't loop.
  private _wait(username: string) {
    const now = Date.now();
    if (this._waitUntil <= now) this._waitUntil = now + WAIT_MS;
    const until = this._waitUntil;
    const waiting: { timer?: NodeJS.Timeout } = {};
    this._waiting = waiting;
    Logger.info(
      `<Connector> Looking for @${username}'s LIVE for ${Math.round((until - now) / 1000)} s.`,
      this._logFile,
    );
    const next = () => {
      // The first try too, after the stop: the LIVE isn't back at once
      waiting.timer = setTimeout(async () => {
        const res = await this._open(username);
        // A Connect, a Disconnect or another stop took over
        if (this._waiting !== waiting) return;
        const kind = res.error?.kind;
        if (res.success) {
          this._waiting = null;
          this._onReconnect?.("reconnected");
        } else if (
          Date.now() >= until ||
          kind === "noKey" ||
          kind === "badKey" ||
          kind === "premium"
        ) {
          this._waiting = null;
          Logger.info(
            `<Connector> Stopped looking for @${username}'s LIVE -- ${formatError(res.error)}`,
            this._logFile,
          );
          this._onReconnect?.("stopped");
        } else {
          next();
        }
      }, WAIT_TRY_MS);
    };
    next();
  }

  // A Connect or a Disconnect ends the look, and the next stop gets all of it
  private _stopWaiting() {
    clearTimeout(this._waiting?.timer);
    this._waiting = null;
    this._waitUntil = 0;
  }

  private _listen(connection: TikTokLiveConnection): void {
    // Whether the LIVE ended while the connection was away: a reconnect found
    // the room ended, or the end was in the batches a reconnect caught up
    // with, which the library dispatches in the same tick as connected.
    let catchingUp = false;
    let endedAway = false;

    // Before the room's first messages, so the session starts before them.
    connection.on(WebcastEvent.CONNECTED, ({ reconnected }) => {
      if (!reconnected) {
        this.emit(TOKIO_EVENTS.CONNECTED);
        return;
      }
      catchingUp = true;
      setImmediate(() => {
        catchingUp = false;
      });
      this._onReconnect?.("reconnected");
    });

    connection.on(WebcastEvent.STREAM_END, () => {
      endedAway = catchingUp || connection.state === "reconnecting";
    });

    connection.on(
      WebcastEvent.DISCONNECTED,
      ({ reason: why, willReconnect }) => {
        if (willReconnect) {
          this._onReconnect?.("reconnecting");
          return;
        }
        connection.removeAllListeners();
        if (this._connection === connection) this._connection = null;
        // Only an abnormal stop (the user's call): the connection was lost, or
        // the LIVE ended while it was away. Before DISCONNECTED, which reads it.
        if (why !== "user" && (why !== "streamEnd" || endedAway)) {
          this._wait(connection.username);
        }
        // Later, so the handlers of the batch it ended with finish first
        setImmediate(() => {
          if (why === "user") {
            this.emit(TOKIO_EVENTS.DISCONNECTED);
          } else {
            // streamEnd comes first when the LIVE ended
            const reason = why === "streamEnd" ? "ended" : "lost";
            this.emit(TOKIO_EVENTS.DISCONNECTED, { reason });
          }
        });
      },
    );

    // Once per attempt, so a drop that lasts says so again
    connection.on(WebcastEvent.RECONNECTING, () => {
      this._onReconnect?.("reconnecting");
    });

    connection.on(WebcastEvent.SHARE, (tdata) => {
      this.emit(TOKIO_EVENTS.SHARE, {
        shareCount: tdata.shareCount,
        user: getUserData(tdata.user),
      });
    });

    connection.on(WebcastEvent.FOLLOW, (tdata) => {
      this.emit(TOKIO_EVENTS.FOLLOW, { user: getUserData(tdata.user) });
    });

    connection.on(WebcastEvent.CHAT, (tdata) => {
      const data: ChatEvent = {
        user: getUserData(tdata.user, tdata.userIdentity),
        comment: {
          content: tdata.content,
          emotes: tdata.emotes.map((em) => ({
            emoteID: em.emote?.emoteId ?? "",
            images: em.emote?.image?.urlList ?? [],
            index: em.index,
          })),
          lang: tdata.contentLanguage,
        },
      };
      this.emitChat(data, () => this._connection === connection);
    });

    // A comment made of emotes only, so Emote alerts and actions see it too
    connection.on(WebcastEvent.EMOTE, (tdata) => {
      const data: ChatEvent = {
        user: getUserData(tdata.user, tdata.userIdentity),
        comment: {
          content: "",
          // index is a place in content, which is empty
          emotes: tdata.emoteList.map((emote) => ({
            emoteID: emote.emoteId,
            images: emote.image?.urlList ?? [],
            index: 0,
          })),
          lang: "",
        },
      };
      this.emitChat(data, () => this._connection === connection);
    });

    // A combo of a gift that isn't streakable (Hand Heart) comes as one
    // message per gift, each with repeatCount 1, and TikTok never ends it.
    // Its gifts are added up here, by sender and gift, so it reaches listeners
    // like a streak: a growing comboCount, then one end.
    const combos = new Map<
      string,
      { group: string; event: GiftEvent; timer: NodeJS.Timeout }
    >();
    const endCombo = (key: string) => {
      const combo = combos.get(key);
      if (!combo) return;
      clearTimeout(combo.timer);
      combos.delete(key);
      // Listeners forget their streaks once the connection stops
      if (this._connection !== connection) return;
      const { event } = combo;
      this.emit(TOKIO_EVENTS.GIFT, {
        ...event,
        gift: { ...event.gift, repeatEnd: true },
      });
    };

    connection.on(WebcastEvent.GIFT, (tdata) => {
      const data: GiftEvent = {
        user: getUserData(tdata.user, tdata.userIdentity),
        gift: {
          id: tdata.giftId,
          type: tdata.gift?.type ?? 1,
          name: tdata.gift?.name ?? "",
          // The event to count: the end of a combo, or a gift without one
          repeatEnd: isStreakEnd(tdata),
          coins: tdata.gift?.diamondCount ?? 0,
          comboCount: tdata.repeatCount,
          image: tdata.gift?.image?.urlList[0] ?? "",
        },
      };
      if (!tdata.gift?.combo || isStreakable(tdata)) {
        this.emit(TOKIO_EVENTS.GIFT, data);
        return;
      }

      const key = `${data.user.userId}:${data.gift.id}`;
      // TikTok's group id tells a new combo from the last one
      if (combos.get(key)?.group !== tdata.groupId) endCombo(key);
      const last = combos.get(key);
      clearTimeout(last?.timer);
      const comboCount =
        (last?.event.gift.comboCount ?? 0) + Math.max(1, tdata.repeatCount);
      const event = {
        ...data,
        gift: { ...data.gift, repeatEnd: false, comboCount },
      };
      // A reconnect delivers the gap's gifts once back, so the combo waits
      const end = (): NodeJS.Timeout =>
        setTimeout(() => {
          const combo = combos.get(key);
          if (combo && connection.state === "reconnecting") combo.timer = end();
          else endCombo(key);
        }, COMBO_END_MS);
      combos.set(key, { group: tdata.groupId, event, timer: end() });
      this.emit(TOKIO_EVENTS.GIFT, event);
    });

    connection.on(WebcastEvent.LIKE, (tdata) => {
      this.emit(TOKIO_EVENTS.LIKE, {
        user: getUserData(tdata.user),
        likeCount: tdata.count,
        totalLikes: tdata.total,
      });
    });

    connection.on(WebcastEvent.ENVELOPE, () => {
      this.emit(TOKIO_EVENTS.ENVELOPE);
    });

    connection.on(WebcastEvent.SUPER_FAN_BOX, () => {
      this.emit(TOKIO_EVENTS.SUPER_FAN_BOX);
    });

    connection.on(WebcastEvent.SUPER_FAN, (tdata) => {
      this.emit(TOKIO_EVENTS.SUPER_FAN, { user: getUserData(tdata.user) });
    });

    connection.on(WebcastEvent.MEMBER, (tdata) => {
      this.emit(TOKIO_EVENTS.MEMBER_JOIN, { user: getUserData(tdata.user) });
    });

    connection.on(WebcastEvent.SUPER_FAN_JOIN, (tdata) => {
      this.emit(TOKIO_EVENTS.SUPER_FAN_JOIN, {
        user: getUserData(tdata.user),
      });
    });

    connection.on(WebcastEvent.ROOM_USER, (tdata) => {
      const ranks: RoomUserEvent["ranks"] = tdata.ranks.map((rank) => {
        const { username, handle, profilePictures, userId } = getUserData(
          rank.user,
        );
        return {
          username,
          handle,
          profilePictures,
          userId,
          score: rank.score,
          position: rank.rank,
        };
      });
      this.emit(TOKIO_EVENTS.ROOM_USER, {
        ranks,
        viewers: tdata.total,
        views: tdata.totalUser,
      });
    });
  }
}

// --- HELPERS ---

// The fan club's badge, with the fan level and its picture
function getFanBadge(badgeList: Badge[] = []): Badge | undefined {
  return badgeList.find((b) => b.combine?.icon?.uri.includes("fans_badge"));
}

function getUserData(user?: User, userIdentity?: UserIdentity): UserData {
  const fanBadge = getFanBadge(user?.badgeList);
  const level = Number(fanBadge?.privilegeLogExtra?.level || 0);
  return {
    username: user?.nickname ?? "",
    handle: user?.displayId ?? "",
    profilePictures: user?.avatarThumb?.urlList ?? [],
    superfan: userIdentity?.isSubscriberOfAnchor ?? false,
    follower: userIdentity?.isFollowerOfAnchor ?? false,
    moderator: userIdentity?.isModeratorOfAnchor ?? false,
    fanLevel: Number.isFinite(level) ? level : 0,
    fanBadge: fanBadge?.combine?.icon?.urlList[0] ?? "",
    userId: user?.userId ?? "",
  };
}

// A failure trying again can fix (the network, a timeout, a refused socket,
// Euler's 5xx), but not a rate limit, which the streamer waits out.
const canRetry = (error: unknown) =>
  isConnectorError(error) &&
  error.retryable &&
  !(error instanceof RateLimitError);

// The library's error codes are stable, its messages are for logs.
function toFailure(error: unknown): ConnectorFailure {
  if (!isConnectorError(error)) {
    return connectFailure("unknown", String(error), { cause: error });
  }
  const fail = (kind: ConnectErrorKind) =>
    connectFailure(kind, error.message, { cause: error });
  switch (error.code) {
    case "OFFLINE":
      return fail("offline");
    case "ROOM_NOT_FOUND":
      // Every lookup failed on the network, which doesn't mean no such user
      return fail(error.retryable ? "network" : "notFound");
    case "INVALID_USERNAME":
      return fail("notFound");
    case "RATE_LIMITED": {
      const ms =
        error instanceof RateLimitError ? error.retryAfterMs : undefined;
      return connectFailure("rateLimited", error.message, {
        cause: error,
        retryAfterSeconds: ms && Math.ceil(ms / 1000),
      });
    }
    case "PREMIUM_REQUIRED":
      return fail("premium");
    case "SIGN_FAILED": {
      const status = error instanceof SignError ? error.status : undefined;
      return fail(status === 401 || status === 403 ? "badKey" : "sign");
    }
    case "NETWORK":
    case "TIMEOUT":
    case "WEBSOCKET":
      return fail("network");
    default:
      return fail("unknown");
  }
}
