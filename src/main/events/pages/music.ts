import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  FEEDBACK_CODES,
  TOKIO_EVENTS,
} from "@/common/types";
import { createStack, replyFailure } from "@/helper/events";
import { AppFailure, LoggedError } from "@/helper/feedback";
import { t } from "@/helper/i18n";

const events = createStack("music");

// The listener of the last connect, replaced on every connect.
let onMusicEnded: (() => void) | null = null;
// Counts connects, so the result of one a newer connect replaced is dropped.
let attempt = 0;

events.push(
  APP_EVENTS.UPDATE_MUSIC_SETTINGS,
  async ({ storeManagerService }, e, { settings }) => {
    const res = await storeManagerService.updateProfileData({
      music: settings,
    });
    if (!res) throw new LoggedError("The music settings were not saved.");
    e.reply(APP_EVENTS_RESPONSE.UPDATE_MUSIC_SETTINGS, {
      success: true,
    });
  },
  {
    source: "system",
    failure: {
      code: FEEDBACK_CODES.PROFILE_SAVE_FAILED,
      message: "main.failure.updateMusicSettings",
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.UPDATE_MUSIC_SETTINGS),
  },
);

events.push(
  APP_EVENTS.CONNECT_MUSIC,
  async ({ musicService, notifier }, e, { name, key }) => {
    const current = ++attempt;
    if (onMusicEnded) {
      musicService.off(TOKIO_EVENTS.MUSIC_PROCCESS_ENDED, onMusicEnded);
    }

    // Ends the session, or a login the last connect left open.
    musicService.disconnect();

    musicService.setProvider(name, key);

    // Ends on a disconnect and when the provider's window is closed.
    let connected = false;
    onMusicEnded = () => {
      musicService.clearHandler();
      e.reply(APP_EVENTS_RESPONSE.MUSIC_CONNECTED, {
        success: false,
      });
      if (!connected) return;
      connected = false;
      notifier.info(
        "music",
        FEEDBACK_CODES.MUSIC_DISCONNECTED,
        t("main.music.disconnected", { name }),
      );
    };
    musicService.on(TOKIO_EVENTS.MUSIC_PROCCESS_ENDED, onMusicEnded);

    const res = await musicService.connect();
    if (current !== attempt) return;
    if (!res.success) {
      throw new AppFailure(
        FEEDBACK_CODES.MUSIC_CONNECT_FAILED,
        t("main.music.connectFailed", { name }),
        { cause: res.error },
      );
    }

    connected = true;
    e.reply(APP_EVENTS_RESPONSE.MUSIC_CONNECTED, {
      success: true,
    });
    notifier.success(
      "music",
      FEEDBACK_CODES.MUSIC_CONNECTED,
      t("main.music.connected", { name }),
    );
  },
  {
    failure: {
      code: FEEDBACK_CODES.MUSIC_CONNECT_FAILED,
      message: "main.failure.connectMusic",
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.MUSIC_CONNECTED),
  },
);

events.push(
  APP_EVENTS.IS_MUSIC_CONNECTED,
  ({ musicService }, e) => {
    e.reply(APP_EVENTS_RESPONSE.MUSIC_CONNECTED, {
      success: musicService.isActive(),
    });
  },
  {
    notify: false,
    onError: replyFailure(APP_EVENTS_RESPONSE.MUSIC_CONNECTED),
  },
);

events.push(
  APP_EVENTS.DISCONNECT_MUSIC,
  ({ musicService }, e) => {
    musicService.disconnect();
    e.reply(APP_EVENTS_RESPONSE.MUSIC_CONNECTED, {
      success: false,
    });
  },
  {
    failure: {
      code: FEEDBACK_CODES.MUSIC_DISCONNECT_FAILED,
      message: "main.failure.disconnectMusic",
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.MUSIC_CONNECTED),
  },
);

export default events;
