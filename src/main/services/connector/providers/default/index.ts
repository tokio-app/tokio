import {
  ChatEvent,
  FollowEvent,
  Gift,
  GiftEvent,
  LikeEvent,
  RoomUserEvent,
  ShareEvent,
  TOKIO_EVENTS,
  TokioEventMap,
  UserData,
} from "@/common/types";
import { delay } from "@/common/util";
import { EventEmitter } from "events";
import type {
  TikTokLiveConnection,
  User,
  UserIdentity,
} from "tiktok-live-connector";
import {
  ConnectorProvider,
  ConnectorResponse,
  GiftResponse,
} from "../../common";
import config from "./config";

type TikTokLive = typeof import("tiktok-live-connector");

export class TikTokLiveConnector extends ConnectorProvider {
  // Loaded on the first connect, startup doesn't need the library.
  private _lib: TikTokLive | null = null;
  private _connector: TikTokLiveConnection | null;
  private _sessionID: string;
  private _username: string;
  private _events: EventEmitter;

  constructor() {
    super();
    this._connector = null;
    this._events = new EventEmitter();
    this._username = "";
    this._sessionID = "";
  }

  // --- PUBLIC API ---

  public setKey(sessionID: string) {
    this._sessionID = sessionID;
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
    sessionID?: string,
  ): Promise<ConnectorResponse> {
    if (this.isConnected()) {
      return {
        success: true,
      };
    }
    this._username = username.replace("@", "") || "";
    this._sessionID = sessionID || "";
    if (!this._username) {
      this.emit(TOKIO_EVENTS.CONNECTED, {
        success: false,
        error: new Error("No username was defined."),
      });
      return {
        success: false,
        error: new Error("No username was defined."),
      };
    }
    const { TikTokLiveConnection, WebcastEvent } = await this._loadLib();
    this._connector = new TikTokLiveConnection(this._username, {
      processInitialData: false,
      session: {
        cookie: {
          type: "cookie",
          value: {
            sessionId: this._sessionID,
            ttTargetIdc: "alisg",
          },
        },
      },
    });
    try {
      const state = await this._connector.connect();
      if (state.isConnected) {
        this.emit(TOKIO_EVENTS.CONNECTED, {
          success: true,
        });
        await delay(1000);
        this.registerEvents();
        this._connector.on(WebcastEvent.STREAM_END, async () => {
          await this._close();
          this.emit(TOKIO_EVENTS.DISCONNECTED, { reason: "ended" });
        });
        return {
          success: true,
        };
      }
      this.emit(TOKIO_EVENTS.CONNECTED, {
        success: false,
        error: new Error("Unable to connect with unknown reason."),
      });
      return {
        success: false,
        error: new Error("Unable to connect with unknown reason."),
      };
    } catch (err) {
      this.emit(TOKIO_EVENTS.CONNECTED, {
        success: false,
        error: err as Error,
      });
      return {
        success: false,
        error: err as Error,
      };
    }
  }

  public async disconnect(): Promise<void> {
    if (await this._close()) this.emit(TOKIO_EVENTS.DISCONNECTED);
  }

  // Closes the connection, true when there was one.
  private async _close(): Promise<boolean> {
    if (!this.isConnected()) return false;
    try {
      await this._connector?.disconnect();
    } catch {
      // Next
    }
    return true;
  }

  public isConnected(): boolean {
    return this._connector?.isConnected || false;
  }

  private extractRawGifts(data: any): any[] {
    if (!data?.data) return [];

    const payload = data.data;
    return payload.gifts || payload.giftList || payload.pages?.[0]?.gifts || [];
  }

  private formatGift(g: any): Gift {
    return {
      id: g.id,
      name: g.name,
      coins: g.diamond_count,
      image: g.image?.url_list?.[0],
    };
  }

  public async fetchGifts(): Promise<GiftResponse> {
    try {
      const region = await this.getUserRegionAndLanguage();
      const url = this.getGiftURL(region.data.language, region.data.region);

      const response = await fetch(url, {
        method: "GET",
        headers: config.HEADERS,
        signal: AbortSignal.timeout(config.REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);

      const data = await response.json();

      const rawGifts = this.extractRawGifts(data);
      const mapper = (g: any) => this.formatGift(g);
      const availableGifts: Gift[] = rawGifts.map(mapper);

      const uniqueData = [
        ...new Map(availableGifts.map((item) => [item.id, item])).values(),
      ];

      return {
        data: uniqueData,
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

  private async _loadLib(): Promise<TikTokLive> {
    this._lib ??= await import("tiktok-live-connector");
    return this._lib;
  }

  private emit<K extends TOKIO_EVENTS>(
    event: K,
    data?: TokioEventMap[K],
  ): void {
    this._events.emit(event, data);
  }

  private registerEvents(): void {
    if (!this._connector || !this._lib) return;
    const { WebcastEvent } = this._lib;

    this._connector.on(WebcastEvent.SHARE, (tdata) => {
      const user = this.getUserData({
        user: tdata.user,
      });
      const shareCount = tdata.shareCount || 0;
      const data: ShareEvent = {
        shareCount,
        user,
      };
      this.emit(TOKIO_EVENTS.SHARE, data);
    });

    this._connector.on(WebcastEvent.FOLLOW, (tdata) => {
      const user = this.getUserData({
        user: tdata.user,
      });
      const data: FollowEvent = {
        user,
      };
      this.emit(TOKIO_EVENTS.FOLLOW, data);
    });

    this._connector.on(WebcastEvent.CHAT, (tdata) => {
      const user = this.getUserData({
        user: tdata.user,
        userIdentity: tdata.userIdentity,
      });
      const emotes: {
        emoteID: string;
        images: string[];
        index: number;
      }[] = [];
      if (tdata.emotes.length > 0) {
        for (const em of tdata.emotes) {
          emotes.push({
            emoteID: this.withDefault(em.emote?.emoteId, ""),
            images: this.withDefault(em.emote?.image?.urlList, []),
            index: em.index,
          });
        }
      }
      const comment = {
        content: tdata.content,
        emotes: emotes,
        lang: tdata.contentLanguage,
      };
      const data: ChatEvent = {
        user,
        comment,
      };
      this.emit(TOKIO_EVENTS.CHAT, data);
    });

    this._connector.on(WebcastEvent.GIFT, (tdata) => {
      const user = this.getUserData({
        user: tdata.user,
      });
      const gift = {
        id: this.withDefault(tdata.giftId, ""),
        type: this.withDefault(tdata.gift?.type, 1),
        name: this.withDefault(tdata.gift?.name, ""),
        repeatEnd: this.withDefault(tdata.repeatEnd, 1) == 1,
        coins: this.withDefault(tdata.gift?.diamondCount, 0),
        comboCount: this.withDefault(tdata.repeatCount, 0),
        image: this.withDefault(tdata.gift?.image?.urlList?.[0], ""),
      };
      const data: GiftEvent = {
        user,
        gift,
      };
      this.emit(TOKIO_EVENTS.GIFT, data);
    });

    this._connector.on(WebcastEvent.LIKE, (tdata) => {
      const user = this.getUserData({
        user: tdata.user,
      });
      const data: LikeEvent = {
        user,
        likeCount: tdata.count ?? 0,
        totalLikes: Number(tdata.total ?? "0"),
      };
      this.emit(TOKIO_EVENTS.LIKE, data);
    });

    this._connector.on(WebcastEvent.ENVELOPE, () => {
      this.emit(TOKIO_EVENTS.ENVELOPE);
    });

    this._connector.on(WebcastEvent.SUPER_FAN_BOX, () => {
      this.emit(TOKIO_EVENTS.SUPER_FAN_BOX);
    });

    this._connector.on(WebcastEvent.SUPER_FAN, (tdata) => {
      const user = this.getUserData({ user: tdata.user });
      this.emit(TOKIO_EVENTS.SUPER_FAN, {
        user,
      });
    });

    this._connector.on(WebcastEvent.MEMBER, (tdata) => {
      const user = this.getUserData({ user: tdata.user });
      this.emit(TOKIO_EVENTS.MEMBER_JOIN, { user });
    });

    this._connector.on(WebcastEvent.SUPER_FAN_JOIN, (tdata) => {
      const user = this.getUserData({ user: tdata.user });
      this.emit(TOKIO_EVENTS.SUPER_FAN_JOIN, { user });
    });

    this._connector.on(WebcastEvent.ROOM_USER, (tdata) => {
      const ranks: RoomUserEvent["ranks"] = [];
      for (const rank of tdata.ranks) {
        const user = rank.user;
        ranks.push({
          // Same as getUserData
          username: this.withDefault(user?.nickname, ""),
          handle: this.withDefault(user?.displayId, ""),
          profilePictures: this.withDefault(user?.avatarThumb?.urlList, []),
          score: this.withDefault(Number(rank.score), 0),
          position: this.withDefault(Number(rank.rank), 0),
        });
      }
      const viewers = this.withDefault(Number(tdata.total), 0);
      const views = this.withDefault(Number(tdata.totalUser), 0);
      this.emit(TOKIO_EVENTS.ROOM_USER, { ranks, viewers, views });
    });
  }

  // --- HELPER METHODS ---

  private getFanLevel(badgeList?: any[]): number {
    if (!badgeList || badgeList.length === 0) return 0;

    const fanBadge = badgeList.find((b) =>
      b.combine?.icon?.uri?.includes("fans_badge"),
    );

    return Number(fanBadge?.privilegeLogExtra?.level || 0);
  }

  private withDefault<T>(data: T | undefined | null, defaultValue: T): T {
    if (data === undefined || data === null) {
      return defaultValue;
    }

    if (typeof data === "number" && isNaN(data)) return defaultValue;

    return data;
  }

  private getUserData({
    user,
    userIdentity,
  }: {
    user?: User;
    userIdentity?: UserIdentity;
  }): UserData {
    return {
      username: this.withDefault(user?.nickname, ""),
      handle: this.withDefault(user?.displayId, ""),
      profilePictures: this.withDefault(user?.avatarThumb?.urlList, []),
      superfan: this.withDefault(userIdentity?.isSubscriberOfAnchor, false),
      follower: this.withDefault(userIdentity?.isFollowerOfAnchor, false),
      moderator: this.withDefault(userIdentity?.isModeratorOfAnchor, false),
      fanLevel: this.getFanLevel(user?.badgeList),
    };
  }

  private getGiftURL(lang: string, region: string) {
    return `${config.GIFTS_URL}/?aid=1988&app_language=${lang}&region=${region}&sys_region=${region}`;
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
