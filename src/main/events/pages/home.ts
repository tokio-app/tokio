import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  FEEDBACK_CODES,
  TOKIO_EVENTS,
} from "@/common/types";
import { createStack } from "@/helper/events";
import { AppFailure, saveFailure } from "@/helper/feedback";
import { t } from "@/helper/i18n";
import { ConnectorFailure } from "@/services/connector/common";

const events = createStack("connector");

// What to tell the user about a connect that failed, by what went wrong.
const connectMessage = (handle: string, error?: ConnectorFailure) => {
  const settings = t("nav.settings");
  switch (error?.kind) {
    case "offline":
      return t("main.home.connect.offline", { handle });
    case "notFound":
      return t("main.home.connect.notFound", { handle });
    case "rateLimited": {
      const wait = error.retryAfterSeconds;
      return wait
        ? t("main.home.connect.rateLimited", { count: wait })
        : t("main.home.connect.rateLimitedMinute");
    }
    case "noKey":
      return t("main.home.connect.noKey", { settings });
    case "badKey":
      return t("main.home.connect.badKey", { settings });
    case "premium":
      return t("main.home.connect.premium");
    case "sign":
      return t("main.home.connect.sign");
    case "network":
      return t("main.home.connect.network");
    default:
      return t("main.home.connect.failed", { handle });
  }
};

const EMPTY_STATS = {
  likes: 0,
  viewers: 0,
  views: 0,
};

events.push(
  APP_EVENTS.CONNECT,
  async (
    { storeManagerService, connectorService, notifier },
    e,
    { username },
  ) => {
    const name = username.trim().replace(/^@/, "");
    const handle = `@${name}`;
    const saved = await storeManagerService.updateProfileData({
      connector: {
        username: name,
      },
    });
    // The LIVE matters more than remembering the username: connect anyway.
    if (!saved) {
      notifier.warn(
        "connector",
        FEEDBACK_CODES.SETTINGS_SAVE_FAILED,
        t("main.home.usernameSaveFailed"),
      );
    }
    const stats = storeManagerService.getSettings().liveStats;

    // The connected event comes before connect() resolves, answer on the first.
    let answered = false;
    const answer = () => {
      if (answered) return;
      answered = true;
      e.reply(APP_EVENTS_RESPONSE.CONNECTED, {
        success: true,
        live: true,
        stats,
      });
      notifier.success(
        "connector",
        FEEDBACK_CODES.CONNECTED,
        t("main.home.connected", { handle }),
      );
    };
    // Answers this connect only, so connects don't pile up listeners.
    connectorService.on(TOKIO_EVENTS.CONNECTED, answer);

    try {
      const res = await connectorService.connect(name);
      if (!res.success) {
        throw new AppFailure(
          FEEDBACK_CODES.CONNECT_FAILED,
          connectMessage(handle, res.error),
          { logged: true },
        );
      }
      answer();
    } finally {
      connectorService.off(TOKIO_EVENTS.CONNECTED, answer);
    }
  },
  {
    failure: {
      code: FEEDBACK_CODES.CONNECT_FAILED,
      message: "main.failure.connect",
    },
    onError: (e, error) =>
      e.reply(APP_EVENTS_RESPONSE.CONNECTED, {
        success: false,
        live: false,
        stats: EMPTY_STATS,
        error,
      }),
  },
);

events.push(
  APP_EVENTS.DISCONNECT,
  async ({ connectorService }, e) => {
    await connectorService.disconnect();
    e.reply(APP_EVENTS_RESPONSE.CONNECTED, {
      success: false,
      live: false,
      stats: EMPTY_STATS,
    });
  },
  {
    failure: {
      code: FEEDBACK_CODES.DISCONNECT_FAILED,
      message: "main.failure.disconnect",
    },
    onError: (e, error) =>
      e.reply(APP_EVENTS_RESPONSE.CONNECTED, {
        success: false,
        live: false,
        stats: EMPTY_STATS,
        error,
      }),
  },
);

events.push(
  APP_EVENTS.IS_CONNECTED,
  async ({ connectorService, liveService, storeManagerService }, e) => {
    e.reply(APP_EVENTS_RESPONSE.CONNECTED, {
      stats: storeManagerService.getSettings().liveStats,
      // True while connecting too, which locks the profile
      success: connectorService.isConnected(),
      // A connect still in progress hasn't started the session
      live: liveService.getSession().startedAt !== null,
    });
  },
  {
    notify: false,
    onError: (e, error) =>
      e.reply(APP_EVENTS_RESPONSE.CONNECTED, {
        success: false,
        live: false,
        stats: EMPTY_STATS,
        error,
      }),
  },
);

// Also pushed from init as the LIVE goes on
events.push(
  APP_EVENTS.GET_LIVE_SESSION,
  ({ liveService }, e) => {
    e.reply(APP_EVENTS_RESPONSE.LIVE_SESSION, {
      data: liveService.getSession(),
    });
  },
  { notify: false },
);

events.push(
  APP_EVENTS.SET_ACTIVITY_FEED,
  async ({ storeManagerService, liveService, notifier }, e, { feed }) => {
    const saved = await storeManagerService.updateActivityFeed(feed);
    liveService.setFeed(feed);
    e.reply(APP_EVENTS_RESPONSE.LIVE_SESSION, {
      data: liveService.getSession(),
    });
    if (!saved) throw saveFailure();
    notifier.success(
      "system",
      FEEDBACK_CODES.ACTIVITY_FEED_UPDATED,
      t("main.home.activityFeedUpdated"),
    );
  },
  {
    source: "system",
    failure: {
      code: FEEDBACK_CODES.SETTINGS_SAVE_FAILED,
      message: "main.failure.setActivityFeed",
    },
  },
);

events.push(
  APP_EVENTS.ACTIVE_FEATURES,
  // No notice on success, the switches already show the new state.
  async (
    { storeManagerService, ttsService, alertsService, musicService, win },
    _,
    data,
  ) => {
    const saved = await storeManagerService.updateActiveFeatures({
      ...data,
    });
    if (data.tts === false) {
      ttsService.clearTalk();
      win.webContents.send(APP_EVENTS_RESPONSE.TTS_CLEAR, undefined);
    }
    if (data.alerts === false) {
      alertsService.clear();
      win.webContents.send(APP_EVENTS_RESPONSE.ALERT_CLEAR, undefined);
    }
    if (data.music === false) musicService.clearHandler();
    if (!saved) throw saveFailure();
  },
  {
    source: "system",
    failure: {
      code: FEEDBACK_CODES.FEATURES_UPDATE_FAILED,
      message: "main.failure.activeFeatures",
    },
  },
);

export default events;
