import { APP_HOSTNAME, SERVER_PORT } from "@/common/util";
import Logger from "@/logger";
import { shell, type Session, type WebContents } from "electron";

const OVERLAY_HOSTS = ["localhost", "127.0.0.1", "[::1]", APP_HOSTNAME];

/**
 * Whether the URL is an overlay: a preview loaded from disk through
 * `local-resource:`, or a page of the overlay server.
 */
export function isOverlayURL(url: string): boolean {
  try {
    const { protocol, hostname, port } = new URL(url);
    if (protocol === "local-resource:") return true;
    return (
      (protocol === "http:" || protocol === "https:") &&
      port === String(SERVER_PORT) &&
      OVERLAY_HOSTS.includes(hostname)
    );
  } catch {
    return false;
  }
}

const withoutHash = (url: string) => url.split("#")[0];

/**
 * Keeps an app page from navigating to another one, e.g. through a link.
 * Reloads, Vite's included, emit will-navigate to the same URL and go through.
 */
export function stayOnPage(contents: WebContents) {
  contents.on("will-navigate", (event) => {
    if (withoutHash(event.url) !== withoutHash(contents.getURL())) {
      event.preventDefault();
    }
  });
}

/**
 * Loads a page again when its renderer process dies, e.g. out of memory, so
 * a window doesn't stay blank and silent. `logFile` is read at the crash,
 * since the log files are set once the app has loaded.
 */
export function reloadWhenGone(
  contents: WebContents,
  logFile?: () => string | undefined,
) {
  contents.on("render-process-gone", (_event, { reason }) => {
    if (reason === "clean-exit") return;
    Logger.error(
      `<System> A page's process is gone (${reason}), reloading ${contents.getURL()}`,
      logFile?.(),
    );
    // shortcut: a page that dies as it loads reloads in a loop, add a
    // backoff if one ever does
    contents.reload();
  });
}

/**
 * Opens the web and mail links a page would open in a new window in the
 * browser instead, and denies every new window.
 */
export function openLinksOutside(contents: WebContents) {
  contents.setWindowOpenHandler(({ url }) => {
    // A Shift-click on a sidebar link opens the page's own file: URL.
    if (/^(https?|mailto):/.test(url)) {
      shell.openExternal(url).catch(() => {});
    }
    return { action: "deny" };
  });
}

// What a music player's pages need: fullscreen videos, copying a link, and
// the storage access logins ask for
const ALLOWED_PERMISSIONS = new Set([
  "fullscreen",
  "clipboard-sanitized-write",
  "storage-access",
  "top-level-storage-access",
]);

/**
 * Denies the session's pages every other permission, like the camera, the
 * microphone, notifications or the location.
 */
export function limitPermissions(session: Session) {
  session.setPermissionRequestHandler((_contents, permission, callback) =>
    callback(ALLOWED_PERMISSIONS.has(permission)),
  );
  session.setPermissionCheckHandler((_contents, permission) =>
    ALLOWED_PERMISSIONS.has(permission),
  );
}
