import { Gift } from "@/common/types";
import { TokioEmitter } from "../../shared/emitter";

// What stopped a connect, so the page can say what to do about it.
export type ConnectErrorKind =
  | "offline"
  | "notFound"
  | "rateLimited"
  | "noKey"
  | "badKey"
  | "sign"
  | "network"
  | "unknown";
export type ConnectorFailure = Error & {
  kind: ConnectErrorKind;
  // How long to wait, for "rateLimited"
  retryAfterSeconds?: number;
};
export type ConnectorResponse = { success: boolean; error?: ConnectorFailure };
export type GiftResponse = {
  success: boolean;
  data: Gift[];
  error?: Error;
  warn?: string;
};
export type ReconnectState = "reconnecting" | "reconnected";

export const connectFailure = (
  kind: ConnectErrorKind,
  message: string,
  options?: { cause?: unknown; retryAfterSeconds?: number },
): ConnectorFailure =>
  Object.assign(new Error(message, { cause: options?.cause }), {
    kind,
    retryAfterSeconds: options?.retryAfterSeconds,
  });

export abstract class ConnectorProvider extends TokioEmitter {
  protected _onReconnect?: (state: ReconnectState) => void;
  protected _logFile = "";
  public abstract setKey(key: string): void;
  public abstract connect(
    username: string,
    key?: string,
  ): Promise<ConnectorResponse>;
  public abstract disconnect(): Promise<void>;
  public abstract isConnected(): boolean;
  public abstract fetchGifts(): Promise<GiftResponse>;

  // The service's log file, for what the connection reports while it's up.
  public setLogFile(logFile: string) {
    this._logFile = logFile;
  }

  // Called when the connection drops and is tried again, and once it's back.
  public onReconnect(listener: (state: ReconnectState) => void) {
    this._onReconnect = listener;
  }
}
