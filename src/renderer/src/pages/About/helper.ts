import { UpdateStatus } from "@/common/types";
import { REPOSITORY_URL } from "@/common/util";

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
    name: "Feather, Octicons, Bootstrap Icons, Phosphor, Lucide",
    author: "Their respective authors",
    license: "MIT, ISC",
    url: "https://github.com/react-icons/react-icons",
    note: ICONS_NOTE,
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
    note: "TikTok LIVE, through tiktok-live-connector, and TikTok's text-to-speech (the TikTok voices). Neither is an official public API.",
  },
  {
    name: "Euler Stream",
    note: "Request signing used by tiktok-live-connector.",
  },
  {
    name: "Microsoft",
    note: "Edge's Read Aloud service (the Edge voices), which isn't an official public API.",
  },
  { name: "Spotify and YouTube", note: "Music requests." },
  {
    name: "GitHub",
    note: "Update checks and downloads, from Tokio's releases, and the official overlays (their list, previews and downloads), from the releases of tokio-app/overlays.",
  },
  {
    name: "MyInstants",
    note: "Sound search and downloads for alerts, read from the public website. Its sounds are uploaded by its users and aren't covered by Tokio's license.",
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
export function updateText(status: UpdateStatus): string {
  switch (status.state) {
    case "idle":
      return "Tokio hasn't checked for updates yet.";
    case "unsupported":
      return "Updates aren't available in this build.";
    case "checking":
      return "Checking for updates…";
    case "none":
      return "Tokio is up to date.";
    case "available":
      return status.manual
        ? `Tokio ${status.version} is available. Download it from the release page.`
        : `Tokio ${status.version} is available.`;
    case "downloading":
      return `Downloading Tokio ${status.version}… ${status.percent}%`;
    default:
      return `Tokio ${status.version} is ready to install.`;
  }
}
