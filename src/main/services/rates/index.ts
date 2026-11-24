import { formatError } from "@/common/util";
import Logger from "@/logger";
import { app } from "electron";
import { z } from "zod";
import { Service } from "../shared";

// Frankfurter's central bank reference rates: free, no key, no quotas
export const RATES_URL = "https://api.frankfurter.dev/v2/rates?base=usd";
// The rates change once a day
export const FRESH_MS = 24 * 60 * 60_000;
// The wait after a failed load, doubling up to MAX_RETRY_MS
export const RETRY_MS = 60_000;
export const MAX_RETRY_MS = 60 * 60_000;
const TIMEOUT_MS = 10_000;

// Each row's date and base aren't needed, and rows can have different dates.
// rate is units of quote per US dollar.
const RatesSchema = z.array(
  z.object({ quote: z.string(), rate: z.number().positive() }),
);

/** Exchange rates to US dollars, for YouTube's Super Chats. */
export class RatesService extends Service {
  private _rates = new Map<string, number>();
  private _loadedAt: number | null = null;
  private _pending: Promise<void> | null = null;
  private _retryAt = 0;
  private _retryMs = RETRY_MS;
  // Currencies already warned about, once each
  private _missing = new Set<string>();
  private _listeners: (() => void)[] = [];

  /** Called after new rates load. */
  public onChange(listener: () => void): void {
    this._listeners.push(listener);
  }

  /**
   * The amounts, by currency code, in US dollars. Null while no rates have
   * loaded and some amount isn't in dollars. A currency the rates lack is
   * left out. Missing or stale rates are loaded in the background.
   */
  public toUsd(
    amounts: Readonly<Record<string, number>>,
    now = Date.now(),
  ): number | null {
    const others = Object.keys(amounts).filter((code) => code !== "USD");
    if (others.length && !this._fresh(now)) void this.refresh(now);
    if (others.length && this._loadedAt === null) return null;

    let usd = amounts.USD ?? 0;
    for (const code of others) {
      const rate = this._rates.get(code);
      if (rate) {
        usd += amounts[code] / rate;
      } else if (!this._missing.has(code)) {
        this._missing.add(code);
        Logger.warn(
          `<Rates> No exchange rate for ${code}, left out of the Super Chats' total`,
          this._logFile,
        );
      }
    }
    return usd;
  }

  /**
   * One amount in US dollars, null while no rates have loaded or when they
   * lack its currency, so a Super Chat's own dollars are never a made-up 0.
   */
  public usdOf(currency: string, value: number, now = Date.now()) {
    const usd = this.toUsd({ [currency]: value }, now);
    return currency === "USD" || this._rates.has(currency) ? usd : null;
  }

  /**
   * Loads the rates unless they're fresh, a load is in flight or the wait
   * after a failure hasn't passed.
   */
  public refresh(now = Date.now()): Promise<void> {
    if (this._pending) return this._pending;
    if (this._fresh(now) || now < this._retryAt) return Promise.resolve();
    this._pending = this._load(now).finally(() => {
      this._pending = null;
    });
    return this._pending;
  }

  private _fresh(now: number): boolean {
    return this._loadedAt !== null && now - this._loadedAt < FRESH_MS;
  }

  private async _load(now: number): Promise<void> {
    try {
      const res = await fetch(RATES_URL, {
        headers: { "User-Agent": `Tokio/${app.getVersion()}` },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const rows = RatesSchema.parse(await res.json());
      this._rates = new Map(rows.map((r) => [r.quote.toUpperCase(), r.rate]));
      this._loadedAt = now;
      this._retryAt = 0;
      this._retryMs = RETRY_MS;
    } catch (e) {
      this._retryAt = now + this._retryMs;
      Logger.warn(
        `<Rates> Couldn't load the exchange rates, trying again in ${this._retryMs / 60_000} min: ${formatError(e)}`,
        this._logFile,
      );
      this._retryMs = Math.min(this._retryMs * 2, MAX_RETRY_MS);
      return;
    }
    Logger.debug(
      `<Rates> Loaded ${this._rates.size} exchange rates`,
      this._logFile,
    );
    for (const listener of this._listeners) listener();
  }
}
