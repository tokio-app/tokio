import { SongInfo } from "@/common/types";
import { delay } from "@/common/util";
import config from "../config";

// The song's own time and length come from the player: the media's turn
// into the next song's once YouTube loads it ahead, about 10 s before the
// end, to play it without a gap.
export const PlayerStateJSCode = `
(() => {
  const player = document.querySelector("#movie_player");
  if (!player?.getVideoData) return null;

  const state = player.getPlayerState();
  // Buffering counts as playing
  const playing = state === 1 || state === 3;
  const time = player.getCurrentTime() * 1000;
  const formats = player.getPlayerResponse?.()?.streamingData?.adaptiveFormats ?? [];
  const audio = formats.find((f) => f.mimeType?.startsWith("audio/"));
  const duration = Number(audio?.approxDurationMs) || player.getDuration() * 1000;

  const playerBar = document.querySelector("ytmusic-player-bar");

  let name = "";
  let artist = "";
  let thumbnail = "";

  if (playerBar) {
    const titleNode = playerBar.querySelector(".title");
    const artistNode = playerBar.querySelector(".subtitle a");
    const imageNode = playerBar.querySelector(".thumbnail-image-wrapper img.image");

    name = titleNode?.textContent?.trim() ?? "";
    artist = artistNode?.textContent?.trim() ?? "";

    const rawImageSrc = imageNode?.src?.trim() ?? "";
    thumbnail = rawImageSrc.replace(/=w\\d+-h\\d+.*$/, ${JSON.stringify(config.THUMBNAIL_SPEC)});
  }

  const title = name && artist ? \`\${name} - \${artist}\` : name || artist;

  return {
    album: "Unknown",
    track: player.getVideoData().video_id || "Unknown",
    title,
    thumbnail,
    time,
    duration,
    playing,
  };
})();
`;

// Opens the song's page as the page's own links do, which starts it in under
// a second, then waits for the player to have it. A page that hasn't
// played anything yet opens it paused, and the same song again plays from
// its start. True once it plays, or its page is open, like during an ad.
export const PlayJSCode = (videoId: string) => `
(async () => {
  const id = ${JSON.stringify(videoId)};
  const player = () => document.querySelector("#movie_player");
  if (player()?.getVideoData?.().video_id === id) {
    player().seekTo(0, true);
    player().playVideo();
    return true;
  }

  document.querySelector("ytmusic-app").dispatchEvent(
    new CustomEvent("yt-navigate", {
      bubbles: true,
      composed: true,
      detail: { endpoint: { watchEndpoint: { videoId: id } } },
    }),
  );
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (player()?.getVideoData?.().video_id !== id) continue;
    const state = player().getPlayerState();
    if (state === 1 || state === 3) return true;
    player().playVideo();
  }
  return new URLSearchParams(location.search).get("v") === id;
})();
`;

export const LoginJSCode = `
(() => {
  const signInBtn = document.querySelector('a.sign-in-link, [aria-label="Sign in"]');
  return signInBtn === null;
})();
`;

export type LoginConfirmation = "logged-in" | "logged-out" | "stale";

/**
 * Runs `check` up to `attempts` times, spaced `intervalMs` apart, and reports
 * "logged-out" only when every attempt said so. A rejected check counts as a
 * failed attempt. Returns "stale" as soon as `isStale()` is true.
 */
export async function confirmLoggedOut(
  check: () => Promise<boolean>,
  opts: { attempts: number; intervalMs: number; isStale: () => boolean },
): Promise<LoginConfirmation> {
  const { attempts, intervalMs, isStale } = opts;

  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (isStale()) return "stale";

    let loggedIn = false;
    try {
      loggedIn = await check();
    } catch {
      loggedIn = false;
    }

    if (isStale()) return "stale";
    if (loggedIn) return "logged-in";

    if (attempt < attempts) {
      await delay(intervalMs);
      if (isStale()) return "stale";
    }
  }

  return "logged-out";
}

export const TIME_REGEX = /^(\d+:)*\d+$/;

export function parseDurationToSeconds(
  durationStr: string | undefined,
): number {
  if (!durationStr || typeof durationStr !== "string") return 0;

  const trimmed = durationStr.trim();
  if (!TIME_REGEX.test(trimmed)) return 0;

  const parts = trimmed.split(":").map(Number);
  const multipliers = [1, 60, 3600];

  return parts.reduceRight((totalSeconds, val, index) => {
    const multiplierIndex = parts.length - 1 - index;
    const unitValue = multipliers[multiplierIndex] ?? 0;
    return totalSeconds + val * unitValue;
  }, 0);
}

export function getHighResThumbnailUrl(url: string | undefined): string {
  if (!url) return "";
  return url.replace(/=w\d+-h\d+.*$/, config.THUMBNAIL_SPEC);
}

export function parseSongRenderer(itemRenderer: any): SongInfo | null {
  if (!itemRenderer) return null;

  const playButton =
    itemRenderer.overlay?.musicItemThumbnailOverlayRenderer?.content
      ?.musicPlayButtonRenderer;
  const track: string =
    playButton?.playNavigationEndpoint?.watchEndpoint?.videoId ?? "";

  if (!track) return null;

  const titleRuns = (idx: number): string =>
    itemRenderer.flexColumns?.[idx]?.musicResponsiveListItemFlexColumnRenderer
      ?.text?.runs?.[0]?.text ?? "Unknown";

  const title = `${titleRuns(0)} - ${titleRuns(1)}`;

  const metaRuns =
    itemRenderer.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer
      ?.text?.runs ?? [];
  const durationRun = metaRuns.find((run: any) =>
    TIME_REGEX.test(run.text?.trim()),
  );
  const duration = parseDurationToSeconds(durationRun?.text) * 1000;

  const rawThumbnailUrl =
    itemRenderer.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails?.[0]
      ?.url;
  const thumbnail = getHighResThumbnailUrl(rawThumbnailUrl);

  return {
    album: "Unknown",
    track,
    title,
    thumbnail,
    duration,
  };
}
