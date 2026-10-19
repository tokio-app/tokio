import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  FEEDBACK_CODES,
} from "@/common/types";
import Logger from "@/logger";
import { shell } from "@test/electron";
import { createHandler } from "@test/handler";
import { beforeEach, describe, expect, it, vi } from "vitest";
import updates from "./updates";

const release = "https://github.com/tokio-app/tokio/releases/tag/v1.2.0";

// To check what the handlers log
const silenceLogger = () => ({
  error: vi.spyOn(Logger, "error").mockImplementation(() => {}),
  warn: vi.spyOn(Logger, "warn").mockImplementation(() => {}),
});

describe("updates events", () => {
  let logger: ReturnType<typeof silenceLogger>;

  beforeEach(() => {
    logger = silenceLogger();
  });

  describe("GET_UPDATE_STATUS", () => {
    it("replies the updater's status", async () => {
      const status = { state: "ready" as const, version: "1.2.0" };
      const h = createHandler({ updaterService: { getStatus: () => status } });

      await h.invoke(updates, APP_EVENTS.GET_UPDATE_STATUS);

      expect(h.replies(APP_EVENTS_RESPONSE.UPDATE_STATUS)).toEqual([status]);
      expect(h.notices).toEqual([]);
    });

    it("doesn't notify when the status can't be read", async () => {
      const h = createHandler({
        updaterService: {
          getStatus: () => {
            throw new Error("not initialized");
          },
        },
      });

      await h.invoke(updates, APP_EVENTS.GET_UPDATE_STATUS);

      expect(h.replies(APP_EVENTS_RESPONSE.UPDATE_STATUS)).toEqual([]);
      expect(h.notices).toEqual([]);
    });
  });

  describe("CHECK_UPDATES", () => {
    it("replies once the check is done", async () => {
      const check = vi.fn(async () => ({ success: true }));
      const h = createHandler({ updaterService: { check } });

      await h.invoke(updates, APP_EVENTS.CHECK_UPDATES);

      expect(check).toHaveBeenCalledOnce();
      expect(h.replies(APP_EVENTS_RESPONSE.CHECK_UPDATES)).toEqual([
        { success: true },
      ]);
      expect(h.notices).toEqual([]);
    });

    it("replies a failed check for About to show, without a notice or a second log", async () => {
      const h = createHandler({
        updaterService: {
          check: async () => ({ success: false, error: "net::ERR_OFFLINE" }),
        },
      });

      await h.invoke(updates, APP_EVENTS.CHECK_UPDATES);

      expect(h.replies(APP_EVENTS_RESPONSE.CHECK_UPDATES)).toEqual([
        {
          success: false,
          error: {
            code: FEEDBACK_CODES.UPDATE_CHECK_FAILED,
            message: "Unable to check for updates. Check your connection.",
          },
        },
      ]);
      expect(h.notices).toEqual([]);
      // The updater logs its own errors
      expect(logger.warn).not.toHaveBeenCalled();
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe("INSTALL_UPDATE", () => {
    it("warns when no update is ready", async () => {
      const h = createHandler({
        updaterService: {
          install: () => ({
            success: false,
            error: "No update is ready to install.",
          }),
        },
      });

      await h.invoke(updates, APP_EVENTS.INSTALL_UPDATE);

      expect(shell.openExternal).not.toHaveBeenCalled();
      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "warning",
          code: FEEDBACK_CODES.UPDATE_INSTALL_FAILED,
          message: "No update is ready to install yet.",
        }),
      ]);
    });

    it("opens the release page of an update the app can't install", async () => {
      const h = createHandler({
        updaterService: {
          install: () => ({ success: true, data: { url: release } }),
        },
      });

      await h.invoke(updates, APP_EVENTS.INSTALL_UPDATE);

      expect(shell.openExternal).toHaveBeenCalledExactlyOnceWith(release);
      expect(h.notices).toEqual([]);
    });

    it("opens nothing when the app installs the update itself", async () => {
      const install = vi.fn(() => ({ success: true }));
      const h = createHandler({ updaterService: { install } });

      await h.invoke(updates, APP_EVENTS.INSTALL_UPDATE);

      expect(install).toHaveBeenCalledOnce();
      expect(shell.openExternal).not.toHaveBeenCalled();
      expect(h.notices).toEqual([]);
    });
  });
});
