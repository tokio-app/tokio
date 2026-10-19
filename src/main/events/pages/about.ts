import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  FEEDBACK_CODES,
} from "@/common/types";
import { createStack, replyFailure } from "@/helper/events";
import { LoggedError } from "@/helper/feedback";

const events = createStack("system");

events.push(
  APP_EVENTS.GET_ABOUT,
  async ({ licensesService }, e) => {
    const res = await licensesService.getPackages();
    if (!res.success || !res.data) throw new LoggedError(res.error);

    e.reply(APP_EVENTS_RESPONSE.GET_ABOUT, {
      success: true,
      data: {
        versions: {
          electron: process.versions.electron,
          chrome: process.versions.chrome,
          node: process.versions.node,
        },
        packages: res.data,
        documents: licensesService.getDocuments(),
      },
    });
  },
  {
    failure: {
      code: FEEDBACK_CODES.ABOUT_LOAD_FAILED,
      message: "Unable to load the open-source licenses.",
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.GET_ABOUT),
  },
);

events.push(
  APP_EVENTS.GET_LICENSE_TEXT,
  async ({ licensesService }, e, { id }) => {
    const res = await licensesService.getText(id);
    if (!res.success || !res.data) throw new LoggedError(res.error);

    e.reply(APP_EVENTS_RESPONSE.GET_LICENSE_TEXT, {
      success: true,
      id,
      data: res.data,
    });
  },
  {
    failure: {
      code: FEEDBACK_CODES.LICENSE_LOAD_FAILED,
      message: "Unable to read the license.",
    },
    onError: (e, error, { id }) =>
      e.reply(APP_EVENTS_RESPONSE.GET_LICENSE_TEXT, {
        success: false,
        id,
        error,
      }),
  },
);

export default events;
