import {
  PLATFORMS,
  Platform,
  PlatformStatus,
  LivePlatform,
  RoomUserEvent,
  TOKIO_EVENTS,
  TokioEventMap,
} from "@/common/types";
import { FAKE_LIVE, formatError, PLATFORM_LABELS } from "@/common/util";
import { parseAmount } from "@/helper/amount";
import Logger from "@/logger";
import type { RatesService } from "../rates";
import { ProviderService } from "../shared";
import { TokioEmitter } from "../shared/emitter";
import {
  AccountProvider,
  ChatStage,
  connectFailure,
  ConnectorProvider,
  ConnectorResponse,
  DeviceCode,
  GiftResponse,
  PlatformAccount,
  ReconnectState,
} from "./common";
import {
  FakeConnector,
  TikTokLiveConnector,
  KickConnector,
  TwitchConnector,
  YouTubeConnector,
} from "./providers";

// What a platform did while the session went on without it: came up, or
// stopped with its reason ("stopped" for none)
export type PlatformChange = "up" | "ended" | "lost" | "stopped";

// The events consumers get, which the service sends
class SessionEvents extends TokioEmitter {
  public send<K extends TOKIO_EVENTS>(event: K, data?: TokioEventMap[K]) {
    this.emit(event, data);
  }
}

const isAccountProvider = (
  provider: ConnectorProvider,
): provider is ConnectorProvider & AccountProvider =>
  "signIn" in provider && "setAccount" in provider;

/**
 * One LIVE session across the platforms a profile uses: TikTok through the
 * pool's current backend, and each other platform's own provider. It starts
 * with the first platform up and ends with the last one down.
 */
export class ConnectorService extends ProviderService<ConnectorProvider> {
  private _events = new SessionEvents();
  // Other platforms' providers, kept out of the pool so Settings' TikTok
  // picker and the store never list them
  private _platforms = new Map<Platform, ConnectorProvider>();
  // yarn dev:live's made-up LIVEs, which connect in place of every platform.
  // The real providers still sign in to Twitch and fetch TikTok's gifts.
  private _fakes = new Map<Platform, ConnectorProvider>();
  // The platforms connected now, reconnecting ones included
  private _up = new Set<Platform>();
  // Each platform's last room numbers, merged into the session's
  private _rooms = new Map<Platform, RoomUserEvent>();
  // A Disconnect is stopping them all, so their stops aren't told one by one
  private _stopping = false;
  // The platform whose stop ended the last session
  private _endedBy?: Platform;
  private _channels: Partial<Record<Platform, string>> = {};
  private _username = "";
  private _onReconnect?: (state: ReconnectState, platform: Platform) => void;
  private _onPlatform?: (platform: Platform, change: PlatformChange) => void;
  // Converts a Super Chat's amount to US dollars
  private _rates?: Pick<RatesService, "usdOf">;

  constructor(fake = FAKE_LIVE) {
    super();
    this.addProvider("Default", new TikTokLiveConnector(), true); // NOTE: DO NOT CHANGE, Add your providers below.
    this._addPlatform("twitch", new TwitchConnector());
    this._addPlatform("youtube", new YouTubeConnector());
    this._addPlatform("kick", new KickConnector());
    if (!fake) return;
    for (const platform of PLATFORMS) {
      const provider = new FakeConnector(platform);
      this._fakes.set(platform, provider);
      this._wire(platform, provider, () => true);
    }
  }

  // TikTok's backends forward only while they're the current one
  public override addProvider(
    name: string,
    provider: ConnectorProvider,
    start?: boolean,
  ) {
    this._wire("tiktok", provider, () => this._current.provider === provider);
    super.addProvider(name, provider, start);
  }

  public override setLogFile(logFile: string): void {
    super.setLogFile(logFile);
    this._providers().forEach((provider) => provider.setLogFile(logFile));
  }

  public setChatStage(stage: ChatStage): void {
    this._providers().forEach((provider) => provider.setChatStage(stage));
  }

  public on<T extends TOKIO_EVENTS>(
    event: T,
    listener: (data: TokioEventMap[T]) => void,
  ): void {
    this._events.on(event, listener);
  }

  public off<T extends TOKIO_EVENTS>(
    event: T,
    listener: (data: TokioEventMap[T]) => void,
  ): void {
    this._events.off(event, listener);
  }

  /** Sets what converts the Super Chats to dollars, which every listener gets. */
  public setRates(rates: Pick<RatesService, "usdOf">) {
    this._rates = rates;
  }

  // Every platform's drops, returns and give-ups
  public onReconnect(
    listener: (state: ReconnectState, platform: Platform) => void,
  ) {
    this._onReconnect = listener;
  }

  // A platform up or down while the session goes on with others
  public onPlatform(
    listener: (platform: Platform, change: PlatformChange) => void,
  ) {
    this._onPlatform = listener;
  }

  /**
   * The session's name: the channel of the platform that started it, or the
   * last connect's while none has. Set before CONNECTED fires.
   */
  public get username(): string {
    return this._username;
  }

  // The channel the platform's last connect was for
  public channel(platform: Platform): string {
    return this._channels[platform] ?? "";
  }

  /**
   * Connects the platforms in parallel, each to its channel. One already up
   * answers success at once. Resolves with the first success in the order
   * given, else the first failure; onResult gets each platform's.
   */
  public async connect(
    channels: Partial<Record<Platform, string>>,
    onResult?: (platform: Platform, res: ConnectorResponse) => void,
  ): Promise<ConnectorResponse> {
    this._stopping = false;
    const platforms = PLATFORMS.filter((p) => channels[p] !== undefined);
    if (this._up.size === 0 && platforms.length > 0) {
      this._username = channels[platforms[0]] ?? "";
    }
    const results = await Promise.all(
      platforms.map(async (platform) => {
        const res = this._up.has(platform)
          ? { success: true }
          : await this._connect(platform, channels[platform] ?? "");
        onResult?.(platform, res);
        return res;
      }),
    );
    return (
      results.find((res) => res.success) ??
      results[0] ?? {
        success: false,
        error: connectFailure("unknown", "No platform to connect."),
      }
    );
  }

  // Every platform, or one while the others stay on. One alone isn't
  // _stopping, so its stop is told as that platform's (onPlatform).
  public async disconnect(platform?: Platform): Promise<void> {
    if (platform) {
      await this._provider(platform)?.disconnect();
      return;
    }
    // Cleared when the last stop arrives, on setImmediate
    this._stopping = this._up.size > 0;
    await Promise.all(this._sources().map(([, p]) => p.disconnect()));
  }

  // Any platform connecting, connected, coming back or looking for its LIVE:
  // the profile lock
  public isConnected(): boolean {
    return this._sources().some(([, p]) => p.isConnected());
  }

  // Every platform up is coming back
  public isReconnecting(): boolean {
    return (
      this._up.size > 0 &&
      [...this._up].every((p) => this._provider(p)?.isReconnecting())
    );
  }

  // No session, and TikTok looks for its LIVE again
  public isWaiting(): boolean {
    return this._up.size === 0 && this._current.provider.isWaiting();
  }

  // How each platform that's on is doing; the ones off are left out
  public status(): Partial<Record<Platform, PlatformStatus>> {
    const status: Partial<Record<Platform, PlatformStatus>> = {};
    for (const [platform, p] of this._sources()) {
      if (!p.isConnected()) continue;
      // Up first: TikTok's look sends CONNECTED while it's still waiting
      status[platform] = this._up.has(platform)
        ? p.isReconnecting()
          ? "reconnecting"
          : "connected"
        : p.isWaiting()
          ? "waiting"
          : "connecting";
    }
    return status;
  }

  // The platform whose stop ended the session, set before its DISCONNECTED
  public endedBy(): Platform | undefined {
    return this._endedBy;
  }

  /** Each platform's viewers now, from its last room numbers. */
  public viewers(): Partial<Record<Platform, number>> {
    return Object.fromEntries(
      [...this._rooms].map(([platform, room]) => [platform, room.viewers]),
    );
  }

  /** The platforms up now, reconnecting ones included, with their channels. */
  public livePlatforms(): LivePlatform[] {
    return PLATFORMS.filter((p) => this._up.has(p)).map((platform) => ({
      platform,
      channel: this._provider(platform)?.channel() || this.channel(platform),
    }));
  }

  public async fetchGifts(): Promise<GiftResponse> {
    const res = await this._current.provider.fetchGifts();
    if (!res.success) {
      Logger.warn(
        `<Connector> Unable to fetch gifts -- ${formatError(res.error)}`,
        this._logFile,
      );
    }
    return res;
  }

  // -- The Twitch account, which its provider keeps --

  // The account the store kept, at startup. Nothing to do before Twitch's
  // provider is registered.
  public setTwitchAccount(account: PlatformAccount) {
    this._twitch()?.setAccount(account);
  }

  // Every change to the account, for the store to save
  public onTwitchAccount(
    listener: (account: PlatformAccount) => Promise<boolean>,
  ) {
    this._twitch()?.onAccount(listener);
  }

  public signInTwitch(
    onCode: (code: DeviceCode) => void,
    signal: AbortSignal,
  ): Promise<PlatformAccount> {
    return this._twitchOrThrow().signIn(onCode, signal);
  }

  public signOutTwitch(): Promise<void> {
    return this._twitchOrThrow().signOut();
  }

  // -- Private API --

  // Another platform's provider, outside the pool. Only the constructor
  // adds them, before the log file, chat stage and account listener are set.
  protected _addPlatform(platform: Platform, provider: ConnectorProvider) {
    this._platforms.set(platform, provider);
    this._wire(platform, provider, () => true);
  }

  // The pool's backends, the other platforms' and the made-up ones
  private _providers(): ConnectorProvider[] {
    return [
      ...this._providerPool.values(),
      ...this._platforms.values(),
      ...this._fakes.values(),
    ];
  }

  // The provider each platform connects through now
  private _sources(): [Platform, ConnectorProvider][] {
    if (this._fakes.size > 0) return [...this._fakes];
    return [["tiktok", this._current.provider], ...this._platforms];
  }

  private _provider(platform: Platform): ConnectorProvider | undefined {
    if (this._fakes.size > 0) return this._fakes.get(platform);
    return platform === "tiktok"
      ? this._current.provider
      : this._platforms.get(platform);
  }

  private _twitch() {
    const provider = this._platforms.get("twitch");
    return provider && isAccountProvider(provider) ? provider : undefined;
  }

  private _twitchOrThrow() {
    const provider = this._twitch();
    if (!provider) throw new Error("Twitch's provider isn't registered.");
    return provider;
  }

  // TikTok's log lines stay as they were before other platforms
  private _named(platform: Platform, channel: string) {
    return platform === "tiktok"
      ? channel
      : `${channel} on ${PLATFORM_LABELS[platform]}`;
  }

  private async _connect(
    platform: Platform,
    channel: string,
  ): Promise<ConnectorResponse> {
    const provider = this._provider(platform);
    const named = this._named(platform, channel);
    if (!provider) {
      const error = connectFailure(
        "unknown",
        `${PLATFORM_LABELS[platform]} isn't available.`,
      );
      Logger.error(
        `<Connector> Unable to connect to ${named} -- ${error.message}`,
        this._logFile,
      );
      return { success: false, error };
    }
    this._channels[platform] = channel;
    Logger.debug(`<Connector> Connecting to: ${named}`, this._logFile);
    const res = await provider.connect(channel);
    if (res.error?.kind === "canceled") {
      Logger.info(
        `<Connector> Stopped connecting to ${named}: the user disconnected.`,
        this._logFile,
      );
    } else if (!res.success) {
      Logger.error(
        `<Connector> Unable to connect to ${named} -- ${formatError(res.error)}`,
        this._logFile,
        // formatError carries a known kind's cause, so only a surprise needs
        // its stack.
        res.error?.kind === "unknown" ? res.error : undefined,
      );
    } else {
      Logger.info(`<Connector> Connected to ${named}.`, this._logFile);
    }
    return res;
  }

  // Once per provider, when it's added
  private _wire(
    platform: Platform,
    provider: ConnectorProvider,
    forwards: () => boolean,
  ) {
    const SESSION: readonly TOKIO_EVENTS[] = [
      TOKIO_EVENTS.CONNECTED,
      TOKIO_EVENTS.DISCONNECTED,
      TOKIO_EVENTS.ROOM_USER,
    ];
    for (const event of Object.values(TOKIO_EVENTS)) {
      if (SESSION.includes(event) || event === TOKIO_EVENTS.SUPER_CHAT)
        continue;
      provider.on(event, (data) => {
        if (forwards()) this._events.send(event, data);
      });
    }
    // With its dollars, null when the amount can't be read, or the rates
    // haven't loaded or lack its currency
    provider.on(TOKIO_EVENTS.SUPER_CHAT, (data) => {
      if (!forwards()) return;
      const amount = parseAmount(data.amount);
      const usd = amount
        ? (this._rates?.usdOf(amount.currency, amount.value) ?? null)
        : null;
      this._events.send(TOKIO_EVENTS.SUPER_CHAT, { ...data, usd });
    });
    provider.on(TOKIO_EVENTS.CONNECTED, () => {
      if (forwards()) this._connected(platform);
    });
    provider.on(TOKIO_EVENTS.DISCONNECTED, (data) => {
      if (forwards()) this._disconnected(platform, data);
    });
    provider.on(TOKIO_EVENTS.ROOM_USER, (room) => {
      if (!forwards()) return;
      this._rooms.set(platform, room);
      this._sendRoom();
    });
    provider.onReconnect((state) => {
      if (forwards()) this._onReconnect?.(state, platform);
    });
  }

  // The first platform up starts the session
  private _connected(platform: Platform) {
    const first = this._up.size === 0;
    this._up.add(platform);
    if (!first) {
      this._onPlatform?.(platform, "up");
      return;
    }
    this._username = this._channels[platform] ?? "";
    this._events.send(TOKIO_EVENTS.CONNECTED);
  }

  // The last platform down ends it
  private _disconnected(
    platform: Platform,
    data: TokioEventMap[TOKIO_EVENTS.DISCONNECTED],
  ) {
    if (!this._up.delete(platform)) return;
    this._rooms.delete(platform);
    if (this._up.size === 0) {
      this._stopping = false;
      this._endedBy = platform;
      this._events.send(TOKIO_EVENTS.DISCONNECTED, data);
      return;
    }
    if (this._stopping) return;
    // shortcut: the session's end clears alerts', games' and Studio's gift
    // streaks, a platform's doesn't, so its streaks stay until then. Clear
    // them by platform if a platform's lost combo ever shows.
    this._onPlatform?.(platform, data?.reason ?? "stopped");
    this._sendRoom();
  }

  // TikTok's ranks, everyone's viewers, and each platform's
  private _sendRoom() {
    const rooms = [...this._rooms.values()];
    this._events.send(TOKIO_EVENTS.ROOM_USER, {
      ranks: this._rooms.get("tiktok")?.ranks ?? [],
      viewers: rooms.reduce((sum, room) => sum + room.viewers, 0),
      views: rooms.reduce((sum, room) => sum + room.views, 0),
      platforms: PLATFORMS.flatMap((platform) => {
        const room = this._rooms.get(platform);
        return room
          ? [{ platform, viewers: room.viewers, views: room.views }]
          : [];
      }),
    });
  }
}
