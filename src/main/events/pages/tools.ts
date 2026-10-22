import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  FEEDBACK_CODES,
} from "@/common/types";
import { createStack, replyFailure } from "@/helper/events";
import { saveFailure } from "@/helper/feedback";

const events = createStack("overlays");

events.push(
  APP_EVENTS.GET_TEST_OVERLAYS,
  async ({ overlayService }, e) => {
    e.reply(APP_EVENTS_RESPONSE.GET_TEST_OVERLAYS, {
      success: true,
      data: overlayService.getTestOverlays(),
    });
  },
  {
    failure: {
      code: FEEDBACK_CODES.OVERLAYS_LOAD_FAILED,
      message: "Unable to load the test overlays.",
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.GET_TEST_OVERLAYS),
  },
);

events.push(
  APP_EVENTS.ADD_TEST_OVERLAY,
  async ({ overlayService, notifier }, e, { name }) => {
    const res = await overlayService.createTestOverlay(name);
    if (!res.success) throw new Error(`Test overlay "${name}" was not added.`);
    e.reply(APP_EVENTS_RESPONSE.GET_TEST_OVERLAYS, {
      success: true,
      data: res.data,
    });
    // The page ignores the failure reply, so it keeps the list sent above.
    if (res.saved === false) throw saveFailure();
    notifier.success(
      "overlays",
      FEEDBACK_CODES.TEST_OVERLAY_ADDED,
      `Test overlay "${name.trim()}" added.`,
    );
  },
  {
    failure: {
      code: FEEDBACK_CODES.TEST_OVERLAY_FAILED,
      message: "Unable to add the test overlay.",
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.GET_TEST_OVERLAYS),
  },
);

events.push(
  APP_EVENTS.REMOVE_TEST_OVERLAY,
  async ({ overlayService, notifier }, e, { id }) => {
    const res = await overlayService.removeTestOverlay(id);
    e.reply(APP_EVENTS_RESPONSE.GET_TEST_OVERLAYS, {
      success: true,
      data: res.data,
    });
    if (res.saved === false) throw saveFailure();
    notifier.success(
      "overlays",
      FEEDBACK_CODES.TEST_OVERLAY_REMOVED,
      "Test overlay removed.",
    );
  },
  {
    failure: {
      code: FEEDBACK_CODES.TEST_OVERLAY_FAILED,
      message: "Unable to remove the test overlay.",
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.GET_TEST_OVERLAYS),
  },
);

// No connected overlay isn't a failure, the page shows it.
events.push(
  APP_EVENTS.SEND_TEST_EVENTS,
  async ({ overlayService }, e, { id }) => {
    e.reply(APP_EVENTS_RESPONSE.SEND_TEST_EVENTS, {
      id,
      success: overlayService.sendTestEvents(id).success,
    });
  },
  {
    notify: false,
    failure: {
      code: FEEDBACK_CODES.TEST_OVERLAY_FAILED,
      message: "Unable to send the test events.",
    },
    onError: (e, error, { id }) =>
      e.reply(APP_EVENTS_RESPONSE.SEND_TEST_EVENTS, {
        id,
        success: false,
        error,
      }),
  },
);

export default events;
