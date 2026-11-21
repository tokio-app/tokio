// Signing in with Twitch: the Device Code Grant Flow of a public client (no
// secret), its refresh tokens, and the requests made with the access token.
// From Twitch's authentication docs.
import { formatError } from "@/common/util";
import Logger from "@/logger";
import {
  connectFailure,
  ConnectorFailure,
  type DeviceCode,
  type PlatformAccount,
} from "../../../common";
import type { TwitchConfig } from "../config";

export const NO_ACCOUNT: PlatformAccount = { id: "", login: "", key: "" };

type Tokens = { access_token: string; refresh_token: string };

type ApiInit = {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
};

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", stop);
      resolve();
    }, ms);
    const stop = () => {
      clearTimeout(timer);
      reject(signal.reason);
    };
    signal.addEventListener("abort", stop, { once: true });
  });

// Twitch's error bodies are { status, message }; never a token
async function reasonOf(res: Response): Promise<string> {
  const body: { message?: string; error?: string } | null = await res
    .json()
    .catch(() => null);
  return `${res.status} ${body?.message ?? body?.error ?? res.statusText}`;
}

// A failed answer as a connect failure, which says what to do about it
export async function failureOf(
  res: Response,
  what: string,
): Promise<ConnectorFailure> {
  const message = `Twitch's ${what} answered ${await reasonOf(res)}`;
  if (res.status === 429) {
    // Ratelimit-Reset is when the bucket fills again, in epoch seconds
    const reset = Number(res.headers.get("ratelimit-reset"));
    const seconds = reset ? Math.ceil(reset - Date.now() / 1000) : 0;
    return connectFailure("rateLimited", message, {
      retryAfterSeconds: seconds > 0 ? seconds : undefined,
    });
  }
  if (res.status >= 500) return connectFailure("network", message);
  if (res.status === 401 || res.status === 403) {
    return connectFailure("badKey", message);
  }
  return connectFailure("unknown", message);
}

export class TwitchAuth {
  private _account = NO_ACCOUNT;
  // Lasts about 4 hours, and lives only in memory
  private _token = "";
  private _refreshing: Promise<string> | null = null;
  private _listener?: (account: PlatformAccount) => Promise<boolean>;
  // Twitch refused the account (a refresh, a revocation): the next connect
  // says to sign in again, until a sign-in
  public lost = false;
  // The account was refused while connected
  public onLost?: () => void;

  constructor(
    private _config: TwitchConfig,
    private _logFile: () => string,
  ) {}

  public get account(): PlatformAccount {
    return this._account;
  }

  public setAccount(account: PlatformAccount) {
    this._account = account;
    this._token = "";
    this.lost = false;
  }

  public onAccount(listener: (account: PlatformAccount) => Promise<boolean>) {
    this._listener = listener;
  }

  public async signIn(
    onCode: (code: DeviceCode) => void,
    signal: AbortSignal,
  ): Promise<PlatformAccount> {
    const { CLIENT_ID, SCOPES } = this._config;
    if (!CLIENT_ID) throw new Error("Tokio has no Twitch client ID.");
    const res = await this._fetch(
      this._config.DEVICE_URL,
      form({ client_id: CLIENT_ID, scopes: SCOPES }),
      signal,
    );
    if (!res.ok) {
      throw new Error(`Twitch refused the sign-in -- ${await reasonOf(res)}`);
    }
    const device: {
      device_code: string;
      user_code: string;
      verification_uri: string;
      expires_in: number;
      interval: number;
    } = await res.json();
    const expiresAt = Date.now() + device.expires_in * 1000;
    // Its link carries the code, so the page opens with it filled in
    onCode({ code: device.user_code, uri: device.verification_uri, expiresAt });

    let wait = device.interval * 1000;
    let tokens: Tokens;
    for (;;) {
      await sleep(wait, signal);
      if (Date.now() >= expiresAt) {
        throw new Error("The Twitch sign-in code expired.");
      }
      const poll = await this._fetch(
        this._config.TOKEN_URL,
        form({
          client_id: CLIENT_ID,
          scopes: SCOPES,
          device_code: device.device_code,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
        signal,
      );
      if (poll.ok) {
        tokens = await poll.json();
        break;
      }
      const why = await reasonOf(poll);
      if (why.endsWith("authorization_pending")) continue;
      if (why.endsWith("slow_down")) {
        wait += 5000;
        continue;
      }
      // Expired ("invalid device code"), denied, or anything else
      throw new Error(`The Twitch sign-in failed -- ${why}`);
    }

    const user = await this._validate(tokens.access_token, signal);
    if (!user.ok) throw await failureOf(user.res, "token check");
    const account = {
      id: user.userId,
      login: user.login,
      key: tokens.refresh_token,
    };
    this.lost = false;
    this._token = tokens.access_token;
    await this._save(account);
    Logger.info(`<Twitch> Signed in as @${account.login}.`, this._logFile());
    return account;
  }

  // Revokes the token and forgets the account, which signs out even when
  // Twitch can't be reached
  public async signOut() {
    const token = this._token || (await this.refresh().catch(() => ""));
    if (token) {
      try {
        const res = await this._fetch(
          this._config.REVOKE_URL,
          form({ client_id: this._config.CLIENT_ID, token }),
        );
        if (!res.ok) {
          Logger.warn(
            `<Twitch> Couldn't revoke the token -- ${await reasonOf(res)}`,
            this._logFile(),
          );
        }
      } catch (err) {
        Logger.warn(
          `<Twitch> Couldn't revoke the token -- ${formatError(err)}`,
          this._logFile(),
        );
      }
    }
    this._token = "";
    this.lost = false;
    await this._save(NO_ACCOUNT);
  }

  // Forgets an account Twitch refused, so the next connect asks for a sign-in
  public async lose() {
    if (!this._account.key) return;
    this._token = "";
    this.lost = true;
    await this._save(NO_ACCOUNT);
    this.onLost?.();
  }

  /**
   * A new access token. Refresh tokens work once, so every caller waiting
   * shares one refresh, and one whose token was already replaced gets the
   * new one: two 401s at once would otherwise burn the token.
   */
  public refresh(stale = this._token): Promise<string> {
    if (this._token && this._token !== stale) {
      return Promise.resolve(this._token);
    }
    return (this._refreshing ??= this._refresh().finally(() => {
      this._refreshing = null;
    }));
  }

  // The account's login and id, checked at connect and every hour, as
  // Twitch asks. Refreshes the token when it's missing or expired.
  public async validate(): Promise<{ login: string; userId: string }> {
    let token = this._token || (await this.refresh());
    let user = await this._validate(token);
    if (!user.ok && user.res.status === 401) {
      token = await this.refresh(token);
      user = await this._validate(token);
    }
    if (!user.ok) throw await failureOf(user.res, "token check");
    return user;
  }

  /**
   * A request to Twitch's API with the access token, refreshed and tried
   * again once on a 401. Throws a connect failure on a 429 or the network.
   */
  public async request(url: string, init: ApiInit = {}): Promise<Response> {
    const send = (token: string) =>
      this._fetch(url, {
        ...init,
        headers: {
          ...init.headers,
          Authorization: `Bearer ${token}`,
          "Client-Id": this._config.CLIENT_ID,
        },
      });
    let token = this._token || (await this.refresh());
    let res = await send(token);
    if (res.status === 401) {
      token = await this.refresh(token);
      res = await send(token);
    }
    if (res.status === 429) throw await failureOf(res, new URL(url).pathname);
    return res;
  }

  private async _refresh(): Promise<string> {
    const { key } = this._account;
    if (!key) throw connectFailure("noKey", "No Twitch account is signed in.");
    const res = await this._fetch(
      this._config.TOKEN_URL,
      form({
        client_id: this._config.CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: key,
      }),
    );
    // A sign-out or another sign-in came meanwhile
    if (this._account.key !== key) {
      throw connectFailure("noKey", "The Twitch account changed.");
    }
    if (res.status === 400 || res.status === 401) {
      // Used, expired (30 days) or revoked: the account is gone
      const why = await reasonOf(res);
      Logger.warn(
        `<Twitch> Twitch refused the refresh token, so the account is signed out -- ${why}`,
        this._logFile(),
      );
      await this.lose();
      throw connectFailure(
        "badKey",
        `Twitch refused the refresh token -- ${why}`,
      );
    }
    if (!res.ok) {
      const failure = await failureOf(res, "token refresh");
      Logger.warn(`<Twitch> ${failure.message}`, this._logFile());
      throw failure;
    }
    const tokens: Tokens = await res.json();
    // Saved before the new token is used: the old refresh token is spent
    await this._save({ ...this._account, key: tokens.refresh_token });
    this._token = tokens.access_token;
    return tokens.access_token;
  }

  private async _validate(
    token: string,
    signal?: AbortSignal,
  ): Promise<
    { ok: true; login: string; userId: string } | { ok: false; res: Response }
  > {
    const res = await this._fetch(
      this._config.VALIDATE_URL,
      { headers: { Authorization: `OAuth ${token}` } },
      signal,
    );
    if (!res.ok) return { ok: false, res };
    const body: { login: string; user_id: string } = await res.json();
    return { ok: true, login: body.login, userId: body.user_id };
  }

  private async _save(account: PlatformAccount) {
    this._account = account;
    try {
      // The listener warns when the store couldn't write it
      await this._listener?.(account);
    } catch (err) {
      Logger.error(
        `<Twitch> Couldn't save the account -- ${formatError(err)}`,
        this._logFile(),
      );
    }
  }

  // Global fetch with a timeout; a failure on the network is a connect
  // failure, and an abort stays an abort
  private async _fetch(
    url: string,
    init: RequestInit,
    signal?: AbortSignal,
  ): Promise<Response> {
    signal?.throwIfAborted();
    const timeout = AbortSignal.timeout(this._config.REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, {
        ...init,
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (err) {
      signal?.throwIfAborted();
      throw connectFailure(
        "network",
        `Couldn't reach Twitch -- ${formatError(err)}`,
        {
          cause: err,
        },
      );
    }
  }
}

const form = (fields: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(fields).toString(),
});
