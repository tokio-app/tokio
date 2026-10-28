import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  FEEDBACK_CODES,
} from "@/common/types";
import { createStack, replyFailure } from "@/helper/events";
import { AppFailure, LoggedError } from "@/helper/feedback";
import { t } from "@/helper/i18n";

const events = createStack("tts");

events.push(
  APP_EVENTS.GET_VOICES,
  async ({ ttsService }, e) => {
    const voices = await ttsService.getVoices();
    e.reply(APP_EVENTS_RESPONSE.GET_VOICES, {
      voices,
      engines: ttsService.getEngines(),
      success: true,
    });
  },
  {
    failure: {
      code: FEEDBACK_CODES.TTS_VOICES_FAILED,
      message: "main.failure.getVoices",
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.GET_VOICES),
  },
);

events.push(
  APP_EVENTS.UPDATE_TTS_SETTINGS,
  async ({ storeManagerService }, e, { settings }) => {
    const res = await storeManagerService.updateProfileData({
      tts: settings,
    });
    // The store logged why
    if (!res) throw new LoggedError("The TTS settings were not saved.");
    e.reply(APP_EVENTS_RESPONSE.UPDATE_TTS_SETTINGS, {
      success: true,
    });
  },
  {
    source: "system",
    failure: {
      code: FEEDBACK_CODES.PROFILE_SAVE_FAILED,
      message: "main.failure.updateTtsSettings",
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.UPDATE_TTS_SETTINGS),
  },
);

events.push(
  APP_EVENTS.GET_TTS_TEST,
  async ({ ttsService }, e, { id, text, voice, settings }) => {
    // The tester's message is read like chat, previews say their line as is.
    const spoken = settings ? ttsService.prepareText(text, settings) : text;
    if (spoken === null) {
      throw new AppFailure(
        FEEDBACK_CODES.TTS_TEST_BLOCKED,
        t("main.tts.testBlocked"),
        { level: "warning" },
      );
    }
    const res = await ttsService.generateBuffer(spoken, voice);
    if (!res.success || !res.buffer) {
      throw res.error ?? new Error("The engine returned no audio.");
    }
    e.reply(APP_EVENTS_RESPONSE.GET_TTS_TEST, {
      id,
      data: new Uint8Array(res.buffer),
      success: true,
    });
  },
  {
    failure: {
      code: FEEDBACK_CODES.TTS_GENERATION_FAILED,
      message: "main.failure.getTtsTest",
    },
    onError: (e, error, { id }) =>
      e.reply(APP_EVENTS_RESPONSE.GET_TTS_TEST, {
        success: false,
        id,
        error,
      }),
  },
);

events.push(
  APP_EVENTS.TTS_PLAYED,
  ({ ttsService }, _, { id }) => {
    ttsService.played(id);
  },
  { notify: false },
);

export default events;
