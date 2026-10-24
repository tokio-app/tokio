import type { Folders } from "@/common/types";
import { AUDIO_EXTENSIONS, mediaKind } from "@/common/util";
import { basename, extname, join, resolve } from "node:path";
import { isInside } from "./path";

// --background-primary in src/ui/styles/tokens.css, what previews sit on
const PREVIEW_BACKGROUND = "#121212";

/**
 * The file a preview URL (`local-resource:///C:/.../overlays/<id>/index.html`)
 * points at, or null when it's outside the overlays folder or the folders
 * aren't known yet. Previews run the overlays' own code, which can fetch these
 * URLs (see withPreviewCORS), so nothing else on disk is served.
 */
export function previewFile(
  url: string,
  overlaysFolder: string | undefined,
): string | null {
  if (!overlaysFolder) return null;

  let path: string;
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    return null;
  }
  if (process.platform === "win32" && /^\/[a-zA-Z]:\//.test(path)) {
    path = path.slice(1);
  }

  const file = resolve(path);
  return isInside(overlaysFolder, file) ? file : null;
}

/**
 * The library file a `tokio-media:` URL names, or null: a thumbnail's
 * (`tokio-media:///<file>`, see getMediaPreviewURL) or a sound's
 * (`tokio-media:///sounds/<file>`, see getSoundPreviewURL). Only images and
 * videos right in the media folder, and audio right in the sounds folder, are
 * served.
 */
export function mediaFile(
  url: string,
  folders: Pick<Folders, "mediaFolder" | "soundsFolder"> | undefined,
): string | null {
  if (!folders) return null;

  let name: string;
  try {
    name = decodeURIComponent(new URL(url).pathname).replace(/^\/+/, "");
  } catch {
    return null;
  }
  if (name.startsWith("sounds/")) {
    const sound = name.slice("sounds/".length);
    const ext = extname(sound).slice(1).toLowerCase();
    return basename(sound) === sound && AUDIO_EXTENSIONS.includes(ext)
      ? join(folders.soundsFolder, sound)
      : null;
  }
  return basename(name) === name && mediaKind(name)
    ? join(folders.mediaFolder, name)
    : null;
}

/**
 * Lets a preview load its own scripts, styles, fonts and data. Previews are on
 * `local-resource:`, which has no origin, so Chromium checks every module
 * script, `crossorigin` stylesheet, font and fetch against CORS, and builds
 * from Vite and other bundlers load their code that way. The scheme is
 * registered with `corsEnabled` for it in src/main/index.ts.
 */
export function withPreviewCORS(res: Response): Response {
  const headers = new Headers(res.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

/**
 * Styles an overlay page loaded as a preview (through `local-resource:`):
 * - The app's background. Overlays are transparent so they can sit on the
 *   stream, and Chromium only draws ClearType text on an opaque background, so
 *   their text looked rough next to the app's.
 * - No scrollbars, as OBS's default browser source CSS does. Previews can't be
 *   scrolled (the Iframe ignores the pointer), so a page taller than the
 *   preview only showed a scrollbar that can't be used.
 *
 * The files and what the overlay server sends stay as they are. Other files
 * pass through.
 */
export async function withPreviewStyles(
  res: Response,
  path: string,
): Promise<Response> {
  if (!res.ok || !/\.html?$/i.test(path)) return res;

  // After everything else, so it wins over the overlay's own styles. Adding
  // it before the doctype would switch the page to quirks mode.
  const html = `${await res.text()}<style>html{background-color:${PREVIEW_BACKGROUND}!important}html,body{overflow:hidden!important}</style>`;
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  return new Response(html, { status: res.status, headers });
}
