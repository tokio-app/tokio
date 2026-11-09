import { createHash, randomBytes } from "crypto";
import { EdgeConfig, EdgeStage, TokenVersion } from "../types";
import { generateV2Token } from "./drm-v2";
import { EdgeAuth, EdgeTTSError } from "./errors";

// Same token scheme as edge-tts drm.py, the reference to compare against when it breaks, see README.md.
const WIN_EPOCH_SECONDS = 11644473600n;

// Add a generator here and its version to config TOKEN_VERSIONS to support a new token format.
const TOKEN_GENERATORS: Record<
  TokenVersion,
  (ticks: string, clientToken: string) => string
> = {
  "1": (ticks, clientToken) =>
    createHash("sha256")
      .update(`${ticks}${clientToken}`, "ascii")
      .digest("hex")
      .toUpperCase(),
  "2": generateV2Token, // LGPL-3.0 port, see drm-v2.ts.
};

let clockSkewSeconds = 0;

// Windows file time (100ns ticks) rounded down to 5 minutes.
function windowsTicks(unixSeconds: number): string {
  let seconds = BigInt(Math.floor(unixSeconds)) + WIN_EPOCH_SECONDS;
  seconds -= seconds % 300n;
  return (seconds * 10_000_000n).toString();
}

// Exposed for parity checks against upstream reference vectors.
export function tokenForTimestamp(
  version: TokenVersion,
  unixSeconds: number,
  clientToken: string,
) {
  return TOKEN_GENERATORS[version](windowsTicks(unixSeconds), clientToken);
}

export function generateSecMsGec(cfg: EdgeConfig, version: TokenVersion) {
  return tokenForTimestamp(
    version,
    Date.now() / 1000 + clockSkewSeconds,
    cfg.TRUSTED_CLIENT_TOKEN,
  );
}

export function gecVersion(cfg: EdgeConfig, version: TokenVersion) {
  return `${version}-${cfg.CHROMIUM_FULL_VERSION}`;
}

export function authQuery(cfg: EdgeConfig, auth: EdgeAuth) {
  return `&Sec-MS-GEC=${generateSecMsGec(cfg, auth.tokenVersion)}&Sec-MS-GEC-Version=${auth.gecVersion}`;
}

function generateMuid() {
  return randomBytes(16).toString("hex").toUpperCase();
}

export function withMuid(headers: Record<string, string>) {
  return { ...headers, Cookie: `muid=${generateMuid()};` };
}

// Returns false when the server date is missing or unparsable.
function adjustSkewFromDate(serverDate?: string) {
  if (!serverDate) return false;
  const server = Date.parse(serverDate);
  if (Number.isNaN(server)) return false;
  clockSkewSeconds += server / 1000 - (Date.now() / 1000 + clockSkewSeconds);
  return true;
}

function isForbidden(error: unknown): error is EdgeTTSError {
  return error instanceof EdgeTTSError && error.status === 403;
}

// Runs fn with each token version in order. A 403 is retried once after
// correcting the clock skew, then the next token version is tried.
export async function withAuthRetry<T>(
  cfg: EdgeConfig,
  stage: EdgeStage,
  fn: (auth: EdgeAuth) => Promise<T>,
): Promise<T> {
  const rejected: EdgeTTSError[] = [];

  for (const tokenVersion of cfg.TOKEN_VERSIONS) {
    const auth = { tokenVersion, gecVersion: gecVersion(cfg, tokenVersion) };
    try {
      return await fn(auth);
    } catch (error) {
      if (!isForbidden(error)) throw error;
      if (!adjustSkewFromDate(error.serverDate)) {
        rejected.push(error);
        continue;
      }
      try {
        return await fn(auth);
      } catch (retryError) {
        if (!isForbidden(retryError)) throw retryError;
        rejected.push(retryError);
      }
    }
  }

  if (rejected.length === 0) {
    throw new EdgeTTSError(stage, "No token versions configured");
  }
  if (rejected.length === 1) throw rejected[0];
  // Name every attempt, the fix depends on whether all versions or only some were rejected.
  const attempts = rejected
    .map(
      (e) =>
        `v${e.auth?.tokenVersion} (Sec-MS-GEC-Version ${e.auth?.gecVersion})`,
    )
    .join(", ");
  throw new EdgeTTSError(
    rejected[0].stage,
    `Rejected for every token version: ${attempts}`,
    {
      status: 403,
    },
  );
}
