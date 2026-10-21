import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  FEEDBACK_CODES,
  TOKIO_EVENTS,
  TokioEventMap,
} from "@/common/types";
import { createStack } from "@/helper/events";
import { AppFailure, saveFailure } from "@/helper/feedback";
import { ConnectorFailure } from "@/services/connector/common";

const events = createStack("connector");

// What to tell the user about a connect that failed, by what went wrong.
const connectMessage = (handle: string, error?: ConnectorFailure) => {
  switch (error?.kind) {
    case "offline":
      return `${handle} isn't LIVE right now. Connect once the LIVE has started.`;
    case "notFound":
      return `Couldn't find ${handle} on TikTok. Check the username.`;
    case "rateLimited": {
      const wait = error.retryAfterSeconds;
      return `Your Euler Stream API key hit its rate limit. Try again in ${wait ? `${wait} seconds` : "a minute"}.`;
    }
    case "noKey":
      return "Tokio needs your Euler Stream API key to connect. Add it in Settings.";
    case "badKey":
      return "Euler Stream didn't accept your API key. Check it in Settings.";
    case "sign":
      return "Euler Stream couldn't sign the connection. Try again in a moment.";
    case "network":
      return "Unable to reach TikTok. Check your internet connection.";
    default:
      return `Unable to connect to ${handle}. Try again in a moment.`;
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
    const handle = `@${username.replace("@", "")}`;
    await storeManagerService.updateProfileData({
      connector: {
        username,
      },
    });
    const stats = storeManagerService.getSettings().liveStats;

    // The connected event comes before connect() resolves, answer on the first.
    let answered = false;
    const answer = () => {
      if (answered) return;
      answered = true;
      e.reply(APP_EVENTS_RESPONSE.CONNECTED, {
        success: true,
        stats,
      });
      notifier.success(
        "connector",
        FEEDBACK_CODES.CONNECTED,
        `Connected to ${handle}.`,
      );
    };
    // Answers this connect only, so connects don't pile up listeners.
    const onConnected = (d: TokioEventMap[TOKIO_EVENTS.CONNECTED]) => {
      if (d.success) answer();
    };
    connectorService.on(TOKIO_EVENTS.CONNECTED, onConnected);

    try {
      const res = await connectorService.connect(username);
      if (!res.success) {
        throw new AppFailure(
          FEEDBACK_CODES.CONNECT_FAILED,
          connectMessage(handle, res.error),
          { logged: true },
        );
      }
      answer();
    } finally {
      connectorService.off(TOKIO_EVENTS.CONNECTED, onConnected);
    }
  },
  {
    failure: {
      code: FEEDBACK_CODES.CONNECT_FAILED,
      message: "Unable to connect to the LIVE.",
    },
    onError: (e, error) =>
      e.reply(APP_EVENTS_RESPONSE.CONNECTED, {
        success: false,
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
      stats: EMPTY_STATS,
    });
  },
  {
    failure: {
      code: FEEDBACK_CODES.DISCONNECT_FAILED,
      message: "Unable to disconnect from the LIVE.",
    },
    onError: (e, error) =>
      e.reply(APP_EVENTS_RESPONSE.CONNECTED, {
        success: false,
        stats: EMPTY_STATS,
        error,
      }),
  },
);

events.push(
  APP_EVENTS.IS_CONNECTED,
  async ({ connectorService, storeManagerService }, e) => {
    e.reply(APP_EVENTS_RESPONSE.CONNECTED, {
      stats: storeManagerService.getSettings().liveStats,
      success: connectorService.isConnected(),
    });
  },
  {
    notify: false,
    onError: (e, error) =>
      e.reply(APP_EVENTS_RESPONSE.CONNECTED, {
        success: false,
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
      "Activity feed updated.",
    );
  },
  {
    source: "system",
    failure: {
      code: FEEDBACK_CODES.SETTINGS_SAVE_FAILED,
      message: "Unable to save the activity feed.",
    },
  },
);

events.push(
  APP_EVENTS.ACTIVE_FEATURES,
  // No notice on success, the switches already show the new state.
  async ({ storeManagerService, ttsService, alertsService, win }, _, data) => {
    const saved = await storeManagerService.updateActiveFeatures({
      ...data,
    });
    if (data.tts === false) {
      ttsService.clearTalk();
      win.webContents.send(APP_EVENTS_RESPONSE.TTS_CLEAR, undefined);
    }
    if (data.alerts === false) {
      alertsService.clearSpeech();
      win.webContents.send(APP_EVENTS_RESPONSE.ALERT_CLEAR, undefined);
    }
    if (!saved) throw saveFailure();
  },
  {
    source: "system",
    failure: {
      code: FEEDBACK_CODES.FEATURES_UPDATE_FAILED,
      message: "Unable to change the active features.",
    },
  },
);

export default events;
