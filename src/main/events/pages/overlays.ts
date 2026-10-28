import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  AppError,
  FEEDBACK_CODES,
} from "@/common/types";
import { showOpenDialog } from "@/helper/dialog";
import { createStack, replyFailure } from "@/helper/events";
import { AppFailure, LoggedError, saveFailure } from "@/helper/feedback";
import { t } from "@/helper/i18n";
import { AppHandlerVariables, ReplyEvent } from "@/types";

const events = createStack("overlays");

// The overlay list's failure reply, with the overlays main serves.
const replyOverlays = (
  e: ReplyEvent,
  error: AppError,
  _: unknown,
  { overlayService }: AppHandlerVariables,
) =>
  e.reply(APP_EVENTS_RESPONSE.GET_OVERLAYS, {
    success: false,
    data: overlayService.getOverlays(),
    error,
  });

events.push(
  APP_EVENTS.IMPORT_OVERLAY,
  async ({ win, overlayService, notifier }, e) => {
    const diagRes = await showOpenDialog(win, {
      title: t("main.dialog.importOverlay"),
      properties: ["openDirectory"],
    });
    if (diagRes.canceled) return;

    const gifts = await overlayService.getGifts();
    const res = await overlayService.import(diagRes.filePaths[0], gifts);
    if (!res.success) {
      throw new Error(`${diagRes.filePaths[0]} is not a valid overlay.`);
    }

    e.reply(APP_EVENTS_RESPONSE.GET_OVERLAYS, {
      success: true,
      data: overlayService.getOverlays(),
    });
    if (res.saved === false) throw saveFailure();
    notifier.success(
      "overlays",
      FEEDBACK_CODES.OVERLAY_IMPORTED,
      t("main.overlays.imported"),
    );
  },
  {
    failure: {
      code: FEEDBACK_CODES.OVERLAY_IMPORT_FAILED,
      message: "main.failure.importOverlay",
    },
    onError: replyOverlays,
  },
);

events.push(
  APP_EVENTS.REMOVE_OVERLAY,
  async ({ overlayService, notifier }, e, { id }) => {
    const res = await overlayService.remove(id);
    if (!res.success) throw new LoggedError(`Unable to remove overlay ${id}.`);

    e.reply(APP_EVENTS_RESPONSE.GET_OVERLAYS, {
      success: true,
      data: overlayService.getOverlays(),
    });
    if (res.saved === false) throw saveFailure();
    notifier.success(
      "overlays",
      FEEDBACK_CODES.OVERLAY_REMOVED,
      t("main.overlays.removed"),
    );
  },
  {
    failure: {
      code: FEEDBACK_CODES.OVERLAY_REMOVE_FAILED,
      message: "main.failure.removeOverlay",
    },
    onError: replyOverlays,
  },
);

events.push(
  APP_EVENTS.GET_OVERLAY_CATALOG,
  async ({ overlayService }, e) => {
    const res = await overlayService.getCatalog();
    if (!res.success) throw new LoggedError("Unable to read the catalog.");
    e.reply(APP_EVENTS_RESPONSE.GET_OVERLAY_CATALOG, {
      success: true,
      data: res.data,
    });
  },
  {
    failure: {
      code: FEEDBACK_CODES.OVERLAY_CATALOG_FAILED,
      message: "main.failure.getOverlayCatalog",
    },
    // The page shows it, with a button to try again.
    notify: false,
    onError: replyFailure(APP_EVENTS_RESPONSE.GET_OVERLAY_CATALOG),
  },
);

events.push(
  APP_EVENTS.INSTALL_OVERLAY,
  async ({ overlayService, notifier }, e, { id }) => {
    const updating = overlayService
      .getOverlays()
      .some((o) => o.id === id && !o.external);
    const gifts = await overlayService.getGifts();
    const res = await overlayService.installFromCatalog(id, gifts);
    if (!res.success) {
      throw new AppFailure(
        updating
          ? FEEDBACK_CODES.OVERLAY_UPDATE_FAILED
          : FEEDBACK_CODES.OVERLAY_INSTALL_FAILED,
        updating
          ? t("main.overlays.updateFailed")
          : t("main.overlays.installFailed"),
        { logged: true },
      );
    }

    e.reply(APP_EVENTS_RESPONSE.GET_OVERLAYS, {
      success: true,
      data: overlayService.getOverlays(),
    });
    if (res.saved === false) throw saveFailure();
    e.reply(APP_EVENTS_RESPONSE.INSTALL_OVERLAY, { success: true, id });
    if (updating) {
      notifier.success(
        "overlays",
        FEEDBACK_CODES.OVERLAY_UPDATED,
        t("main.overlays.updated"),
      );
    } else {
      notifier.success(
        "overlays",
        FEEDBACK_CODES.OVERLAY_INSTALLED,
        t("main.overlays.installed"),
      );
    }
  },
  {
    failure: {
      code: FEEDBACK_CODES.OVERLAY_INSTALL_FAILED,
      message: "main.failure.installOverlay",
    },
    onError: (e, error, { id }) =>
      e.reply(APP_EVENTS_RESPONSE.INSTALL_OVERLAY, {
        success: false,
        error,
        id,
      }),
  },
);

events.push(
  APP_EVENTS.GET_OVERLAYS,
  async ({ overlayService }, e) => {
    e.reply(APP_EVENTS_RESPONSE.GET_OVERLAYS, {
      success: true,
      data: overlayService.getOverlays(),
    });
  },
  {
    failure: {
      code: FEEDBACK_CODES.OVERLAYS_LOAD_FAILED,
      message: "main.failure.getOverlays",
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.GET_OVERLAYS),
  },
);

events.push(
  APP_EVENTS.GET_OVERLAY_CONFIG,
  async ({ overlayService }, e, { id }) => {
    const res = await overlayService.getConfig(id);
    if (!res.success) throw new Error(`Unable to read overlay ${id}.`);
    e.reply(APP_EVENTS_RESPONSE.GET_OVERLAY_CONFIG, {
      success: true,
      id,
      data: res.data,
    });
  },
  {
    failure: {
      code: FEEDBACK_CODES.OVERLAY_CONFIG_FAILED,
      message: "main.failure.getOverlayConfig",
    },
    onError: (e, error, { id }) =>
      e.reply(APP_EVENTS_RESPONSE.GET_OVERLAY_CONFIG, {
        success: false,
        id,
        error,
      }),
  },
);

events.push(
  APP_EVENTS.GET_GIFTS,
  async ({ overlayService }, e) => {
    e.reply(APP_EVENTS_RESPONSE.GET_GIFTS, {
      data: await overlayService.getGifts(),
    });
  },
  {
    failure: {
      code: FEEDBACK_CODES.GIFTS_FETCH_FAILED,
      message: "main.failure.getGifts",
    },
    onError: (e) => e.reply(APP_EVENTS_RESPONSE.GET_GIFTS, { data: [] }),
  },
);

events.push(
  APP_EVENTS.SAVE_OVERLAY_CONFIG,
  async ({ overlayService, notifier }, e, { config, id }) => {
    const gifts = await overlayService.getGifts();
    const res = await overlayService.saveConfig(id, config, gifts);
    if (!res.success) throw new Error(`Unable to save overlay ${id}.`);
    e.reply(APP_EVENTS_RESPONSE.SAVE_OVERLAY_CONFIG, {
      success: true,
      data: res.data,
      id,
    });
    // From here, so the live overlays get it even when the page has closed.
    overlayService.send(id, { type: "tokio:config", data: res.data! });
    notifier.success(
      "overlays",
      FEEDBACK_CODES.OVERLAY_SAVED,
      t("main.overlays.settingsSaved"),
    );
  },
  {
    failure: {
      code: FEEDBACK_CODES.OVERLAY_SAVE_FAILED,
      message: "main.failure.saveOverlayConfig",
    },
    onError: (e, error, { id }) =>
      e.reply(APP_EVENTS_RESPONSE.SAVE_OVERLAY_CONFIG, {
        success: false,
        id,
        error,
      }),
  },
);

events.push(
  APP_EVENTS.SEND_OVERLAY_DATA,
  async ({ overlayService }, _, { id, payload }) => {
    overlayService.send(id, payload);
  },
  {
    failure: {
      code: FEEDBACK_CODES.OVERLAY_SEND_FAILED,
      message: "main.failure.sendOverlayData",
    },
  },
);

events.push(
  APP_EVENTS.TEST_OVERLAY,
  async ({ overlayService }, e, { id }) => {
    e.reply(APP_EVENTS_RESPONSE.TEST_OVERLAY, {
      payloads: overlayService.getTestPayloads(id),
      id,
    });
  },
  {
    failure: {
      code: FEEDBACK_CODES.TEST_OVERLAY_FAILED,
      message: "main.failure.testOverlay",
    },
    onError: (e, _, { id }) =>
      e.reply(APP_EVENTS_RESPONSE.TEST_OVERLAY, { payloads: [], id }),
  },
);

export default events;
