import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConfig } from "../config";
import type { EdgeStage, TokenVersion } from "../types";
import type { EdgeAuth } from "./errors";

// drm.ts keeps the clock skew between calls, so every test gets a fresh copy.
let drm: typeof import("./drm");
let EdgeTTSError: typeof import("./errors").EdgeTTSError;

const cfg = createConfig({ CHROMIUM_FULL_VERSION: "143.0.3650.75" });
const TOKEN = cfg.TRUSTED_CLIENT_TOKEN;
const NOW = 1700000000;

const forbidden = (
  auth: EdgeAuth,
  serverDate?: string,
  stage: EdgeStage = "handshake",
) =>
  new EdgeTTSError(stage, "WebSocket handshake rejected", {
    auth,
    status: 403,
    serverDate,
  });

const versionsOf = (calls: [EdgeAuth][]) =>
  calls.map(([auth]) => auth.tokenVersion);

describe("drm", () => {
  beforeEach(async () => {
    vi.resetModules();
    drm = await import("./drm");
    ({ EdgeTTSError } = await import("./errors"));
    vi.useFakeTimers();
    vi.setSystemTime(NOW * 1000);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("token v1", () => {
    it("is the uppercase SHA-256 of the 5-minute Windows file time and the client token", () => {
      // 1700000000 s after 1970 is 13344473600 s after 1601, 13344473400 at the 5-minute mark
      const expected = createHash("sha256")
        .update(`133444734000000000${TOKEN}`)
        .digest("hex")
        .toUpperCase();

      expect(drm.tokenForTimestamp("1", NOW, TOKEN)).toBe(expected);
      expect(expected).toMatch(/^[0-9A-F]{64}$/);
    });

    it("stays the same within a 5-minute window and changes in the next one", () => {
      const token = (ts: number) => drm.tokenForTimestamp("1", ts, TOKEN);

      expect(token(1699999800)).toBe(token(NOW));
      expect(token(1700000099.9)).toBe(token(NOW));
      expect(token(1700000100)).not.toBe(token(NOW));
      expect(token(1699999799)).not.toBe(token(NOW));
    });

    it("depends on the client token", () => {
      expect(drm.tokenForTimestamp("1", NOW, "OTHER")).not.toBe(
        drm.tokenForTimestamp("1", NOW, TOKEN),
      );
    });
  });

  describe("token v2", () => {
    // Reference vectors from upstream edge-tts generate_sec_ms_gec_v2, see README.md.
    it.each<[number, string]>([
      [
        0,
        "52BC7A17B50DFEC9-28C4394775C8751CD2F6859C030C06DB1489ACAB3B3A7651831FC26895177ED6",
      ],
      [
        1700000000,
        "2CD23A2CA0B2595A-F3C846C370E05F9CC83ACC5F995C5F5D87A4D0F14CE8936A0F902E64099E38A2",
      ],
      [
        1792000000.5,
        "31DE969FFA38E06B-BD29DC903722D717D852F4F854F2386D98C8D3A93663E1A1AE89223A876AFDB4",
      ],
    ])("matches upstream at %s", (timestamp, expected) => {
      expect(
        drm.tokenForTimestamp(
          "2",
          timestamp,
          createConfig().TRUSTED_CLIENT_TOKEN,
        ),
      ).toBe(expected);
    });
  });

  describe("auth query", () => {
    it("names the token version and the Chromium version", () => {
      expect(drm.gecVersion(cfg, "2")).toBe("2-143.0.3650.75");
      expect(drm.gecVersion(cfg, "1")).toBe("1-143.0.3650.75");
    });

    it("carries the current token and its version", () => {
      const auth = {
        tokenVersion: "1" as const,
        gecVersion: "1-143.0.3650.75",
      };

      expect(drm.authQuery(cfg, auth)).toBe(
        `&Sec-MS-GEC=${drm.tokenForTimestamp("1", NOW, TOKEN)}&Sec-MS-GEC-Version=1-143.0.3650.75`,
      );
    });

    it("carries a v2 token for v2", () => {
      const query = drm.authQuery(cfg, {
        tokenVersion: "2",
        gecVersion: drm.gecVersion(cfg, "2"),
      });

      expect(query).toMatch(
        /^&Sec-MS-GEC=[0-9A-F]{16}-[0-9A-F]{64}&Sec-MS-GEC-Version=2-143\.0\.3650\.75$/,
      );
    });

    it("generates a random muid cookie", () => {
      const headers = drm.withMuid({ Accept: "*/*" });

      expect(headers).toEqual({
        Accept: "*/*",
        Cookie: expect.stringMatching(/^muid=[0-9A-F]{32};$/),
      });
      expect(drm.withMuid({}).Cookie).not.toBe(headers.Cookie);
    });
  });

  describe("withAuthRetry", () => {
    it("returns what fn returns", async () => {
      const fn = vi.fn(async (_auth: EdgeAuth) => "audio");

      await expect(drm.withAuthRetry(cfg, "handshake", fn)).resolves.toBe(
        "audio",
      );
      expect(fn).toHaveBeenCalledExactlyOnceWith({
        tokenVersion: "2",
        gecVersion: "2-143.0.3650.75",
      });
    });

    it.each([
      ["a plain error", () => new Error("offline")],
      [
        "a non-403 Edge error",
        () => new EdgeTTSError("handshake", "rejected", { status: 500 }),
      ],
      [
        "an Edge error without status",
        () => new EdgeTTSError("timeout", "No response"),
      ],
    ])("rethrows %s without retrying", async (_name, make) => {
      const error = make();
      const fn = vi.fn(async (_auth: EdgeAuth) => {
        throw error;
      });

      await expect(drm.withAuthRetry(cfg, "handshake", fn)).rejects.toBe(error);
      expect(fn).toHaveBeenCalledOnce();
    });

    it("retries a 403 with a server date once with the same version, then tries the next", async () => {
      const date = new Date().toUTCString();
      const fn = vi.fn(async (auth: EdgeAuth) => {
        if (auth.tokenVersion === "2") throw forbidden(auth, date);
        return "audio";
      });

      await expect(drm.withAuthRetry(cfg, "handshake", fn)).resolves.toBe(
        "audio",
      );
      expect(versionsOf(fn.mock.calls)).toEqual(["2", "2", "1"]);
    });

    it("returns the retry's result when the corrected clock is accepted", async () => {
      const fn = vi
        .fn(async (_auth: EdgeAuth) => "audio")
        .mockImplementationOnce(async (auth) => {
          throw forbidden(auth, new Date().toUTCString());
        });

      await expect(drm.withAuthRetry(cfg, "handshake", fn)).resolves.toBe(
        "audio",
      );
      expect(versionsOf(fn.mock.calls)).toEqual(["2", "2"]);
    });

    it.each([
      ["no server date", undefined],
      ["an unparsable server date", "not a date"],
    ])(
      "moves on to the next version right away on a 403 with %s",
      async (_name, date) => {
        const fn = vi.fn(async (auth: EdgeAuth) => {
          if (auth.tokenVersion === "2") throw forbidden(auth, date);
          return "audio";
        });

        await expect(drm.withAuthRetry(cfg, "handshake", fn)).resolves.toBe(
          "audio",
        );
        expect(versionsOf(fn.mock.calls)).toEqual(["2", "1"]);
      },
    );

    it("names every attempt when every version is rejected", async () => {
      const fn = vi.fn(async (auth: EdgeAuth) => {
        throw forbidden(auth, undefined, "voices");
      });

      const error = await drm
        .withAuthRetry(cfg, "handshake", fn)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(EdgeTTSError);
      expect(error).toMatchObject({
        stage: "voices",
        status: 403,
        message: expect.stringContaining(
          "Rejected for every token version: v2 (Sec-MS-GEC-Version 2-143.0.3650.75), v1 (Sec-MS-GEC-Version 1-143.0.3650.75)",
        ),
      });
    });

    it("names the retries when every version is rejected after the clock was corrected", async () => {
      const date = new Date().toUTCString();
      const fn = vi.fn(async (auth: EdgeAuth) => {
        throw forbidden(auth, date);
      });

      const error = await drm
        .withAuthRetry(cfg, "handshake", fn)
        .catch((e: unknown) => e);

      expect(versionsOf(fn.mock.calls)).toEqual(["2", "2", "1", "1"]);
      expect(error).toMatchObject({
        status: 403,
        message: expect.stringContaining(
          "Rejected for every token version: v2 (",
        ),
      });
    });

    it("rethrows the error of a single configured version", async () => {
      const single = createConfig({ TOKEN_VERSIONS: ["1"] });
      const error = forbidden({
        tokenVersion: "1",
        gecVersion: drm.gecVersion(single, "1"),
      });
      const fn = vi.fn(async (_auth: EdgeAuth) => {
        throw error;
      });

      await expect(drm.withAuthRetry(single, "handshake", fn)).rejects.toBe(
        error,
      );
      expect(fn).toHaveBeenCalledOnce();
    });

    it("fails when no token versions are configured", async () => {
      const none = createConfig({ TOKEN_VERSIONS: [] });
      const fn = vi.fn(async (_auth: EdgeAuth) => "audio");

      const error = await drm
        .withAuthRetry(none, "voices", fn)
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(EdgeTTSError);
      expect(error).toMatchObject({
        stage: "voices",
        message: expect.stringContaining("No token versions configured"),
      });
      expect(fn).not.toHaveBeenCalled();
    });

    it("shifts the token's timestamp by the server's clock", async () => {
      const version: TokenVersion = "1";
      const hourAhead = NOW + 3600;
      expect(drm.generateSecMsGec(cfg, version)).toBe(
        drm.tokenForTimestamp(version, NOW, TOKEN),
      );

      const queries: string[] = [];
      const fn = vi.fn(async (auth: EdgeAuth) => {
        queries.push(drm.authQuery(cfg, auth));
        if (queries.length === 1) {
          throw forbidden(auth, new Date(hourAhead * 1000).toUTCString());
        }
        return "audio";
      });
      await drm.withAuthRetry(
        createConfig({ TOKEN_VERSIONS: [version] }),
        "handshake",
        fn,
      );

      const corrected = drm.tokenForTimestamp(version, hourAhead, TOKEN);
      expect(corrected).not.toBe(drm.tokenForTimestamp(version, NOW, TOKEN));
      expect(queries[1]).toContain(`Sec-MS-GEC=${corrected}&`);
      expect(drm.generateSecMsGec(cfg, version)).toBe(corrected);

      vi.advanceTimersByTime(10 * 60_000);
      expect(drm.generateSecMsGec(cfg, version)).toBe(
        drm.tokenForTimestamp(version, hourAhead + 600, TOKEN),
      );
    });
  });
});
