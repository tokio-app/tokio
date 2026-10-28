import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  FEEDBACK_CODES,
} from "@/common/types";
import { createStack, replyFailure } from "@/helper/events";
import { AppFailure } from "@/helper/feedback";
import { t } from "@/helper/i18n";

const events = createStack("system");

events.push(
  APP_EVENTS.GET_UPDATE_STATUS,
  ({ updaterService }, e) => {
    e.reply(APP_EVENTS_RESPONSE.UPDATE_STATUS, updaterService.getStatus());
  },
  { notify: false },
);

// The status that follows is pushed with UPDATE_STATUS.
events.push(
  APP_EVENTS.CHECK_UPDATES,
  async ({ updaterService }, e) => {
    const res = await updaterService.check();
    if (!res.success) {
      throw new AppFailure(
        FEEDBACK_CODES.UPDATE_CHECK_FAILED,
        t("main.updates.checkFailed"),
        { level: "warning", logged: true, cause: res.error },
      );
    }
    e.reply(APP_EVENTS_RESPONSE.CHECK_UPDATES, { success: true });
  },
  {
    // About shows the failure
    notify: false,
    failure: {
      code: FEEDBACK_CODES.UPDATE_CHECK_FAILED,
      message: "main.failure.checkUpdates",
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.CHECK_UPDATES),
  },
);

events.push(
  APP_EVENTS.INSTALL_UPDATE,
  async ({ updaterService, shell }) => {
    const res = updaterService.install();
    if (!res.success) {
      throw new AppFailure(
        FEEDBACK_CODES.UPDATE_INSTALL_FAILED,
        t("main.updates.notReady"),
        { level: "warning", cause: res.error },
      );
    }
    if (res.data) await shell.openExternal(res.data.url);
  },
  {
    failure: {
      code: FEEDBACK_CODES.UPDATE_INSTALL_FAILED,
      message: "main.failure.installUpdate",
    },
  },
);

export default events;
