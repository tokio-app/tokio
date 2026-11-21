// youtube.com's public pages, read as a signed-out desktop browser reads
// them: the channel's LIVE, its chat page and the chat's own API.
import { connectFailure, ConnectorFailure } from "../../../common";
import type { FetchInit, YouTubeConfig } from "../config";
import type { ChatAction } from "./mapping";

// Where the LIVE is: a video, or a channel's page whose /live is its LIVE
export type Target = { videoId: string } | { path: string };

// What polling the chat needs, from its page
export type Chat = {
  key: string;
  context: { client: Record<string, string> };
  continuation: string;
};

export type ChatAnswer = {
  actions: ChatAction[];
  continuation: string;
  timeoutMs?: number;
};

// A failed request, with YouTube's status when it answered
export type RequestFailure = ConnectorFailure & { status?: number };

const VIDEO_ID = /^[\w-]{11}$/;
const YOUTUBE_URL =
  /^(https?:\/\/)?((www|m)\.)?(youtube\.com|youtu\.be)(\/|$)/i;

/**
 * What the streamer typed on Home: a handle (bare text always is one, even
 * 11 characters long), or a link to the channel or the LIVE. Null for a
 * link that names neither.
 */
export function parseInput(input: string): Target | null {
  const text = input.trim();
  if (!text) return null;
  if (!YOUTUBE_URL.test(text)) {
    return { path: `/@${encodeURIComponent(text.replace(/^@/, ""))}` };
  }
  const url = new URL(/^https?:/i.test(text) ? text : `https://${text}`);
  const [first = "", second = ""] = url.pathname.split("/").filter(Boolean);
  let id: string | null = null;
  if (/youtu\.be$/i.test(url.hostname)) id = first;
  else if (first === "watch") id = url.searchParams.get("v");
  else if (first === "live") id = second;
  else if (first.startsWith("@")) return { path: `/${first}` };
  else if (first === "channel" && second) return { path: `/channel/${second}` };
  return id && VIDEO_ID.test(id) ? { videoId: id } : null;
}

const failure = (
  kind: ConnectorFailure["kind"],
  message: string,
  status?: number,
): RequestFailure => Object.assign(connectFailure(kind, message), { status });

// English texts and amounts, wherever the streamer is
const withLocale = (url: string) =>
  `${url}${url.includes("?") ? "&" : "?"}hl=en&gl=US`;

async function request(
  config: YouTubeConfig,
  url: string,
  init: Omit<FetchInit, "signal"> = {},
): Promise<Response> {
  try {
    return await config.fetch(url, {
      ...init,
      headers: {
        "user-agent": config.USER_AGENT,
        "accept-language": "en-US,en;q=0.9",
        // Answers the EU consent page, so it never redirects there
        cookie: "SOCS=CAI",
        ...init.headers,
      },
      signal: AbortSignal.timeout(config.REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw Object.assign(
      failure("network", `${new URL(url).pathname} failed -- ${String(err)}`),
      { cause: err },
    );
  }
}

// A 429, or the bot check google.com/sorry, is a rate limit
function check(res: Response, what: string) {
  if (res.status === 429 || res.url.includes("google.com/sorry")) {
    throw failure("rateLimited", `YouTube limited ${what}.`, 429);
  }
  if (res.ok) return;
  const message = `${what} answered ${res.status}.`;
  if (res.status === 404) throw failure("notFound", message, 404);
  throw failure(res.status >= 500 ? "network" : "unknown", message, res.status);
}

async function getPage(config: YouTubeConfig, path: string, what: string) {
  const res = await request(config, withLocale(`${config.BASE_URL}${path}`));
  check(res, what);
  return res.text();
}

// The JSON object a page assigns after start, read to where its braces
// balance (strings aside), as a lazy regex would stop inside it
export function embedded(html: string, start: string): any {
  const from = html.indexOf(start);
  if (from < 0) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = from + start.length; i < html.length; i++) {
    const c = html[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(html.slice(from + start.length, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

// The LIVE the target is: its video and its channel's name. Offline when
// the channel isn't live or the LIVE hasn't started.
export async function findLive(
  config: YouTubeConfig,
  target: Target,
): Promise<{ videoId: string; author: string }> {
  const page =
    "videoId" in target
      ? await getPage(config, `/watch?v=${target.videoId}`, "The video")
      : await getPage(config, `${target.path}/live`, "The channel");
  const details:
    { videoId?: string; author?: string; isLive?: boolean } | undefined =
    embedded(page, "var ytInitialPlayerResponse = ")?.videoDetails;
  // A video that doesn't exist has a page, without details
  if (!details && "videoId" in target) {
    throw failure("notFound", "The video doesn't exist.");
  }
  if (!details?.isLive || !details.videoId) {
    throw failure("offline", "The channel isn't live.");
  }
  return { videoId: details.videoId, author: details.author ?? "" };
}

const ytcfg = (html: string, key: string) =>
  html.match(new RegExp(`"${key}":"([^"]+)"`))?.[1];

type MenuItem = {
  title?: string;
  selected?: boolean;
  continuation?: { reloadContinuationData?: { continuation?: string } };
};

// The chat page: the API key, the client, and Live chat's continuation, as
// Top chat (the default) leaves messages out
export async function readChat(
  config: YouTubeConfig,
  videoId: string,
): Promise<Chat> {
  const html = await getPage(
    config,
    `/live_chat?is_popout=1&v=${videoId}`,
    "The chat",
  );
  const data =
    embedded(html, 'window["ytInitialData"] = ') ??
    embedded(html, "var ytInitialData = ");
  const renderer = data?.contents?.liveChatRenderer;
  if (!renderer) throw failure("noChat", "The LIVE's chat is off.");
  const items: MenuItem[] =
    renderer.header?.liveChatHeaderRenderer?.viewSelector
      ?.sortFilterSubMenuRenderer?.subMenuItems ?? [];
  const live =
    items.find((item) => /live chat/i.test(item.title ?? "")) ??
    items.find((item) => !item.selected);
  const continuation = live?.continuation?.reloadContinuationData?.continuation;
  const key = ytcfg(html, "INNERTUBE_API_KEY");
  const clientVersion = ytcfg(html, "INNERTUBE_CONTEXT_CLIENT_VERSION");
  if (!continuation || !key || !clientVersion) {
    throw failure("unknown", "The chat page has no Live chat to read.");
  }
  const client: Record<string, string> = {
    clientName: "WEB",
    clientVersion,
    hl: "en",
    gl: "US",
  };
  const visitorData = ytcfg(html, "VISITOR_DATA");
  if (visitorData) client.visitorData = visitorData;
  return { key, context: { client }, continuation };
}

async function post(
  config: YouTubeConfig,
  chat: Chat,
  path: string,
  body: Record<string, unknown>,
): Promise<any> {
  const res = await request(
    config,
    `${config.BASE_URL}/youtubei/v1/${path}?prettyPrint=false&key=${chat.key}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: config.BASE_URL,
      },
      body: JSON.stringify({ context: chat.context, ...body }),
    },
  );
  check(res, path);
  try {
    return await res.json();
  } catch (err) {
    throw Object.assign(failure("network", `${path} sent no JSON.`), {
      cause: err,
    });
  }
}

/**
 * The chat's actions since the continuation, and the next one with how long
 * YouTube asks to wait. Null when the chat ended: no chat or no
 * continuation in the answer.
 */
export async function pollChat(
  config: YouTubeConfig,
  chat: Chat,
  continuation: string,
): Promise<ChatAnswer | null> {
  const json = await post(config, chat, "live_chat/get_live_chat", {
    continuation,
  });
  const live = json?.continuationContents?.liveChatContinuation;
  const next:
    Record<string, { continuation?: string; timeoutMs?: number }> | undefined =
    live?.continuations?.[0];
  // invalidationContinuationData, timedContinuationData or
  // reloadContinuationData
  const data = next && Object.values(next).find((c) => c?.continuation);
  if (!data?.continuation) return null;
  return {
    actions: live.actions ?? [],
    continuation: data.continuation,
    timeoutMs: data.timeoutMs,
  };
}

/**
 * The LIVE's viewers, "ended" once its count turned into the video's
 * views, undefined when YouTube didn't say.
 */
export async function pollViewers(
  config: YouTubeConfig,
  chat: Chat,
  videoId: string,
): Promise<number | "ended" | undefined> {
  const json = await post(config, chat, "updated_metadata", { videoId });
  const actions: Record<string, any>[] = json?.actions ?? [];
  const count = actions.find((a) => a.updateViewershipAction)
    ?.updateViewershipAction?.viewCount?.videoViewCountRenderer;
  if (!count) return undefined;
  // After the end isLive goes missing, and the count is the video's views
  if (count.isLive !== true) return "ended";
  const viewers = Number(count.originalViewCount);
  return Number.isFinite(viewers) && count.originalViewCount
    ? viewers
    : undefined;
}
