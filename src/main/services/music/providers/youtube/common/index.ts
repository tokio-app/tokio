import { SongInfo } from "@/common/types";
import { delay } from "@/common/util";

export const PlayerStateJSCode = `
(() => {
  const video = document.querySelector("video");
  if (!video) return null;

  const playing = !video.paused && !video.ended && video.readyState > 2;
  const time = video.currentTime * 1000;
  const duration = video.duration * 1000;

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
    thumbnail = rawImageSrc.replace(/=w\\d+-h\\d+.*$/, "=w480-h480-l90-rj");
  }

  const title = name && artist ? \`\${name} - \${artist}\` : name || artist;

  return {
    album: "Unknown",
    track: "Unknown",
    title,
    thumbnail,
    time,
    duration,
    playing,
  };
})();
`;

export const SearchJSCode = (query: string) => `
(() => {
  const searchIcon = document.querySelector('ytmusic-search-box tp-yt-paper-icon-button');
  if (searchIcon) searchIcon.click();

  const searchInput = document.querySelector('ytmusic-search-box input');
  if (searchInput) {
    searchInput.focus();
    searchInput.value = ${JSON.stringify(query)};
    searchInput.dispatchEvent(new Event('input', { bubbles: true }));
    searchInput.dispatchEvent(new Event('change', { bubbles: true }));
  }
})();
`;

export const AfterSearchJSCode = `
(async () => {
  let firstResult = null;
  await new Promise(r => setTimeout(r, 500));
  for (let i = 0; i < 25; i++) {
    await new Promise(r => setTimeout(r, 200));
    const searchPage = document.querySelector('ytmusic-search-page:not([hidden])');
    if (!searchPage) continue;
    firstResult = searchPage.querySelector('ytmusic-card-shelf-renderer, ytmusic-responsive-list-item-renderer');
    if (firstResult) break;
  }

  if (!firstResult) return null;

  const playBtn = firstResult.querySelector('ytmusic-play-button-renderer, .play-button-container');
  if (playBtn) {
    playBtn.click();
    await new Promise(r => setTimeout(r, 500));
    return true;
  }
  return null;
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

export const YT_MUSIC_CONFIG = {
  ENDPOINT: "https://music.youtube.com/youtubei/v1/search?prettyPrint=false",
  SONG_FILTER_PARAMS: "EgWKAQIIAWoKEAkQBRAKEAMQBA==",
  CLIENT_NAME: "WEB_REMIX",
  CLIENT_VERSION: "1.20260928.13.00",
  THUMBNAIL_SPEC: "=w480-h480-l90-rj",
};

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
  return url.replace(/=w\d+-h\d+.*$/, YT_MUSIC_CONFIG.THUMBNAIL_SPEC);
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
