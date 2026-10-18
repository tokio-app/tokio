import { isAbsolute, relative, resolve, sep } from "node:path";

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
  // Empty for the folder itself, absolute for another drive on Windows.
  const inside = relative(resolve(overlaysFolder), file);
  const outside =
    !inside ||
    inside === ".." ||
    inside.startsWith(`..${sep}`) ||
    isAbsolute(inside);
  return outside ? null : file;
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
 * Gives an overlay page loaded as a preview (through `local-resource:`) the
 * app's background. Overlays are transparent so they can sit on the stream,
 * and Chromium only draws ClearType text on an opaque background, so their
 * text looked rough next to the app's. The files and what the overlay server
 * sends stay as they are. Other files pass through.
 */
export async function withPreviewBackground(
  res: Response,
  path: string,
): Promise<Response> {
  if (!res.ok || !/\.html?$/i.test(path)) return res;

  // After everything else, so it wins over the overlay's own styles. Adding
  // it before the doctype would switch the page to quirks mode.
  const html = `${await res.text()}<style>html{background-color:${PREVIEW_BACKGROUND}!important}</style>`;
  const headers = new Headers(res.headers);
  headers.delete("content-length");
  return new Response(html, { status: res.status, headers });
}
