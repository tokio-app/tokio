import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  FEEDBACK_CODES,
} from "@/common/types";
import { createStack, replyFailure } from "@/helper/events";
import { AppFailure, LoggedError } from "@/helper/feedback";
import { dialog } from "electron";

const events = createStack("overlays");

events.push(
  APP_EVENTS.IMPORT_OVERLAY,
  async ({ win, overlayService, notifier }, e) => {
    const diagRes = await dialog.showOpenDialog(win, {
      title: `Import Overlay`,
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
    notifier.success(
      "overlays",
      FEEDBACK_CODES.OVERLAY_IMPORTED,
      "Overlay imported.",
    );
  },
  {
    failure: {
      code: FEEDBACK_CODES.OVERLAY_IMPORT_FAILED,
      message:
        'Unable to import the overlay. Check that the folder has an info.yaml and an index.html with a <script id="tokio-setup"> block.',
    },
    onError: (e, error, _, { overlayService }) =>
      e.reply(APP_EVENTS_RESPONSE.GET_OVERLAYS, {
        success: false,
        data: overlayService.getOverlays(),
        error,
      }),
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
    notifier.success(
      "overlays",
      FEEDBACK_CODES.OVERLAY_REMOVED,
      "Overlay removed.",
    );
  },
  {
    failure: {
      code: FEEDBACK_CODES.OVERLAY_REMOVE_FAILED,
      message: "Unable to remove the overlay.",
    },
    onError: (e, error, _, { overlayService }) =>
      e.reply(APP_EVENTS_RESPONSE.GET_OVERLAYS, {
        success: false,
        data: overlayService.getOverlays(),
        error,
      }),
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
      message:
        "Unable to load the official overlays. Check your internet connection.",
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
        `Unable to ${updating ? "update" : "install"} the overlay. Check your internet connection and try again.`,
        { logged: true },
      );
    }

    e.reply(APP_EVENTS_RESPONSE.GET_OVERLAYS, {
      success: true,
      data: overlayService.getOverlays(),
    });
    e.reply(APP_EVENTS_RESPONSE.INSTALL_OVERLAY, { success: true, id });
    if (updating) {
      notifier.success(
        "overlays",
        FEEDBACK_CODES.OVERLAY_UPDATED,
        "Overlay updated. Refresh it in your streaming app to load the new version.",
      );
    } else {
      notifier.success(
        "overlays",
        FEEDBACK_CODES.OVERLAY_INSTALLED,
        "Overlay installed.",
      );
    }
  },
  {
    failure: {
      code: FEEDBACK_CODES.OVERLAY_INSTALL_FAILED,
      message: "Unable to install the overlay.",
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
      message: "Unable to load the overlays.",
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.GET_OVERLAYS),
  },
);

events.push(
  APP_EVENTS.GET_OVERLAY_CONFIG,
  async ({ overlayService }, e, { id }) => {
    const res = await overlayService.getConfig(id);
    if (!res.success) throw new Error(`Unable to read overlay ${id}.`);
    e.reply(APP_EVENTS_RESPONSE.GET_OVERLAY_CONFIG, res);
  },
  {
    failure: {
      code: FEEDBACK_CODES.OVERLAY_CONFIG_FAILED,
      message: "Unable to load the overlay's settings.",
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.GET_OVERLAY_CONFIG),
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
      message: "Unable to load the gifts.",
    },
    onError: (e) => e.reply(APP_EVENTS_RESPONSE.GET_GIFTS, { data: [] }),
  },
);

events.push(
  APP_EVENTS.SAVE_OVERLAY_CONFIG,
  async ({ overlayService, notifier }, e, { config, gifts, id }) => {
    const res = await overlayService.saveConfig(id, config, gifts);
    if (!res.success) throw new Error(`Unable to save overlay ${id}.`);
    e.reply(APP_EVENTS_RESPONSE.SAVE_OVERLAY_CONFIG, {
      success: true,
      data: res.data,
      id,
    });
    notifier.success(
      "overlays",
      FEEDBACK_CODES.OVERLAY_SAVED,
      "Overlay settings saved.",
    );
  },
  {
    failure: {
      code: FEEDBACK_CODES.OVERLAY_SAVE_FAILED,
      message: "Unable to save the overlay's settings.",
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.SAVE_OVERLAY_CONFIG),
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
      message: "Unable to send the data to the overlay.",
    },
  },
);

events.push(
  APP_EVENTS.TEST_OVERLAY,
  async ({ overlayService }, e, { id }) => {
    e.reply(APP_EVENTS_RESPONSE.TEST_OVERLAY, {
      payloads: overlayService.getTestPayloads(),
      id,
    });
  },
  {
    failure: {
      code: FEEDBACK_CODES.TEST_OVERLAY_FAILED,
      message: "Unable to test the overlay.",
    },
    onError: (e, _, { id }) =>
      e.reply(APP_EVENTS_RESPONSE.TEST_OVERLAY, { payloads: [], id }),
  },
);

export default events;
