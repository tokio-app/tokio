import Logger from "@/logger";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  FRESH_MS,
  MAX_RETRY_MS,
  RATES_URL,
  RatesService,
  RETRY_MS,
} from "./index";

const ROWS = [
  { date: "2026-11-20", base: "USD", quote: "EUR", rate: 0.8 },
  { date: "2026-11-20", base: "USD", quote: "MXN", rate: 20 },
  { date: "2026-11-19", base: "USD", quote: "BTC", rate: 0.00001 },
];

const ok = (body: unknown = ROWS) =>
  Promise.resolve(new Response(JSON.stringify(body)));

let fetchMock: ReturnType<typeof vi.fn>;
let rates: RatesService;

beforeEach(() => {
  fetchMock = vi.fn(() => ok());
  vi.stubGlobal("fetch", fetchMock);
  rates = new RatesService();
  rates.setLogFile("system.log");
});

describe("RatesService", () => {
  it("needs no rates for dollars", () => {
    expect(rates.toUsd({})).toBe(0);
    expect(rates.toUsd({ USD: 4.99 })).toBe(4.99);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("gives null before the rates load, then converts", async () => {
    expect(rates.toUsd({ USD: 1, EUR: 8 }, 0)).toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(RATES_URL);
    expect(init.headers["User-Agent"]).toBe("Tokio/1.0.0");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    await rates.refresh(0);
    expect(rates.toUsd({ USD: 1, EUR: 8, MXN: 100 }, 0)).toBe(1 + 10 + 5);
  });

  it("sends one request at a time", async () => {
    await Promise.all([rates.refresh(0), rates.refresh(0), rates.refresh(0)]);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("doesn't fetch again while fresh, and does in the background once stale", async () => {
    await rates.refresh(0);
    await rates.refresh(FRESH_MS - 1);
    expect(rates.toUsd({ EUR: 8 }, FRESH_MS - 1)).toBe(10);
    expect(fetchMock).toHaveBeenCalledOnce();

    fetchMock.mockImplementation(() =>
      ok([{ date: "2026-11-21", base: "USD", quote: "EUR", rate: 0.5 }]),
    );
    // Stale rates still convert while new ones load
    expect(rates.toUsd({ EUR: 8 }, FRESH_MS)).toBe(10);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await rates.refresh(FRESH_MS);
    expect(rates.toUsd({ EUR: 8 }, FRESH_MS)).toBe(16);
  });

  it("waits longer after each failure, with a warning", async () => {
    const warn = vi.spyOn(Logger, "warn");
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response("", { status: 503 })),
    );
    await rates.refresh(0);
    expect(warn).toHaveBeenLastCalledWith(
      expect.stringMatching(/^<Rates> .*trying again in 1 min: .*503/),
      "system.log",
    );
    await rates.refresh(RETRY_MS - 1);
    expect(fetchMock).toHaveBeenCalledOnce();

    await rates.refresh(RETRY_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Now 2 minutes
    await rates.refresh(RETRY_MS + 2 * RETRY_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await rates.refresh(3 * RETRY_MS);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(warn).toHaveBeenLastCalledWith(
      expect.stringContaining("trying again in 4 min"),
      "system.log",
    );

    let now = 3 * RETRY_MS;
    for (let i = 0; i < 10; i++) {
      now += MAX_RETRY_MS;
      await rates.refresh(now);
    }
    expect(warn).toHaveBeenLastCalledWith(
      expect.stringContaining(`trying again in ${MAX_RETRY_MS / 60_000} min`),
      "system.log",
    );
  });

  it("logs the load at debug and tells the listeners", async () => {
    const debug = vi.spyOn(Logger, "debug");
    const listener = vi.fn();
    rates.onChange(listener);
    await rates.refresh(0);
    expect(debug).toHaveBeenCalledWith(
      "<Rates> Loaded 3 exchange rates",
      "system.log",
    );
    expect(listener).toHaveBeenCalledOnce();
  });

  it("leaves out a currency it has no rate for, warning once", async () => {
    const warn = vi.spyOn(Logger, "warn");
    await rates.refresh(0);
    expect(rates.toUsd({ USD: 2, XAF: 600 }, 0)).toBe(2);
    expect(rates.toUsd({ XAF: 600 }, 0)).toBe(0);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("XAF"),
      "system.log",
    );
  });

  it("refuses a body it can't read", async () => {
    const warn = vi.spyOn(Logger, "warn");
    const listener = vi.fn();
    rates.onChange(listener);
    fetchMock.mockImplementation(() => ok([{ quote: "EUR", rate: -1 }]));
    await rates.refresh(0);
    expect(warn).toHaveBeenCalledOnce();
    expect(listener).not.toHaveBeenCalled();
    expect(rates.toUsd({ EUR: 8 }, 0)).toBeNull();
  });
});
