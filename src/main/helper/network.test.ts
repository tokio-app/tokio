import { APP_HOSTNAME, SERVER_PORT } from "@/common/util";
import { shell, views } from "@test/electron";
import { WebContentsView } from "electron";
import { describe, expect, it, vi } from "vitest";
import Logger from "@/logger";
import {
  isOverlayURL,
  limitPermissions,
  openLinksOutside,
  reloadWhenGone,
} from "./network";

// A view's webContents, as the code gets it and as the fake records it
const contents = () => {
  const view = new WebContentsView();
  return { real: view.webContents, fake: views().at(-1)!.webContents };
};

describe("openLinksOutside", () => {
  it("opens web and mail links in the browser and denies every window", () => {
    const { real, fake } = contents();
    openLinksOutside(real);
    const [handler] = fake.setWindowOpenHandler.mock.calls[0];

    const results = [
      "https://tokio.ialfaro.com",
      "mailto:me@example.com",
      "file:///C:/app/out/renderer/index.html#/about",
      "javascript:alert(1)",
    ].map((url) => handler({ url }));

    expect(results.every(({ action }) => action === "deny")).toBe(true);
    expect(shell.openExternal.mock.calls).toEqual([
      ["https://tokio.ialfaro.com"],
      ["mailto:me@example.com"],
    ]);
  });
});

describe("reloadWhenGone", () => {
  it("reloads a page whose process crashed, and logs why", () => {
    const error = vi.spyOn(Logger, "error");
    const { real, fake } = contents();
    reloadWhenGone(real, () => "system.log");

    fake.emit("render-process-gone", {}, { reason: "crashed", exitCode: 1 });

    expect(fake.reload).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("crashed"),
      "system.log",
    );
  });

  it("leaves a page whose process exited cleanly", () => {
    const { real, fake } = contents();
    reloadWhenGone(real);

    fake.emit("render-process-gone", {}, { reason: "clean-exit", exitCode: 0 });

    expect(fake.reload).not.toHaveBeenCalled();
  });
});

describe("limitPermissions", () => {
  const ALLOWED = [
    "fullscreen",
    "clipboard-sanitized-write",
    "storage-access",
    "top-level-storage-access",
  ];
  const DENIED = ["media", "geolocation", "notifications", "midi", "hid"];

  it("grants only the permissions a player's pages need", () => {
    const { real, fake } = contents();
    limitPermissions(real.session);
    const [request] = fake.session.setPermissionRequestHandler.mock.calls[0];
    const [check] = fake.session.setPermissionCheckHandler.mock.calls[0];

    const granted = (permission: string) => {
      const callback = vi.fn<(granted: boolean) => void>();
      request(null, permission, callback);
      return callback.mock.calls[0][0];
    };

    for (const permission of ALLOWED) {
      expect(granted(permission)).toBe(true);
      expect(check(null, permission)).toBe(true);
    }
    for (const permission of DENIED) {
      expect(granted(permission)).toBe(false);
      expect(check(null, permission)).toBe(false);
    }
  });
});

describe("isOverlayURL", () => {
  it("matches previews loaded from disk", () => {
    expect(
      isOverlayURL(
        "local-resource:///C:/Users/me/.tokio/overlays/a/index.html",
      ),
    ).toBe(true);
  });

  it("matches pages of the overlay server", () => {
    for (const host of ["localhost", "127.0.0.1", "[::1]", APP_HOSTNAME]) {
      expect(isOverlayURL(`http://${host}:${SERVER_PORT}/a/`)).toBe(true);
    }
  });

  it("doesn't match the app or other servers", () => {
    expect(isOverlayURL("file:///C:/app/out/renderer/index.html")).toBe(false);
    expect(isOverlayURL("http://localhost:5173/")).toBe(false);
    expect(isOverlayURL(`http://example.com:${SERVER_PORT}/`)).toBe(false);
    expect(isOverlayURL("not a url")).toBe(false);
  });
});
