// Kick's website API, as kick.com's page calls it: the channel's lookup,
// and the chat feed's server and guest token.
import { connectFailure, ConnectorFailure } from "../../../common";
import type { FetchInit, KickConfig } from "../config";

export type Channel = {
  slug: string;
  // The streamer's name as they write it
  name: string;
  // The channel.<id> and channel_<id> feeds'
  channelId: number;
  // The chat's feeds', another id than the channel's
  chatroomId: number;
  // Null while offline
  viewers: number | null;
  // The account's, the number chat's sender.id is; null when missing
  userId: number | null;
};

const SLUG = /^[\w-]+$/;
const KICK_URL = /^(https?:\/\/)?(www\.)?kick\.com(\/|$)/i;

/**
 * What the streamer typed on Home: a channel's slug, or a kick.com link to
 * it. Null for anything else.
 */
export function parseInput(input: string): string | null {
  const text = input.trim();
  let slug = text;
  if (KICK_URL.test(text)) {
    const url = new URL(/^https?:/i.test(text) ? text : `https://${text}`);
    slug = url.pathname.split("/").find(Boolean) ?? "";
  }
  return SLUG.test(slug) ? slug.toLowerCase() : null;
}

// A username's channel slug, as Kick writes it: lowercase, "_" as "-"
// (sharkbait_34's is sharkbait-34; the username itself is a 404)
export const slugOf = (username: string) =>
  username.toLowerCase().replaceAll("_", "-");

async function request(
  config: KickConfig,
  url: string,
  what: string,
  body?: unknown,
): Promise<any> {
  const init: FetchInit = {
    method: body ? "POST" : "GET",
    headers: {
      "user-agent": config.USER_AGENT,
      accept: "application/json",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(config.REQUEST_TIMEOUT_MS),
  };
  let res: Response;
  try {
    res = await config.fetch(url, init);
  } catch (err) {
    throw connectFailure("network", `${what} failed -- ${String(err)}`, {
      cause: err,
    });
  }
  if (!res.ok) {
    const message = `${what} answered ${res.status}.`;
    const kind: ConnectorFailure["kind"] =
      res.status === 404
        ? "notFound"
        : // Kick's security policy, or too many requests
          res.status === 403 || res.status === 429
          ? "rateLimited"
          : res.status >= 500
            ? "network"
            : "unknown";
    throw connectFailure(kind, message);
  }
  try {
    return await res.json();
  } catch (err) {
    throw connectFailure("network", `${what} sent no JSON.`, { cause: err });
  }
}

export async function lookup(
  config: KickConfig,
  slug: string,
): Promise<Channel> {
  const json = await request(
    config,
    `${config.API_URL}/channels/${encodeURIComponent(slug)}`,
    "The channel",
  );
  const channelId = json?.id;
  const chatroomId = json?.chatroom?.id;
  if (typeof channelId !== "number" || typeof chatroomId !== "number") {
    throw connectFailure("unknown", "The channel came without its chat.");
  }
  const viewers = json.livestream?.viewer_count;
  return {
    slug: json.slug ?? slug,
    name: json.user?.username ?? slug,
    channelId,
    chatroomId,
    viewers: json.livestream ? Number(viewers) || 0 : null,
    userId: typeof json.user_id === "number" ? json.user_id : null,
  };
}

// The chat feed's socket URL, for this client
export async function realtime(
  config: KickConfig,
  clientId: string,
): Promise<string> {
  const json = await request(
    config,
    `${config.REALTIME_URL}/connection`,
    "The realtime server",
    {
      client: { id: clientId, type: "web" },
      capabilities: { accepted_providers: [{ provider: "centrifugo" }] },
    },
  );
  const connections: { provider?: string; credentials?: { url?: string } }[] =
    json?.data?.connections ?? [];
  const url = connections.find((c) => c.provider === "centrifugo")?.credentials
    ?.url;
  if (!url) throw connectFailure("unknown", "Kick offered no chat server.");
  return url;
}

// A guest token for the client: no account, 45 minutes
export async function guestToken(
  config: KickConfig,
  clientId: string,
): Promise<string> {
  const json = await request(
    config,
    `${config.REALTIME_URL}/auth/connection`,
    "The guest token",
    { client_id: clientId },
  );
  const token = json?.data?.token;
  if (typeof token !== "string" || !token) {
    throw connectFailure("unknown", "Kick gave no guest token.");
  }
  return token;
}
