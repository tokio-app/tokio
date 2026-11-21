import { MessageKey, Params, translate } from "@/common/i18n";
import { UpdateStatus } from "@/common/types";
import { REPOSITORY_URL } from "@/common/util";
import { formatDate } from "@/helper/format";

// Keep in sync with THIRD_PARTY_NOTICES.md. npm packages are listed by main,
// these are the notices that don't come from a package.

export const COPYRIGHT = "© 2026 Italo Alfaro and contributors";

export interface Component {
  name: string;
  author: string;
  license: string;
  url: string;
  note: string;
  // Document id from GET_ABOUT with the license text
  doc?: string;
}

const ICONS_NOTE =
  "Icons, converted from SVG to React components by react-icons.";

export const COMPONENTS: Component[] = [
  {
    name: "edge-tts (drm-v2.ts)",
    author: "rany and the edge-tts contributors",
    license: "LGPL-3.0-only",
    url: "https://github.com/rany2/edge-tts",
    note: "Ported to TypeScript to generate the token of the Edge TTS provider. You may modify or replace this file and rebuild Tokio from its source.",
    doc: "LGPL-3.0",
  },
  {
    name: "VS Code Codicons 0.0.35",
    author: "Microsoft Corporation",
    license: "CC BY 4.0",
    url: "https://github.com/microsoft/vscode-codicons",
    note: ICONS_NOTE,
    doc: "CC-BY-4.0",
  },
  {
    name: "Font Awesome Free 5.15.4",
    author: "Fonticons, Inc.",
    license: "CC BY 4.0",
    url: "https://fontawesome.com/license/free",
    note: ICONS_NOTE,
    doc: "CC-BY-4.0",
  },
  {
    name: "Material Design icons 4.0.0",
    author: "Google",
    license: "Apache-2.0",
    url: "https://github.com/google/material-design-icons",
    note: ICONS_NOTE,
    doc: "Apache-2.0",
  },
  {
    name: "Feather, Octicons, Phosphor, Lucide",
    author: "Their respective authors",
    license: "MIT, ISC",
    url: "https://github.com/react-icons/react-icons",
    note: ICONS_NOTE,
  },
  {
    name: "Code bundled in the MCP SDK",
    author:
      "Evgeny Poberezkin, Jeremy Danyow, Gary Court and the Fastify team, Remy Rylan",
    license: "MIT, BSD-3-Clause, BSD-2-Clause",
    url: "https://github.com/modelcontextprotocol/typescript-sdk",
    note: "ajv, ajv-formats, json-schema-traverse and @cfworker/json-schema (MIT), fast-uri (BSD-3-Clause) and json-schema-typed (BSD-2-Clause), compiled into the MCP server SDK, which ships them without their license files.",
    doc: "MCP-SDK-bundled",
  },
  {
    name: "Electron and Chromium",
    author: "The Electron and Chromium authors",
    license: "MIT and others",
    url: "https://www.electronjs.org",
    note: "Their licenses are installed next to Tokio, in LICENSE.electron.txt and LICENSES.chromium.html.",
  },
];

export const SERVICES: { name: string; note: string }[] = [
  {
    name: "TikTok",
    note: "TikTok LIVE, through @tokioapp/connector, and TikTok's text-to-speech (the TikTok voices), when the user has added a TikTok session ID. Neither is an official public API.",
  },
  {
    name: "TikTok TTS proxy",
    note: "The TikTok voices when no session ID is set (ottsy.weilbyte.dev). It gets the text of each message to read and its voice. It's run by a third party, not by TikTok or Tokio.",
  },
  {
    name: "Euler Stream",
    note: "Signs the connection to TikTok LIVE, with each user's own API key.",
  },
  {
    name: "Twitch",
    note: "LIVE events, chat and viewer counts through Twitch's official API (id.twitch.tv, api.twitch.tv, eventsub.wss.twitch.tv), with each user's own sign-in.",
  },
  {
    name: "Microsoft",
    note: "Edge's Read Aloud service (the Edge voices), which isn't an official public API.",
  },
  {
    name: "ElevenLabs",
    note: "The ElevenLabs voices and voice cloning (api.elevenlabs.io), with each user's own API key. It gets the text of each message to read, and the samples of a voice to clone.",
  },
  {
    name: "Fish Audio",
    note: "The Fish Audio voices and voice cloning (api.fish.audio), with each user's own API key. It gets the text of each message to read, and the samples of a voice to clone.",
  },
  {
    name: "Cartesia",
    note: "The Cartesia voices and voice cloning (api.cartesia.ai), with each user's own API key. It gets the text of each message to read, and the samples of a voice to clone.",
  },
  {
    name: "Inworld",
    note: "The Inworld voices and voice cloning (api.inworld.ai), with each user's own API key. It gets the text of each message to read, and the samples of a voice to clone.",
  },
  {
    name: "Google",
    note: "Chat translation, through Google Translate's web service (translate.googleapis.com), which isn't an official public API. It gets the text of each message to translate.",
  },
  { name: "Spotify", note: "Music requests." },
  {
    name: "YouTube",
    note: "Music requests, and a LIVE's chat, Super Chats, memberships, Gifts and viewer count (www.youtube.com), read from YouTube's public pages the way youtube.com does, which isn't an official API.",
  },
  {
    name: "uBlock Origin's filter lists",
    note: "The YouTube player's ad blocker, when Block ads is on (ublockorigin.github.io, then its mirrors ublockorigin.pages.dev and cdn.jsdelivr.net). uBlock Origin's own lists and its copies of EasyList and EasyPrivacy belong to their authors, are under the GPL-3.0 or CC BY-SA 3.0, and aren't covered by Tokio's license. Tokio downloads them on the user's machine and doesn't ship them.",
  },
  {
    name: "Public Suffix List",
    note: "The same ad blocker, to tell a site from its subdomains (publicsuffix.org). Mozilla's list is under the MPL-2.0, and Tokio downloads it rather than ship it.",
  },
  {
    name: "GitHub",
    note: "Update checks and downloads, from Tokio's releases, and the official overlays (their list, previews and downloads), from the releases of tokio-app/overlays.",
  },
  {
    name: "MyInstants",
    note: "Sound search and downloads for alerts, read from the public website rather than an official API. Its sounds are uploaded by its users and aren't covered by Tokio's license.",
  },
  {
    name: "Lorem Picsum",
    note: "Sample pictures (profile pictures, emotes, song covers) in overlay tests and previews.",
  },
];

type LinkTarget = { doc: string } | { url: string };

/**
 * Where a link of THIRD_PARTY_NOTICES.md goes. Its links are relative to the
 * repository: licenses open in the viewer, other files on GitHub.
 */
export function resolveNoticeLink(href: string): LinkTarget | null {
  if (/^(https?:\/\/|mailto:)/.test(href)) return { url: href };
  if (href === "LICENSE") return { doc: "tokio" };

  const license = href.match(/^LICENSES\/([\w.-]+)\.txt$/);
  if (license) return { doc: license[1] };

  if (/^[\w-][\w./-]*$/.test(href) && !href.includes("..")) {
    return { url: `${REPOSITORY_URL}/blob/main/${href}` };
  }
  return null;
}

/** What the About page says about updates. */
export function updateText(status: UpdateStatus, language: string): string {
  const t = (key: MessageKey, params?: Params) =>
    translate(language, key, params);
  switch (status.state) {
    case "idle":
      return t("about.update.idle");
    case "unsupported":
      return t("about.update.unsupported");
    case "checking":
      return t("about.update.checking");
    case "none":
      return t("about.update.none");
    case "available":
      return t("about.update.available", { version: status.version });
    case "downloading":
      return t("about.update.downloading", { version: status.version });
    default:
      return t("about.update.ready", { version: status.version });
  }
}

/** The line under it: what happens next, or when Tokio last checked. */
export function updateDetail(
  status: UpdateStatus,
  language: string,
): string | undefined {
  switch (status.state) {
    case "none":
      return translate(language, "about.update.checkedAt", {
        time: formatDate(status.checkedAt, language, "time"),
      });
    case "available":
      return status.manual
        ? translate(language, "about.update.manual")
        : undefined;
    case "downloading":
      return translate(language, "about.update.downloadingDetail");
    case "ready":
      return translate(language, "about.update.readyDetail");
    default:
      return undefined;
  }
}
