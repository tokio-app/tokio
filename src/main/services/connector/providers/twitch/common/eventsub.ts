// Twitch's EventSub over WebSocket, from its docs: a session's welcome, its
// keepalives, the reconnect Twitch asks for, and its notifications.
import { formatError } from "@/common/util";
import WebSocket from "ws";
import { connectFailure, discard } from "../../../common";

type Envelope = {
  metadata?: {
    message_id: string;
    message_type: string;
    subscription_type?: string;
  };
  payload?: {
    session?: {
      id: string;
      keepalive_timeout_seconds?: number | null;
      reconnect_url?: string | null;
    };
    subscription?: { type: string; status: string };
    event?: any;
  };
};

export interface EventSubHandlers {
  // The event as Twitch sent it, which mapping.ts types
  notification(type: string, event: any): void;
  revocation(subscription: { type: string; status: string }): void;
  // The socket closed or went quiet: open() makes a fresh one, whose
  // subscriptions are made again
  drop(why: string): void;
  log(message: string): void;
}

// Message ids kept to drop the ones Twitch sends again
const SEEN_KEPT = 1000;

export class EventSub {
  private _socket: WebSocket | null = null;
  // The socket a session_reconnect opened, until its welcome
  private _next: WebSocket | null = null;
  private _opening: {
    resolve: (sessionId: string) => void;
    reject: (error: Error) => void;
  } | null = null;
  private _watchdog?: NodeJS.Timeout;
  // open()'s wait for its welcome, which the keepalive watchdog can't cover
  // before the first message
  private _welcome?: NodeJS.Timeout;
  private _keepaliveMs = 10_000;
  private _seen = new Set<string>();

  constructor(
    private _url: string,
    private _graceMs: number,
    private _welcomeMs: number,
    private _handlers: EventSubHandlers,
  ) {}

  // Welcomed, and not dropped since
  public get connected(): boolean {
    return this._socket !== null && this._opening === null;
  }

  // A fresh socket: resolves with its session id once Twitch welcomes it
  public open(): Promise<string> {
    this.close();
    return new Promise((resolve, reject) => {
      const opening = { resolve, reject };
      this._opening = opening;
      const socket = this._attach(new WebSocket(this._url));
      this._socket = socket;
      this._welcome = setTimeout(() => {
        if (this._opening !== opening) return;
        this._opening = null;
        this._socket = null;
        discard(socket);
        reject(
          connectFailure(
            "network",
            `No welcome came on the EventSub socket in ${this._welcomeMs / 1000} s.`,
          ),
        );
      }, this._welcomeMs);
    });
  }

  public close() {
    clearTimeout(this._watchdog);
    clearTimeout(this._welcome);
    discard(this._socket);
    discard(this._next);
    this._socket = this._next = null;
    const opening = this._opening;
    this._opening = null;
    opening?.reject(
      connectFailure("network", "The EventSub socket was closed."),
    );
  }

  private _attach(socket: WebSocket): WebSocket {
    let error: Error | undefined;
    // ws answers Twitch's pings itself. Twitch closes a socket that sends
    // anything else, so nothing is ever sent.
    socket.on("error", (err) => {
      error = err;
    });
    socket.on("message", (raw: Buffer) =>
      this._message(socket, raw.toString("utf8")),
    );
    socket.on("close", (code, reason) => {
      if (socket === this._next) {
        // The old socket goes on until Twitch closes it, which is a drop
        this._next = null;
        this._handlers.log(
          `The reconnect socket closed (${code}) before its welcome.`,
        );
        return;
      }
      if (socket !== this._socket) return;
      this._socket = null;
      clearTimeout(this._watchdog);
      const text = reason.toString();
      const why = `closed (${code}${text ? ` ${text}` : ""})${error ? ` -- ${formatError(error)}` : ""}`;
      const opening = this._opening;
      this._opening = null;
      if (opening) {
        opening.reject(
          connectFailure("network", `The EventSub socket ${why}`, {
            cause: error,
          }),
        );
      } else {
        this._handlers.drop(why);
      }
    });
    return socket;
  }

  private _message(socket: WebSocket, raw: string) {
    let message: Envelope;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    const { metadata, payload } = message;
    // Detailed logs say what came, keepalives aside
    if (metadata && metadata.message_type !== "session_keepalive") {
      this._handlers.log(
        `EventSub ${metadata.message_type}${metadata.subscription_type ? ` ${metadata.subscription_type}` : ""}`,
      );
    }
    switch (metadata?.message_type) {
      case "session_welcome": {
        const session = payload?.session;
        if (!session) return;
        this._keepaliveMs = (session.keepalive_timeout_seconds ?? 10) * 1000;
        if (socket === this._next) {
          // The new socket took over: its subscriptions carried over
          this._next = null;
          discard(this._socket);
          this._socket = socket;
        } else if (socket === this._socket && this._opening) {
          clearTimeout(this._welcome);
          this._opening.resolve(session.id);
          this._opening = null;
        }
        this._feed(socket);
        return;
      }
      case "session_keepalive":
        this._feed(socket);
        return;
      case "session_reconnect": {
        const url = payload?.session?.reconnect_url;
        if (socket !== this._socket || !url) return;
        discard(this._next);
        // As given: it carries the session
        this._next = this._attach(new WebSocket(url));
        this._feed(socket);
        return;
      }
      case "notification":
        this._feed(socket);
        if (!this._fresh(metadata.message_id) || !metadata.subscription_type) {
          return;
        }
        this._handlers.notification(metadata.subscription_type, payload?.event);
        return;
      case "revocation":
        this._feed(socket);
        if (!this._fresh(metadata.message_id) || !payload?.subscription) return;
        this._handlers.revocation(payload.subscription);
        return;
    }
  }

  // Twitch can send a message again: its id tells
  private _fresh(id: string): boolean {
    if (this._seen.has(id)) return false;
    this._seen.add(id);
    if (this._seen.size > SEEN_KEPT) {
      this._seen.delete(this._seen.values().next().value!);
    }
    return true;
  }

  // Any message shows the socket is alive; none for a keepalive's time
  // means it dropped without closing
  private _feed(socket: WebSocket) {
    if (socket !== this._socket) return;
    clearTimeout(this._watchdog);
    this._watchdog = setTimeout(() => {
      if (this._socket !== socket) return;
      this._socket = null;
      discard(socket);
      this._handlers.drop(`no message for ${this._keepaliveMs / 1000} s`);
    }, this._keepaliveMs + this._graceMs);
  }
}
