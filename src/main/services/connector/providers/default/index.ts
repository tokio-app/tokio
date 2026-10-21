import {
  ChatEvent,
  GiftEvent,
  RoomUserEvent,
  TOKIO_EVENTS,
  TokioEventMap,
  UserData,
} from "@/common/types";
import {
  EulerSigner,
  isConnectorError,
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
import { EventEmitter } from "events";
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

export class TikTokLiveConnector extends ConnectorProvider {
  private _connection: TikTokLiveConnection | null = null;
  // The user's Euler Stream API key, which signs the connection
  private _key = "";
  private _events = new EventEmitter();
  // When each error code was last logged
  private _logged = new Map<string, number>();
  // A connect during a connect gets this one, so only one connection opens
  private _connecting: Promise<ConnectorResponse> | null = null;

  // --- PUBLIC API ---

  public setKey(key: string) {
    this._key = key;
  }

  public on<K extends TOKIO_EVENTS>(
    event: K,
    listener: (data: TokioEventMap[K]) => void,
  ): void {
    this._events.on(event, listener);
  }

  public off<K extends TOKIO_EVENTS>(
    event: K,
    listener: (data: TokioEventMap[K]) => void,
  ): void {
    this._events.off(event, listener);
  }

  public connect(username: string, key?: string): Promise<ConnectorResponse> {
    return (this._connecting ??= this._connect(username, key).finally(() => {
      this._connecting = null;
    }));
  }

  private async _connect(
    username: string,
    key?: string,
  ): Promise<ConnectorResponse> {
    if (this.isConnected()) return { success: true };
    this._key = key ?? this._key;
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
        // Its warnings and errors explain drops and failed reconnects, the
        // rest is routine.
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
          }
        },
      });
      // Before connecting, so no event of the LIVE is missed.
      this._listen(connection);
      this._connection = connection;
      await connection.connect();
      return { success: true };
    } catch (err) {
      // A first connect that fails never emits disconnected.
      connection?.removeAllListeners();
      if (this._connection === connection) this._connection = null;
      return { success: false, error: toFailure(err) };
    }
  }

  public async disconnect(): Promise<void> {
    // The connection then emits disconnected, with reason "user".
    await this._connection?.disconnect();
  }

  // Also while connecting and coming back, so a profile can't switch then.
  public isConnected(): boolean {
    const state = this._connection?.state;
    return (
      state === "connecting" ||
      state === "connected" ||
      state === "reconnecting"
    );
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

  private emit<K extends TOKIO_EVENTS>(
    event: K,
    data?: TokioEventMap[K],
  ): void {
    this._events.emit(event, data);
  }

  private _listen(connection: TikTokLiveConnection): void {
    // Before the room's first messages, so the session starts before them.
    connection.on(WebcastEvent.CONNECTED, ({ reconnected }) => {
      if (reconnected) this._onReconnect?.("reconnected");
      else this.emit(TOKIO_EVENTS.CONNECTED, { success: true });
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
        if (why === "user") {
          this.emit(TOKIO_EVENTS.DISCONNECTED);
        } else {
          // streamEnd comes first when the LIVE ended
          const reason = why === "streamEnd" ? "ended" : "lost";
          this.emit(TOKIO_EVENTS.DISCONNECTED, { reason });
        }
      },
    );

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
      this.emit(TOKIO_EVENTS.CHAT, data);
    });

    connection.on(WebcastEvent.GIFT, (tdata) => {
      const data: GiftEvent = {
        user: getUserData(tdata.user),
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
      this.emit(TOKIO_EVENTS.GIFT, data);
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
      const ranks: RoomUserEvent["ranks"] = tdata.ranks.map((rank) => ({
        // Same as getUserData
        username: rank.user?.nickname ?? "",
        handle: rank.user?.displayId ?? "",
        profilePictures: rank.user?.avatarThumb?.urlList ?? [],
        score: rank.score,
        position: rank.rank,
      }));
      this.emit(TOKIO_EVENTS.ROOM_USER, {
        ranks,
        viewers: tdata.total,
        views: tdata.totalUser,
      });
    });
  }
}

// --- HELPERS ---

function getFanLevel(badgeList: Badge[] = []): number {
  const fanBadge = badgeList.find((b) =>
    b.combine?.icon?.uri.includes("fans_badge"),
  );
  return Number(fanBadge?.privilegeLogExtra?.level || 0);
}

function getUserData(user?: User, userIdentity?: UserIdentity): UserData {
  return {
    username: user?.nickname ?? "",
    handle: user?.displayId ?? "",
    profilePictures: user?.avatarThumb?.urlList ?? [],
    superfan: userIdentity?.isSubscriberOfAnchor ?? false,
    follower: userIdentity?.isFollowerOfAnchor ?? false,
    moderator: userIdentity?.isModeratorOfAnchor ?? false,
    fanLevel: getFanLevel(user?.badgeList),
  };
}

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
    case "SIGN_FAILED":
    case "PREMIUM_REQUIRED": {
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
