import { listOf } from "@/common/i18n";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  FEEDBACK_CODES,
  VoiceSample,
} from "@/common/types";
import {
  formatError,
  formatSeconds,
  VOICE_NAME_MAX,
  VOICE_SAMPLE_MAX_BYTES,
  VOICE_SAMPLE_TYPES,
  VOICE_SAMPLES_MAX,
} from "@/common/util";
import { showOpenDialog } from "@/helper/dialog";
import { createStack, replyFailure } from "@/helper/events";
import { AppFailure, LoggedError, REPEAT_NOTICE_MS } from "@/helper/feedback";
import { language, t } from "@/helper/i18n";
import Logger from "@/logger";
import { failureKey, TTSRequestError } from "@/services/tts/common";
import { systemPreferences } from "electron";
import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { z } from "zod";

const events = createStack("tts");

const SAMPLE_MAX_SIZE = `${VOICE_SAMPLE_MAX_BYTES / 1024 / 1024} MB`;

const isSampleName = (name: string) =>
  Object.hasOwn(VOICE_SAMPLE_TYPES, extname(name).slice(1).toLowerCase());

// The window sends it, so main checks what it uploads
const CloneSchema = z.object({
  id: z.string(),
  engine: z.string(),
  name: z.string().trim().min(1).max(VOICE_NAME_MAX),
  samples: z
    .array(
      z.object({
        name: z.string().refine(isSampleName),
        data: z
          .instanceof(Uint8Array)
          .refine((d) => d.length >= 1 && d.length <= VOICE_SAMPLE_MAX_BYTES),
      }),
    )
    .min(1)
    .max(VOICE_SAMPLES_MAX),
});

events.push(
  APP_EVENTS.GET_VOICES,
  async ({ ttsService, storeManagerService, notifier }, e) => {
    const failed = new Map<string, unknown>();
    const voices = await ttsService.getVoices((engine, error) =>
      failed.set(engine, error),
    );
    const engines = ttsService.getEngines();
    e.reply(APP_EVENTS_RESPONSE.GET_VOICES, {
      voices,
      engines,
      success: true,
    });
    for (const [id, error] of failed) {
      const engine = engines.find((v) => v.id === id);
      // Engines without a key fail quietly as before, so only a saved key warns
      if (!engine?.keyLabel || !storeManagerService.getVoiceKey(id)) {
        ttsService.logVoicesFailure(id, error);
        continue;
      }
      // Logged once per notice, as every voice picker lists the voices
      const shown = notifier.warn(
        "tts",
        FEEDBACK_CODES.TTS_VOICES_FAILED,
        t(failureKey(error) ?? "main.tts.voicesFailed", {
          engine: engine.label,
          settings: t("nav.settings"),
        }),
        { key: `tts:voices:${id}`, windowMs: REPEAT_NOTICE_MS },
      );
      if (shown) ttsService.logVoicesFailure(id, error);
    }
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
      // Says why, like no credits left, where the engine told
      const key = failureKey(res.error);
      if (key && res.error instanceof TTSRequestError) {
        throw new AppFailure(
          FEEDBACK_CODES.TTS_GENERATION_FAILED,
          t(key, { engine: res.error.engine, settings: t("nav.settings") }),
          { cause: res.error },
        );
      }
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

// Files that are empty, too big or unreadable are left out, with one warning.
events.push(
  APP_EVENTS.PICK_VOICE_SAMPLES,
  async ({ win, notifier, pathManagerService }, e) => {
    const res = await showOpenDialog(win, {
      title: t("main.dialog.selectVoiceSamples"),
      properties: ["openFile", "multiSelections"],
      filters: [
        {
          name: t("main.dialog.audio"),
          extensions: Object.keys(VOICE_SAMPLE_TYPES),
        },
      ],
    });
    if (res.canceled) return;

    const samples: VoiceSample[] = [];
    const skipped: string[] = [];
    for (const path of res.filePaths) {
      const name = basename(path);
      try {
        const { size } = await stat(path);
        if (size === 0 || size > VOICE_SAMPLE_MAX_BYTES) {
          skipped.push(name);
          continue;
        }
        samples.push({ name, data: new Uint8Array(await readFile(path)) });
      } catch (error) {
        Logger.warn(
          `<TTS> Unable to read a voice sample - ${formatError(error)}`,
          pathManagerService.files.logs.tts,
        );
        skipped.push(name);
      }
    }

    e.reply(APP_EVENTS_RESPONSE.PICK_VOICE_SAMPLES, {
      success: true,
      samples,
    });
    if (skipped.length > 0) {
      notifier.warn(
        "tts",
        FEEDBACK_CODES.VOICE_SAMPLE_FAILED,
        t("main.tts.samplesSkipped", {
          count: skipped.length,
          files: listOf(language(), skipped, { max: 3 }),
          size: SAMPLE_MAX_SIZE,
        }),
      );
    }
  },
  {
    failure: {
      code: FEEDBACK_CODES.VOICE_SAMPLE_FAILED,
      message: "main.failure.pickVoiceSamples",
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.PICK_VOICE_SAMPLES),
  },
);

events.push(
  APP_EVENTS.CLONE_VOICE,
  async ({ ttsService, notifier }, e, data) => {
    const { id, engine, name, samples } = CloneSchema.parse(data);
    const info = ttsService.getEngines().find((v) => v.id === engine);
    if (!info?.cloning) {
      throw new Error(`The engine "${engine}" can't clone voices.`);
    }
    // The window joins them for an engine that takes fewer
    if (samples.length > info.cloning.samples) {
      throw new Error(
        `The engine "${engine}" takes up to ${info.cloning.samples} samples.`,
      );
    }
    const label = info.label;
    const res = await ttsService.cloneVoice(engine, name, samples, language());
    if (!res.success) {
      const key = failureKey(res.error, { cloning: true });
      const { minSeconds, maxSeconds } = info.cloning;
      throw new AppFailure(
        FEEDBACK_CODES.VOICE_CLONE_FAILED,
        t(key ?? "main.failure.cloneVoice", {
          engine: label,
          settings: t("nav.settings"),
          length: formatSeconds(language(), minSeconds, maxSeconds),
        }),
        { logged: true, cause: res.error },
      );
    }
    e.reply(APP_EVENTS_RESPONSE.CLONE_VOICE, { id, success: true });
    if (res.verify) {
      notifier.warn(
        "tts",
        FEEDBACK_CODES.VOICE_CLONED,
        t("main.tts.cloneVerify", { engine: label, name }),
      );
    } else {
      notifier.success(
        "tts",
        FEEDBACK_CODES.VOICE_CLONED,
        t("main.tts.voiceCloned", { name }),
      );
    }
    // The voice pickers on screen show the new voice. After the notice: the
    // list takes a moment to come
    e.reply(APP_EVENTS_RESPONSE.GET_VOICES, {
      voices: await ttsService.getVoices(),
      engines: ttsService.getEngines(),
      success: true,
    });
  },
  {
    failure: {
      code: FEEDBACK_CODES.VOICE_CLONE_FAILED,
      message: "main.failure.cloneVoice",
    },
    onError: (e, error, { id }) =>
      e.reply(APP_EVENTS_RESPONSE.CLONE_VOICE, { success: false, id, error }),
  },
);

// macOS asks the user once, other systems let the window record.
events.push(
  APP_EVENTS.ASK_MICROPHONE,
  async (_, e) => {
    let granted = true;
    if (process.platform === "darwin") {
      const status = systemPreferences.getMediaAccessStatus("microphone");
      granted =
        status === "not-determined"
          ? await systemPreferences.askForMediaAccess("microphone")
          : status === "granted";
    }
    e.reply(APP_EVENTS_RESPONSE.ASK_MICROPHONE, { success: true, granted });
  },
  {
    notify: false,
    failure: {
      code: FEEDBACK_CODES.MICROPHONE_FAILED,
      message: "main.failure.askMicrophone",
    },
    onError: replyFailure(APP_EVENTS_RESPONSE.ASK_MICROPHONE),
  },
);

export default events;
