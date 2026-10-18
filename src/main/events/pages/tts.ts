import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  FEEDBACK_CODES,
} from "@/common/types";
import { createStack, replyFailure } from "@/helper/events";

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
      message: "Unable to load the voices.",
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.GET_VOICES),
  },
);

events.push(
  APP_EVENTS.UPDATE_TTS_SETTINGS,
  async ({ storeManagerService, notifier }, e, { settings }) => {
    const res = await storeManagerService.updateProfileData({
      tts: settings,
    });
    if (!res) throw new Error("The TTS settings were not saved.");
    e.reply(APP_EVENTS_RESPONSE.UPDATE_TTS_SETTINGS, {
      success: true,
    });
    notifier.success(
      "system",
      FEEDBACK_CODES.PROFILE_SAVED,
      "TTS settings saved.",
    );
  },
  {
    source: "system",
    failure: {
      code: FEEDBACK_CODES.PROFILE_SAVE_FAILED,
      message: "Unable to save the TTS settings.",
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.UPDATE_TTS_SETTINGS),
  },
);

events.push(
  APP_EVENTS.GET_TTS_TEST,
  async ({ ttsService }, e, { id, text, voice }) => {
    const res = await ttsService.generateBuffer(text, voice);
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
      message: "Unable to generate the test audio. Try another voice.",
    },
    onError: (e, error, { id }) =>
      e.reply(APP_EVENTS_RESPONSE.GET_TTS_TEST, {
        success: false,
        id,
        error,
      }),
  },
);

export default events;
