import { TOKIO_EVENTS, TokioEventMap } from "@/common/types";
import { formatError } from "@/common/util";
import Logger from "@/logger";
import { ProviderService } from "../shared";
import {
  ConnectorProvider,
  ConnectorResponse,
  GiftResponse,
  ReconnectState,
} from "./common";
import { TikTokLiveConnector } from "./providers";

export class TikTokConnectorService extends ProviderService<ConnectorProvider> {
  constructor() {
    super();
    this.addProvider("Default", new TikTokLiveConnector(), true); // NOTE: DO NOT CHANGE, Add your providers below.
  }

  public override setLogFile(logFile: string): void {
    super.setLogFile(logFile);
    this._providerPool.forEach((provider) => provider.setLogFile(logFile));
  }

  public on<T extends TOKIO_EVENTS>(
    event: T,
    listener: (data: TokioEventMap[T]) => void,
  ): void {
    this._current.provider.on(event, listener);
  }

  public off<T extends TOKIO_EVENTS>(
    event: T,
    listener: (data: TokioEventMap[T]) => void,
  ): void {
    this._current.provider.off(event, listener);
  }

  public onReconnect(listener: (state: ReconnectState) => void) {
    this._current.provider.onReconnect(listener);
  }

  public async connect(username: string): Promise<ConnectorResponse> {
    Logger.info(`<Connector> Connecting to: ${username}`, this._logFile);
    const res = await this._current.provider.connect(username);
    if (!res.success) {
      Logger.error(
        `<Connector> Unable to connect to ${username} -- ${formatError(res.error)}`,
        this._logFile,
        res.error,
      );
    } else {
      Logger.success(`<Connector> Connected to ${username}.`, this._logFile);
    }
    return res;
  }

  public async disconnect(): Promise<void> {
    await this._current.provider.disconnect();
  }

  public isConnected(): boolean {
    return this._current.provider.isConnected();
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
}
