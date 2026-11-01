import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  FEEDBACK_CODES,
} from "@/common/types";
import { createStack } from "@/helper/events";
import { AppFailure } from "@/helper/feedback";
import { t } from "@/helper/i18n";

const events = createStack("system");

events.push(
  APP_EVENTS.GET_LIVES,
  ({ historyService }, e) => {
    e.reply(APP_EVENTS_RESPONSE.LIVES, { data: historyService.getHistory() });
  },
  { notify: false },
);

events.push(
  APP_EVENTS.GET_LIVE,
  async ({ historyService }, e, { startedAt }) => {
    const data = await historyService.getLive(startedAt);
    if (!data) {
      throw new AppFailure(
        FEEDBACK_CODES.LIVE_LOAD_FAILED,
        t("main.lives.loadFailed"),
        { level: "warning" },
      );
    }
    e.reply(APP_EVENTS_RESPONSE.LIVE, { success: true, startedAt, data });
  },
  {
    failure: {
      code: FEEDBACK_CODES.LIVE_LOAD_FAILED,
      message: "main.failure.getLive",
    },
    // So the page ignores a late failure for another LIVE
    onError: (e, error, { startedAt }) =>
      e.reply(APP_EVENTS_RESPONSE.LIVE, { success: false, startedAt, error }),
  },
);

// The page's totals for the dates it filters by
events.push(
  APP_EVENTS.GET_GIFTERS,
  async ({ historyService }, e, { from, to }) => {
    const data = await historyService.getGifters({ from, to });
    e.reply(APP_EVENTS_RESPONSE.GIFTERS, { success: true, from, to, data });
  },
  {
    failure: {
      code: FEEDBACK_CODES.LIVE_LOAD_FAILED,
      message: "main.failure.getGifters",
    },
    // So the page ignores a late failure for other dates
    onError: (e, error, { from, to }) =>
      e.reply(APP_EVENTS_RESPONSE.GIFTERS, {
        success: false,
        from,
        to,
        error,
      }),
  },
);

// Both reply what main holds, failures included: a LIVE deleted from memory
// stays deleted, and the next save tries again.
events.push(
  APP_EVENTS.DELETE_LIVE,
  async ({ historyService, notifier }, e, { startedAt }) => {
    const saved = await historyService.deleteLive(startedAt);
    e.reply(APP_EVENTS_RESPONSE.LIVES, { data: historyService.getHistory() });
    if (!saved) {
      throw new AppFailure(
        FEEDBACK_CODES.HISTORY_SAVE_FAILED,
        t("main.lives.saveFailed"),
        { logged: true },
      );
    }
    notifier.success(
      "system",
      FEEDBACK_CODES.LIVE_DELETED,
      t("main.lives.deleted"),
    );
  },
  {
    failure: {
      code: FEEDBACK_CODES.HISTORY_SAVE_FAILED,
      message: "main.failure.deleteLive",
    },
  },
);

events.push(
  APP_EVENTS.CLEAR_LIVES,
  async ({ historyService, notifier }, e) => {
    const cleared = await historyService.clear();
    e.reply(APP_EVENTS_RESPONSE.LIVES, { data: historyService.getHistory() });
    if (!cleared) {
      throw new AppFailure(
        FEEDBACK_CODES.HISTORY_CLEAR_FAILED,
        t("main.lives.clearFailed"),
        { logged: true },
      );
    }
    notifier.success(
      "system",
      FEEDBACK_CODES.HISTORY_CLEARED,
      t("main.lives.cleared"),
    );
  },
  {
    failure: {
      code: FEEDBACK_CODES.HISTORY_CLEAR_FAILED,
      message: "main.failure.clearLives",
    },
  },
);

export default events;
