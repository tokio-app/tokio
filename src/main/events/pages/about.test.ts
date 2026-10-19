import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  FEEDBACK_CODES,
} from "@/common/types";
import Logger from "@/logger";
import { createHandler } from "@test/handler";
import { beforeEach, describe, expect, it, vi } from "vitest";
import about from "./about";

const pkg = {
  id: "ws@8.18.0",
  name: "ws",
  version: "8.18.0",
  license: "MIT",
  copyleft: false,
};
const documents = [{ id: "agpl", title: "GNU AGPL v3.0" }];

// To check what the handlers log
const silenceLogger = () => ({
  error: vi.spyOn(Logger, "error").mockImplementation(() => {}),
});

describe("about events", () => {
  let logger: ReturnType<typeof silenceLogger>;

  beforeEach(() => {
    logger = silenceLogger();
  });

  describe("GET_ABOUT", () => {
    it("replies the versions, the packages and the documents", async () => {
      const h = createHandler({
        licensesService: {
          getPackages: async () => ({ success: true, data: [pkg] }),
          getDocuments: () => documents,
        },
      });

      await h.invoke(about, APP_EVENTS.GET_ABOUT);

      expect(h.replies(APP_EVENTS_RESPONSE.GET_ABOUT)).toEqual([
        {
          success: true,
          data: {
            versions: {
              electron: process.versions.electron,
              chrome: process.versions.chrome,
              node: process.versions.node,
            },
            packages: [pkg],
            documents,
          },
        },
      ]);
      expect(h.notices).toEqual([]);
    });

    it("replies and notifies when the packages can't be read, without logging it again", async () => {
      const h = createHandler({
        licensesService: {
          getPackages: async () => ({ success: false, error: "ENOENT" }),
        },
      });

      await h.invoke(about, APP_EVENTS.GET_ABOUT);

      const failure = {
        code: FEEDBACK_CODES.ABOUT_LOAD_FAILED,
        message: "Unable to load the open-source licenses.",
      };
      expect(h.replies(APP_EVENTS_RESPONSE.GET_ABOUT)).toEqual([
        { success: false, error: failure },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({ level: "error", ...failure }),
      ]);
      // The licenses service logs its own failures
      expect(logger.error).not.toHaveBeenCalled();
    });
  });

  describe("GET_LICENSE_TEXT", () => {
    it("replies the text with its id", async () => {
      const text = { id: "agpl", title: "GNU AGPL v3.0", text: "..." };
      const getText = vi.fn(async () => ({ success: true, data: text }));
      const h = createHandler({ licensesService: { getText } });

      await h.invoke(about, APP_EVENTS.GET_LICENSE_TEXT, { id: "agpl" });

      expect(getText).toHaveBeenCalledWith("agpl");
      expect(h.replies(APP_EVENTS_RESPONSE.GET_LICENSE_TEXT)).toEqual([
        { success: true, id: "agpl", data: text },
      ]);
    });

    it("replies the failure with its id", async () => {
      const h = createHandler({
        licensesService: {
          getText: async () => ({ success: false, error: "Unknown license" }),
        },
      });

      await h.invoke(about, APP_EVENTS.GET_LICENSE_TEXT, { id: "missing" });

      const failure = {
        code: FEEDBACK_CODES.LICENSE_LOAD_FAILED,
        message: "Unable to read the license.",
      };
      expect(h.replies(APP_EVENTS_RESPONSE.GET_LICENSE_TEXT)).toEqual([
        { success: false, id: "missing", error: failure },
      ]);
      expect(h.notices).toEqual([expect.objectContaining(failure)]);
    });
  });
});
