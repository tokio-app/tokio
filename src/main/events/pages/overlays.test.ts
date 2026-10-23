import { CatalogOverlay, OverlayConfig } from "@/common/schemas";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  CustomGift,
  FEEDBACK_CODES,
  OverlayApp,
  TOKIO_EVENTS,
  TokioPayload,
} from "@/common/types";
import Logger from "@/logger";
import { dialog } from "@test/electron";
import { createHandler } from "@test/handler";
import {
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import overlays from "./overlays";

const overlay = (overrides: Partial<OverlayApp> = {}): OverlayApp => ({
  id: "gift-jar",
  name: "Gift Jar",
  version: "1.0.0",
  config: true,
  external: false,
  path: "overlays/gift-jar",
  ...overrides,
});

const imported = overlay({
  id: "7d3f0c52-1e7b-4a0e-9a59-3f0f6c1d2b8e",
  name: "Chat Box",
  external: true,
  path: "overlays/chat-box",
});

const gifts: CustomGift[] = [
  { value: 5655, label: "Rose", img: "rose.png", coins: 1 },
];

const catalogEntry: CatalogOverlay = {
  id: "gift-jar",
  name: "Gift Jar",
  version: "1.1.0",
  description: "Fills a jar with the gifts of the LIVE.",
  config: true,
  url: "https://github.com/tokio-app/overlays/releases/download/v1/gift-jar.zip",
  size: 1024,
  sha256: "a".repeat(64),
  preview: null,
};

const config: OverlayConfig = { sections: [], fields: [] };

// The change is made, but the store file wasn't written.
const saveError = {
  code: FEEDBACK_CODES.SETTINGS_SAVE_FAILED,
  message: "Tokio couldn't save the change. Check the logs folder for details.",
};

const pickFolder = (path: string) => {
  dialog.showOpenDialog.mockResolvedValue({
    canceled: false,
    filePaths: [path],
  });
};

describe("overlays events", () => {
  let logError: MockInstance<typeof Logger.error>;

  beforeEach(() => {
    logError = vi.spyOn(Logger, "error").mockImplementation(() => {});
    vi.spyOn(Logger, "warn").mockImplementation(() => {});
  });

  describe("IMPORT_OVERLAY", () => {
    const setup = (success = true, saved = true) => {
      const overlayService = {
        getGifts: vi.fn(async () => gifts),
        import: vi.fn(async (_path: string, _gifts: CustomGift[]) => ({
          success,
          saved,
        })),
        getOverlays: vi.fn(() => [imported]),
      };
      return { h: createHandler({ overlayService }), overlayService };
    };

    it("does nothing when the dialog is canceled", async () => {
      const { h, overlayService } = setup();

      await h.invoke(overlays, APP_EVENTS.IMPORT_OVERLAY);

      expect(dialog.showOpenDialog.mock.calls[0][0]).toBe(h.win);
      expect(dialog.showOpenDialog.mock.calls[0][1]).toMatchObject({
        properties: ["openDirectory"],
      });
      expect(overlayService.import).not.toHaveBeenCalled();
      expect(h.replies(APP_EVENTS_RESPONSE.GET_OVERLAYS)).toEqual([]);
      expect(h.notices).toEqual([]);
    });

    it("imports the folder with the gifts and answers with the overlays", async () => {
      const { h, overlayService } = setup();
      pickFolder("/streams/chat-box");

      await h.invoke(overlays, APP_EVENTS.IMPORT_OVERLAY);

      expect(overlayService.import).toHaveBeenCalledExactlyOnceWith(
        "/streams/chat-box",
        gifts,
      );
      expect(h.replies(APP_EVENTS_RESPONSE.GET_OVERLAYS)).toEqual([
        { success: true, data: [imported] },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "success",
          source: "overlays",
          code: FEEDBACK_CODES.OVERLAY_IMPORTED,
          message: "Overlay imported.",
        }),
      ]);
    });

    it("answers with the current overlays when the folder isn't an overlay", async () => {
      const { h } = setup(false);
      pickFolder("/streams/photos");

      await h.invoke(overlays, APP_EVENTS.IMPORT_OVERLAY);

      const failure = {
        code: FEEDBACK_CODES.OVERLAY_IMPORT_FAILED,
        message:
          'Unable to import the overlay. Check that the folder has an info.yaml and an index.html with a <script id="tokio-setup"> block.',
      };
      expect(h.replies(APP_EVENTS_RESPONSE.GET_OVERLAYS)).toEqual([
        { success: false, data: [imported], error: failure },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({ level: "error", ...failure }),
      ]);
      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining("/streams/photos is not a valid overlay."),
        undefined,
        expect.any(Error),
      );
    });

    it("reports a store that can't be saved, with the overlays main has", async () => {
      const { h } = setup(true, false);
      pickFolder("/streams/chat-box");

      await h.invoke(overlays, APP_EVENTS.IMPORT_OVERLAY);

      expect(h.replies(APP_EVENTS_RESPONSE.GET_OVERLAYS)).toEqual([
        { success: true, data: [imported] },
        { success: false, data: [imported], error: saveError },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({ level: "error", ...saveError }),
      ]);
      expect(logError).not.toHaveBeenCalled();
    });
  });

  describe("REMOVE_OVERLAY", () => {
    const setup = (success: boolean, saved = true) => {
      const overlayService = {
        remove: vi.fn(async (_id: string) => ({ success, saved })),
        getOverlays: vi.fn(() => [imported]),
      };
      return { h: createHandler({ overlayService }), overlayService };
    };

    it("removes the overlay and answers with the rest", async () => {
      const { h, overlayService } = setup(true);

      await h.invoke(overlays, APP_EVENTS.REMOVE_OVERLAY, { id: "gift-jar" });

      expect(overlayService.remove).toHaveBeenCalledExactlyOnceWith("gift-jar");
      expect(h.replies(APP_EVENTS_RESPONSE.GET_OVERLAYS)).toEqual([
        { success: true, data: [imported] },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "success",
          code: FEEDBACK_CODES.OVERLAY_REMOVED,
          message: "Overlay removed.",
        }),
      ]);
    });

    it("answers with the overlays when it can't remove it, without logging it again", async () => {
      const { h } = setup(false);

      await h.invoke(overlays, APP_EVENTS.REMOVE_OVERLAY, { id: "gift-jar" });

      const failure = {
        code: FEEDBACK_CODES.OVERLAY_REMOVE_FAILED,
        message: "Unable to remove the overlay.",
      };
      expect(h.replies(APP_EVENTS_RESPONSE.GET_OVERLAYS)).toEqual([
        { success: false, data: [imported], error: failure },
      ]);
      expect(h.notices).toEqual([expect.objectContaining(failure)]);
      expect(logError).not.toHaveBeenCalled();
    });

    it("reports a store that can't be saved, with the overlays main has", async () => {
      const { h } = setup(true, false);

      await h.invoke(overlays, APP_EVENTS.REMOVE_OVERLAY, { id: "gift-jar" });

      expect(h.replies(APP_EVENTS_RESPONSE.GET_OVERLAYS)).toEqual([
        { success: true, data: [imported] },
        { success: false, data: [imported], error: saveError },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({ level: "error", ...saveError }),
      ]);
    });
  });

  describe("GET_OVERLAY_CATALOG", () => {
    it("answers with the catalog", async () => {
      const h = createHandler({
        overlayService: {
          getCatalog: async () => ({ success: true, data: [catalogEntry] }),
        },
      });

      await h.invoke(overlays, APP_EVENTS.GET_OVERLAY_CATALOG);

      expect(h.replies(APP_EVENTS_RESPONSE.GET_OVERLAY_CATALOG)).toEqual([
        { success: true, data: [catalogEntry] },
      ]);
    });

    it("replies the failure without a notice, which the page shows", async () => {
      const h = createHandler({
        overlayService: { getCatalog: async () => ({ success: false }) },
      });

      await h.invoke(overlays, APP_EVENTS.GET_OVERLAY_CATALOG);

      expect(h.replies(APP_EVENTS_RESPONSE.GET_OVERLAY_CATALOG)).toEqual([
        {
          success: false,
          error: {
            code: FEEDBACK_CODES.OVERLAY_CATALOG_FAILED,
            message:
              "Unable to load the official overlays. Check your internet connection.",
          },
        },
      ]);
      expect(h.notices).toEqual([]);
      expect(logError).not.toHaveBeenCalled();
    });
  });

  describe("INSTALL_OVERLAY", () => {
    const setup = (installed: OverlayApp[], success = true, saved = true) => {
      const after = [overlay({ version: "1.1.0" }), imported];
      const overlayService = {
        getOverlays: vi.fn(() => installed),
        getGifts: vi.fn(async () => gifts),
        installFromCatalog: vi.fn(async (_id: string, _gifts: CustomGift[]) => {
          if (success) overlayService.getOverlays.mockReturnValue(after);
          return { success, saved };
        }),
      };
      return { h: createHandler({ overlayService }), overlayService, after };
    };

    it("installs an overlay that isn't installed", async () => {
      const { h, overlayService, after } = setup([imported]);

      await h.invoke(overlays, APP_EVENTS.INSTALL_OVERLAY, { id: "gift-jar" });

      expect(overlayService.installFromCatalog).toHaveBeenCalledExactlyOnceWith(
        "gift-jar",
        gifts,
      );
      expect(h.replies(APP_EVENTS_RESPONSE.GET_OVERLAYS)).toEqual([
        { success: true, data: after },
      ]);
      expect(h.replies(APP_EVENTS_RESPONSE.INSTALL_OVERLAY)).toEqual([
        { success: true, id: "gift-jar" },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "success",
          source: "overlays",
          code: FEEDBACK_CODES.OVERLAY_INSTALLED,
          message: "Overlay installed.",
        }),
      ]);
    });

    it("updates an installed official overlay", async () => {
      const { h } = setup([overlay(), imported]);

      await h.invoke(overlays, APP_EVENTS.INSTALL_OVERLAY, { id: "gift-jar" });

      expect(h.replies(APP_EVENTS_RESPONSE.INSTALL_OVERLAY)).toEqual([
        { success: true, id: "gift-jar" },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "success",
          code: FEEDBACK_CODES.OVERLAY_UPDATED,
          message:
            "Overlay updated. Refresh it in your streaming app to load the new version.",
        }),
      ]);
    });

    it("installs it when only an imported overlay has that id", async () => {
      const { h } = setup([overlay({ external: true })]);

      await h.invoke(overlays, APP_EVENTS.INSTALL_OVERLAY, { id: "gift-jar" });

      expect(h.notices).toEqual([
        expect.objectContaining({ code: FEEDBACK_CODES.OVERLAY_INSTALLED }),
      ]);
    });

    it("answers with the overlays before the install", async () => {
      const { h } = setup([]);

      await h.invoke(overlays, APP_EVENTS.INSTALL_OVERLAY, { id: "gift-jar" });

      expect(h.sent().map(([channel]) => channel)).toEqual([
        APP_EVENTS_RESPONSE.GET_OVERLAYS,
        APP_EVENTS_RESPONSE.INSTALL_OVERLAY,
        "notice",
      ]);
    });

    it.each([
      {
        action: "install",
        installed: [imported],
        code: FEEDBACK_CODES.OVERLAY_INSTALL_FAILED,
      },
      {
        action: "update",
        installed: [overlay()],
        code: FEEDBACK_CODES.OVERLAY_UPDATE_FAILED,
      },
    ])(
      "replies the id when it can't $action, without logging it again",
      async ({ action, installed, code }) => {
        const { h } = setup(installed, false);

        await h.invoke(overlays, APP_EVENTS.INSTALL_OVERLAY, {
          id: "gift-jar",
        });

        const failure = {
          code,
          message: `Unable to ${action} the overlay. Check your internet connection and try again.`,
        };
        expect(h.replies(APP_EVENTS_RESPONSE.INSTALL_OVERLAY)).toEqual([
          { success: false, error: failure, id: "gift-jar" },
        ]);
        expect(h.replies(APP_EVENTS_RESPONSE.GET_OVERLAYS)).toEqual([]);
        expect(h.notices).toEqual([
          expect.objectContaining({ level: "error", ...failure }),
        ]);
        expect(logError).not.toHaveBeenCalled();
      },
    );

    it("reports a store that can't be saved, with the overlays main has", async () => {
      const { h, after } = setup([imported], true, false);

      await h.invoke(overlays, APP_EVENTS.INSTALL_OVERLAY, { id: "gift-jar" });

      expect(h.replies(APP_EVENTS_RESPONSE.GET_OVERLAYS)).toEqual([
        { success: true, data: after },
      ]);
      expect(h.replies(APP_EVENTS_RESPONSE.INSTALL_OVERLAY)).toEqual([
        { success: false, error: saveError, id: "gift-jar" },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({ level: "error", ...saveError }),
      ]);
    });
  });

  describe("GET_OVERLAYS", () => {
    it("answers with the overlays", async () => {
      const h = createHandler({
        overlayService: { getOverlays: () => [overlay(), imported] },
      });

      await h.invoke(overlays, APP_EVENTS.GET_OVERLAYS);

      expect(h.replies(APP_EVENTS_RESPONSE.GET_OVERLAYS)).toEqual([
        { success: true, data: [overlay(), imported] },
      ]);
      expect(h.notices).toEqual([]);
    });

    it("replies a failure when they can't be listed", async () => {
      const h = createHandler({
        overlayService: {
          getOverlays: () => {
            throw new Error("not loaded");
          },
        },
      });

      await h.invoke(overlays, APP_EVENTS.GET_OVERLAYS);

      expect(h.replies(APP_EVENTS_RESPONSE.GET_OVERLAYS)).toEqual([
        {
          success: false,
          error: {
            code: FEEDBACK_CODES.OVERLAYS_LOAD_FAILED,
            message: "Unable to load the overlays.",
          },
        },
      ]);
    });
  });

  describe("GET_OVERLAY_CONFIG", () => {
    it("answers with the overlay's settings and its id", async () => {
      const getConfig = vi.fn(async (_id: string) => ({
        success: true,
        data: config,
      }));
      const h = createHandler({ overlayService: { getConfig } });

      await h.invoke(overlays, APP_EVENTS.GET_OVERLAY_CONFIG, {
        id: "gift-jar",
      });

      expect(getConfig).toHaveBeenCalledExactlyOnceWith("gift-jar");
      expect(h.replies(APP_EVENTS_RESPONSE.GET_OVERLAY_CONFIG)).toEqual([
        { success: true, id: "gift-jar", data: config },
      ]);
    });

    it("replies the id when the settings can't be read", async () => {
      const h = createHandler({
        overlayService: { getConfig: async () => ({ success: false }) },
      });

      await h.invoke(overlays, APP_EVENTS.GET_OVERLAY_CONFIG, {
        id: "gift-jar",
      });

      const failure = {
        code: FEEDBACK_CODES.OVERLAY_CONFIG_FAILED,
        message: "Unable to load the overlay's settings.",
      };
      expect(h.replies(APP_EVENTS_RESPONSE.GET_OVERLAY_CONFIG)).toEqual([
        { success: false, id: "gift-jar", error: failure },
      ]);
      expect(h.notices).toEqual([expect.objectContaining(failure)]);
    });
  });

  describe("GET_GIFTS", () => {
    it("answers with the saved gifts", async () => {
      const h = createHandler({
        overlayService: { getGifts: async () => gifts },
      });

      await h.invoke(overlays, APP_EVENTS.GET_GIFTS);

      expect(h.replies(APP_EVENTS_RESPONSE.GET_GIFTS)).toEqual([
        { data: gifts },
      ]);
    });

    it("answers with no gifts when they can't be read", async () => {
      const h = createHandler({
        overlayService: {
          getGifts: async () => {
            throw new Error("EACCES");
          },
        },
      });

      await h.invoke(overlays, APP_EVENTS.GET_GIFTS);

      expect(h.replies(APP_EVENTS_RESPONSE.GET_GIFTS)).toEqual([{ data: [] }]);
      expect(h.notices).toEqual([
        expect.objectContaining({
          code: FEEDBACK_CODES.GIFTS_FETCH_FAILED,
          message: "Unable to load the gifts.",
        }),
      ]);
    });
  });

  describe("SAVE_OVERLAY_CONFIG", () => {
    const request = { id: "gift-jar", config };
    const failure = {
      code: FEEDBACK_CODES.OVERLAY_SAVE_FAILED,
      message: "Unable to save the overlay's settings.",
    };
    const failing = () =>
      createHandler({
        overlayService: {
          getGifts: async () => gifts,
          saveConfig: async () => ({ success: false }),
        },
      });

    it("saves the settings with main's gifts, answers with them and sends them to the overlay", async () => {
      const saved = { title: "Gift Jar", goal: 100 };
      const saveConfig = vi.fn(
        async (_id: string, _config: OverlayConfig, _gifts: CustomGift[]) => ({
          success: true,
          data: saved,
        }),
      );
      const send = vi.fn((_id: string, _payload: TokioPayload) => {});
      const h = createHandler({
        overlayService: { getGifts: async () => gifts, saveConfig, send },
      });

      await h.invoke(overlays, APP_EVENTS.SAVE_OVERLAY_CONFIG, request);

      expect(saveConfig).toHaveBeenCalledExactlyOnceWith(
        "gift-jar",
        config,
        gifts,
      );
      expect(h.replies(APP_EVENTS_RESPONSE.SAVE_OVERLAY_CONFIG)).toEqual([
        { success: true, data: saved, id: "gift-jar" },
      ]);
      expect(send).toHaveBeenCalledExactlyOnceWith("gift-jar", {
        type: "tokio:config",
        data: saved,
      });
      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "success",
          code: FEEDBACK_CODES.OVERLAY_SAVED,
          message: "Overlay settings saved.",
        }),
      ]);
    });

    it("replies the failure with the overlay's id and notifies", async () => {
      const h = failing();

      await h.invoke(overlays, APP_EVENTS.SAVE_OVERLAY_CONFIG, request);

      expect(h.replies(APP_EVENTS_RESPONSE.SAVE_OVERLAY_CONFIG)).toEqual([
        { success: false, id: "gift-jar", error: failure },
      ]);
      expect(h.notices).toEqual([expect.objectContaining(failure)]);
    });
  });

  describe("SEND_OVERLAY_DATA", () => {
    it("sends the payload to the overlay", async () => {
      const send = vi.fn((_id: string, _payload: TokioPayload) => {});
      const h = createHandler({ overlayService: { send } });
      const payload: TokioPayload = {
        type: TOKIO_EVENTS.LIKE,
        data: {
          user: { username: "Viewer", handle: "viewer", profilePictures: [] },
          likeCount: 1,
          totalLikes: 10,
        },
      };

      await h.invoke(overlays, APP_EVENTS.SEND_OVERLAY_DATA, {
        id: "gift-jar",
        payload,
      });

      expect(send).toHaveBeenCalledExactlyOnceWith("gift-jar", payload);
      expect(h.notices).toEqual([]);
    });
  });

  describe("TEST_OVERLAY", () => {
    it("answers with the test payloads and the overlay's id", async () => {
      const payloads: TokioPayload[] = [
        { type: TOKIO_EVENTS.ENVELOPE, data: undefined },
      ];
      const h = createHandler({
        overlayService: { getTestPayloads: () => payloads },
      });

      await h.invoke(overlays, APP_EVENTS.TEST_OVERLAY, { id: "gift-jar" });

      expect(h.replies(APP_EVENTS_RESPONSE.TEST_OVERLAY)).toEqual([
        { payloads, id: "gift-jar" },
      ]);
    });

    it("answers with no payloads when they can't be made", async () => {
      const h = createHandler({
        overlayService: {
          getTestPayloads: () => {
            throw new Error("no samples");
          },
        },
      });

      await h.invoke(overlays, APP_EVENTS.TEST_OVERLAY, { id: "gift-jar" });

      expect(h.replies(APP_EVENTS_RESPONSE.TEST_OVERLAY)).toEqual([
        { payloads: [], id: "gift-jar" },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({ code: FEEDBACK_CODES.TEST_OVERLAY_FAILED }),
      ]);
    });
  });
});
