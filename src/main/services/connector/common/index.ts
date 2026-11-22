import { ChatEvent, Gift, TOKIO_EVENTS, TokioEventMap } from "@/common/types";
import { formatError } from "@/common/util";
import Logger from "@/logger";
import { TokioEmitter } from "../../shared/emitter";

// What stopped a connect, so the page can say what to do about it.
export type ConnectErrorKind =
  | "offline"
  | "notFound"
  | "rateLimited"
  | "noKey"
  | "badKey"
  // The Euler Stream plan doesn't include the connection
  | "premium"
  | "sign"
  // The LIVE has its chat turned off
  | "noChat"
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
};
// "stopped": looking for the LIVE again after it stopped gave up
export type ReconnectState = "reconnecting" | "reconnected" | "stopped";
// Takes a chat before listeners get it: null sends it on at once, a promise
// once it settles. The promise never rejects.
export type ChatStage = (chat: ChatEvent) => Promise<ChatEvent> | null;

// The account a platform signs in with (Twitch's): key is the refresh token,
// which the store keeps encrypted and nothing logs
export type PlatformAccount = { id: string; login: string; key: string };

// What a sign-in shows while it waits: the code, and the platform's page
// with it filled in
export type DeviceCode = { code: string; uri: string; expiresAt: number };

// A provider that connects with the streamer's account instead of a key
export interface AccountProvider {
  // The account the store kept, at startup
  setAccount(account: PlatformAccount): void;
  // A sign-in, a sign-out or a refresh changed it: the store saves it, before
  // the provider uses a new access token, as each refresh token works once
  onAccount(listener: (account: PlatformAccount) => Promise<boolean>): void;
  // Waits for the streamer to approve the code, until signal aborts it
  signIn(
    onCode: (code: DeviceCode) => void,
    signal: AbortSignal,
  ): Promise<PlatformAccount>;
  signOut(): Promise<void>;
}

export const connectFailure = (
  kind: ConnectErrorKind,
  message: string,
  options?: { cause?: unknown; retryAfterSeconds?: number },
): ConnectorFailure =>
  Object.assign(new Error(message, { cause: options?.cause }), {
    kind,
    retryAfterSeconds: options?.retryAfterSeconds,
  });

// A failed connect's result
export const fail = (
  kind: ConnectErrorKind,
  message: string,
): ConnectorResponse => ({
  success: false,
  error: connectFailure(kind, message),
});

export const isFailure = (error: unknown): error is ConnectorFailure =>
  error instanceof Error && "kind" in error && typeof error.kind === "string";

export const kindOf = (error: unknown) =>
  isFailure(error) ? error.kind : undefined;

// What a connect answers for anything it threw
export const toFailure = (error: unknown): ConnectorFailure =>
  isFailure(error)
    ? error
    : connectFailure("unknown", formatError(error), { cause: error });

export abstract class ConnectorProvider extends TokioEmitter {
  protected _onReconnect?: (state: ReconnectState) => void;
  protected _logFile = "";
  private _chatStage?: ChatStage;
  public abstract setKey(key: string): void;
  public abstract connect(username: string): Promise<ConnectorResponse>;
  public abstract disconnect(): Promise<void>;
  public abstract isConnected(): boolean;
  public abstract fetchGifts(): Promise<GiftResponse>;

  // The service's log file, for what the connection reports while it's up.
  public setLogFile(logFile: string) {
    this._logFile = logFile;
  }

  // Called when the connection drops and is tried again, once it's back, and
  // when looking for the LIVE again after a stop gives up.
  public onReconnect(listener: (state: ReconnectState) => void) {
    this._onReconnect = listener;
  }

  // The connection dropped and is coming back.
  public isReconnecting(): boolean {
    return false;
  }

  // The LIVE stopped on its own, and it's looked for again.
  public isWaiting(): boolean {
    return false;
  }

  // Chat translation, set once by init.ts
  public setChatStage(stage: ChatStage) {
    this._chatStage = stage;
  }

  // Emits a chat the stage gave back, only that chat waiting for it, so a
  // staged one can land after later ones. current() false drops it: its
  // connection stopped meanwhile.
  protected emitChat(chat: ChatEvent, current: () => boolean) {
    const staged = this._chatStage?.(chat);
    if (!staged) {
      this.emit(TOKIO_EVENTS.CHAT, chat);
      return;
    }
    void staged.then((out) => {
      if (current()) this.emit(TOKIO_EVENTS.CHAT, out);
    });
  }

  // Detailed logs get a line per event, never what a chat says. Room users
  // come every few seconds and only feed overlays.
  protected override emit<K extends TOKIO_EVENTS>(
    event: K,
    data?: TokioEventMap[K],
  ): void {
    if (event !== TOKIO_EVENTS.ROOM_USER) {
      const payload: TokioEventMap[TOKIO_EVENTS] | undefined = data;
      const what =
        payload && "gift" in payload
          ? ` ${payload.gift.name} x${payload.gift.comboCount}${payload.gift.repeatEnd ? " (end)" : ""}`
          : "";
      const who =
        payload && "user" in payload
          ? payload.user.handle
            ? ` from @${payload.user.handle}`
            : " from an anonymous viewer"
          : "";
      Logger.debug(`<Connector> ${event}${what}${who}`, this._logFile);
    }
    super.emit(event, data);
  }
}
