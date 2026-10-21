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
import Logger from "@/logger";
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

export class TikTokLiveConnector extends ConnectorProvider {
  private _connection: TikTokLiveConnection | null = null;
  // The user's Euler Stream API key, which signs the connection
  private _key = "";
  private _events = new EventEmitter();

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

  public async connect(
    username: string,
    key?: string,
  ): Promise<ConnectorResponse> {
    if (this.isConnected()) return { success: true };
    this._key = key ?? this._key;
    const name = username.replace("@", "");
    if (!name) {
      return this._failed(connectFailure("notFound", "No username was set."));
    }
    if (!this._key) {
      return this._failed(
        connectFailure("noKey", "No Euler Stream API key was set."),
      );
    }

    let connection: TikTokLiveConnection | undefined;
    try {
      connection = new TikTokLiveConnection(name, {
        signer: new EulerSigner({ apiKey: this._key }),
        // Its warnings and errors explain drops and failed reconnects, the
        // rest is routine.
        logger: (level, message, data) => {
          if (level === "warn") {
            Logger.warn(`<Connector> ${message}`, this._logFile);
          } else if (level === "error") {
            Logger.error(`<Connector> ${message}`, this._logFile, data?.error);
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
      return this._failed(toFailure(err));
    }
  }

  public async disconnect(): Promise<void> {
    // The connection then emits disconnected, with reason "user".
    await this._connection?.disconnect();
  }

  // Still connected while the connection tries to come back.
  public isConnected(): boolean {
    const state = this._connection?.state;
    return state === "connected" || state === "reconnecting";
  }

  public async fetchGifts(): Promise<GiftResponse> {
    try {
      const region = await this.getUserRegionAndLanguage();
      // Gifts are fetched at startup, before any connect. Without a room
      // the connection only asks for the region's list, which needs neither
      // a user nor the signer, so any username does.
      const connection =
        this._connection ??
        new TikTokLiveConnection("tiktok", {
          requestTimeoutMs: config.REQUEST_TIMEOUT_MS,
        });
      const { gifts } = await connection.fetchGifts(region.data);

      return {
        data: gifts.map((g) => ({
          id: Number(g.id),
          name: g.name,
          coins: g.diamondCount,
          image: g.image?.urlList[0] ?? "",
        })),
        warn: region.error?.message,
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

  private _failed(error: ConnectorFailure): ConnectorResponse {
    const res = { success: false, error };
    this.emit(TOKIO_EVENTS.CONNECTED, res);
    return res;
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

  private async getUserRegionAndLanguage(): Promise<{
    data: { region: string; language: string };
    error?: Error;
  }> {
    try {
      const response = await fetch(config.GEO_API_URL, {
        headers: config.HEADERS,
        signal: AbortSignal.timeout(config.REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        throw new Error(`GeoIP API failed with status: ${response.status}`);
      }

      const data = await response.json();

      const region = data.country_code || "US";

      const firstLanguage = data.languages
        ? data.languages.split(",")[0]
        : "en-US";
      return { data: { region, language: firstLanguage } };
    } catch (err) {
      return {
        data: { region: "US", language: "en-US" },
        error: new Error("Failed to fetch user region", { cause: err }),
      };
    }
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
      const { retryAfterMs } =
        error instanceof RateLimitError ? error : { retryAfterMs: undefined };
      return connectFailure("rateLimited", error.message, {
        cause: error,
        retryAfterSeconds:
          retryAfterMs === undefined
            ? undefined
            : Math.ceil(retryAfterMs / 1000),
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
