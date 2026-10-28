import { TIMER_ACTIONS } from "@/common/schemas";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  FEEDBACK_CODES,
} from "@/common/types";
import { createStack, replyFailure } from "@/helper/events";
import { saveFailure } from "@/helper/feedback";
import { t } from "@/helper/i18n";
import type { TimerService } from "@/services/timer";
import { z } from "zod";

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
      message: "main.failure.getTestOverlays",
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
      t("main.tools.testOverlayAdded", { name: name.trim() }),
    );
  },
  {
    failure: {
      code: FEEDBACK_CODES.TEST_OVERLAY_FAILED,
      message: "main.failure.addTestOverlay",
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
      t("main.tools.testOverlayRemoved"),
    );
  },
  {
    failure: {
      code: FEEDBACK_CODES.TEST_OVERLAY_FAILED,
      message: "main.failure.removeTestOverlay",
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
      message: "main.failure.sendTestEvents",
    },
    onError: (e, error, { id }) =>
      e.reply(APP_EVENTS_RESPONSE.SEND_TEST_EVENTS, {
        id,
        success: false,
        error,
      }),
  },
);

// The countdown timer's requests are answered by its TIMER push (see
// registerTimer in init.ts). No success notices: the settings autosave, and
// the page shows the state. The service logs to the system log.
const timerOptions = {
  source: "system",
  failure: {
    code: FEEDBACK_CODES.TIMER_FAILED,
    message: "main.failure.timer",
  },
  onError: replyFailure(APP_EVENTS_RESPONSE.TIMER),
} as const;

const saveTimer = async (timer: TimerService) => {
  if (!(await timer.save())) throw saveFailure();
};

events.push(
  APP_EVENTS.GET_TIMER,
  async ({ timerService }, e) => {
    e.reply(APP_EVENTS_RESPONSE.TIMER, {
      success: true,
      data: { ...timerService.get(), added: 0 },
    });
  },
  {
    ...timerOptions,
    failure: {
      code: FEEDBACK_CODES.TIMER_FAILED,
      message: "main.failure.getTimer",
    },
  },
);

events.push(
  APP_EVENTS.SET_TIMER_SETTINGS,
  async ({ timerService }, _e, { settings }) => {
    timerService.setSettings(settings);
    await saveTimer(timerService);
  },
  timerOptions,
);

events.push(
  APP_EVENTS.TIMER_CONTROL,
  async ({ timerService }, _e, data) => {
    timerService.control(z.enum(TIMER_ACTIONS).parse(data.action));
    await saveTimer(timerService);
  },
  timerOptions,
);

events.push(
  APP_EVENTS.ADJUST_TIMER,
  async ({ timerService }, _e, data) => {
    // Zod's numbers are finite
    const seconds = z
      .number()
      .refine((s) => s !== 0)
      .parse(data.seconds);
    timerService.adjust(seconds * 1000);
    await saveTimer(timerService);
  },
  timerOptions,
);

export default events;
