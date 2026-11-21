// Stands in for youtube.com in the YouTube provider's tests: its channel
// and watch pages, the chat page and the chat's API, through an injected
// fetch. Made-up channels only.
import type { FetchInit } from "@/services/connector/providers/youtube/config";
import { vi } from "vitest";

type Channel = { videoId: string; author: string } | "offline" | "upcoming";
// An answer to a poll: actions with the next continuation, the chat's end,
// a status YouTube answered with, or a network failure
export type PollAnswer = { actions: unknown[] } | "ended" | number | Error;

export type FakeYouTube = ReturnType<typeof fakeYouTube>;

const html = (script: string, extra = "") =>
  `<html><head>${extra}</head><body><script>${script}</script></body></html>`;

const playerPage = (details: Record<string, unknown> | null) =>
  html(
    // A string with braces, which a lazy match would stop in
    `var ytInitialPlayerResponse = ${JSON.stringify({ playabilityStatus: { status: "OK", reason: "a } in {" }, ...(details ? { videoDetails: details } : {}) })};var other = {};`,
  );

export function fakeYouTube() {
  const state = {
    // By path: "/@name", "/channel/UC…"
    channels: {} as Record<string, Channel>,
    // Videos that are live, by id
    videos: {} as Record<string, string>,
    chatOff: false,
    // Top chat first and selected, as youtube.com sends them
    menu: [
      { title: "Top chat", selected: true, continuation: "top-0" },
      { title: "Live chat", selected: false, continuation: "live-0" },
    ],
    // Each poll takes the first; an empty queue answers no actions
    polls: [] as PollAnswer[],
    // The viewers each metadata request answers: a count, or "ended"
    viewers: [] as (number | "ended" | Error)[],
    lastViewers: 100 as number | "ended",
    // The continuation each poll sent
    continuations: [] as string[],
    urls: [] as string[],
    headers: [] as Record<string, string>[],
    // Answers a request instead, until it gives undefined
    override: undefined as ((url: string) => Response | undefined) | undefined,
  };
  let next = 0;

  const fetch = vi.fn(async (url: string, init: FetchInit) => {
    state.urls.push(url);
    state.headers.push(init.headers ?? {});
    const answer = state.override?.(url);
    if (answer) return answer;
    const { pathname, searchParams } = new URL(url);

    if (pathname.endsWith("/get_live_chat")) {
      const body = JSON.parse(init.body ?? "{}");
      state.continuations.push(body.continuation);
      const poll = state.polls.shift() ?? { actions: [] };
      if (poll instanceof Error) throw poll;
      if (typeof poll === "number") return new Response("{}", { status: poll });
      if (poll === "ended") return Response.json({ responseContext: {} });
      return Response.json({
        continuationContents: {
          liveChatContinuation: {
            actions: poll.actions,
            continuations: [
              {
                timedContinuationData: {
                  continuation: `next-${++next}`,
                  timeoutMs: 5,
                },
              },
            ],
          },
        },
      });
    }
    if (pathname.endsWith("/updated_metadata")) {
      const viewers = state.viewers.shift() ?? state.lastViewers;
      if (viewers instanceof Error) throw viewers;
      state.lastViewers = viewers;
      const renderer =
        viewers === "ended"
          ? { originalViewCount: "72481" }
          : { originalViewCount: String(viewers), isLive: true };
      return Response.json({
        actions: [
          {
            updateViewershipAction: {
              viewCount: { videoViewCountRenderer: renderer },
            },
          },
        ],
      });
    }
    if (pathname === "/live_chat") {
      const data = state.chatOff
        ? { contents: { messageRenderer: {} } }
        : {
            contents: {
              liveChatRenderer: {
                header: {
                  liveChatHeaderRenderer: {
                    viewSelector: {
                      sortFilterSubMenuRenderer: {
                        subMenuItems: state.menu.map((m) => ({
                          title: m.title,
                          selected: m.selected,
                          continuation: {
                            reloadContinuationData: {
                              continuation: m.continuation,
                            },
                          },
                        })),
                      },
                    },
                  },
                },
              },
            },
          };
      return new Response(
        html(
          `ytcfg.set({"INNERTUBE_API_KEY":"key-1","INNERTUBE_CONTEXT_CLIENT_VERSION":"2.0","VISITOR_DATA":"visitor-1"});window["ytInitialData"] = ${JSON.stringify(data)};`,
        ),
      );
    }
    if (pathname === "/watch") {
      const id = searchParams.get("v") ?? "";
      const author = state.videos[id];
      return new Response(
        playerPage(author ? { videoId: id, author, isLive: true } : null),
      );
    }
    if (pathname.endsWith("/live")) {
      const channel = state.channels[pathname.slice(0, -"/live".length)];
      if (!channel) return new Response("", { status: 404 });
      if (channel === "offline") {
        return new Response(
          html(
            "var ytInitialPlayerResponse = {};",
            '<link rel="canonical" href="https://www.youtube.com/channel/UCmadeup">',
          ),
        );
      }
      return new Response(
        playerPage(
          channel === "upcoming"
            ? { videoId: "upcoming123", author: "Made Up", isUpcoming: true }
            : { ...channel, isLive: true },
        ),
      );
    }
    return new Response("", { status: 404 });
  });

  return { state, fetch };
}

// A chat message action from a made-up viewer
export const chatAction = (text: string) => ({
  addChatItemAction: {
    item: {
      liveChatTextMessageRenderer: {
        authorName: { simpleText: "@viewer32" },
        authorExternalChannelId: "UCviewer32",
        message: { runs: [{ text }] },
      },
    },
  },
});
