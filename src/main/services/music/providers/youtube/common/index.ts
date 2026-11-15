import { SongInfo } from "@/common/types";
import config from "../config";

// The size part of a thumbnail URL, swapped for the size we want
const THUMBNAIL_SIZE = /=w\d+-h\d+.*$/;

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
  const response = player.getPlayerResponse?.();
  const formats = response?.streamingData?.adaptiveFormats ?? [];
  const audio = formats.find((f) => f.mimeType?.startsWith("audio/"));
  const duration = Number(audio?.approxDurationMs) || player.getDuration() * 1000;
  const id = player.getVideoData().video_id;

  // The song's own pictures, smallest first. The player bar's picture isn't
  // one: in the minimized window, or during an ad, it holds the page's address.
  const pictures = response?.videoDetails?.thumbnail?.thumbnails ?? [];
  const picture =
    pictures.at(-1)?.url ?? (id ? "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg" : "");
  const thumbnail = picture.replace(${THUMBNAIL_SIZE}, ${JSON.stringify(config.THUMBNAIL_SPEC)});

  const playerBar = document.querySelector("ytmusic-player-bar");

  let name = "";
  let artist = "";

  if (playerBar) {
    const titleNode = playerBar.querySelector(".title");
    const artistNode = playerBar.querySelector(".subtitle a");

    name = titleNode?.textContent?.trim() ?? "";
    artist = artistNode?.textContent?.trim() ?? "";
  }

  const title = name && artist ? \`\${name} - \${artist}\` : name || artist;

  return {
    album: "Unknown",
    track: id || "Unknown",
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

// Presses the player bar's Next as a person would, else asks the player for
// its next video. True once one of them was there.
export const NextJSCode = `
(() => {
  const next = document.querySelector(${JSON.stringify(config.NEXT_BUTTON)});
  if (next) {
    next.click();
    return true;
  }
  const player = document.querySelector("#movie_player");
  if (!player?.nextVideo) return false;
  player.nextVideo();
  return true;
})();
`;

// An isolated world of its own, where YouTube's page can't see the script
export const KEEP_PLAYING_WORLD = 1919;

// After about 40 minutes with nobody at the page, YouTube Music pauses each
// song a few seconds in behind "Video paused. Continue watching?". The page
// answers it as a person would. Its only button is the yes. Its Premium
// upsell is left alone: it doesn't pause a song, and its other button opens
// Premium.
export const KeepPlayingJSCode = `
(() => {
  if (window.keepPlaying) return;
  window.keepPlaying = setInterval(() => {
    const yes = document.querySelector("ytmusic-you-there-renderer button");
    if (yes && yes.getClientRects().length > 0) yes.click();
  }, 1000);
})();
`;

const TIME_REGEX = /^(\d+:)*\d+$/;

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
  return url.replace(THUMBNAIL_SIZE, config.THUMBNAIL_SPEC);
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
  // The length is the last run: an album named "1989" also looks like a time.
  const durationRun = metaRuns.findLast((run: any) =>
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
