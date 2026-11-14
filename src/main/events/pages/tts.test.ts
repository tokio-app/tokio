import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  FEEDBACK_CODES,
} from "@/common/types";
import { defaultProfile, VOICE_SAMPLE_MAX_BYTES } from "@/common/util";
import Logger from "@/logger";
import { TTSRequestError } from "@/services/tts/common";
import { dialog, systemPreferences } from "@test/electron";
import { createHandler } from "@test/handler";
import { mkdtemp, rm, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import tts from "./tts";

const voice = { engine: "Edge", name: "en-US-AvaNeural", lang: "en-US" };

describe("tts events", () => {
  describe("GET_VOICES", () => {
    it("replies the voices and the engines", async () => {
      const engines = [{ id: "Edge", label: "Edge" }];
      const h = createHandler({
        ttsService: {
          getVoices: async () => [voice],
          getEngines: () => engines,
        },
      });

      await h.invoke(tts, APP_EVENTS.GET_VOICES);

      expect(h.replies(APP_EVENTS_RESPONSE.GET_VOICES)).toEqual([
        { success: true, voices: [voice], engines },
      ]);
      expect(h.notices).toEqual([]);
    });

    it("replies and notifies when the voices can't be listed", async () => {
      const h = createHandler({
        ttsService: {
          getVoices: async () => {
            throw new Error("no engines");
          },
        },
      });

      await h.invoke(tts, APP_EVENTS.GET_VOICES);

      const failure = {
        code: FEEDBACK_CODES.TTS_VOICES_FAILED,
        message: "Unable to load the voices.",
      };
      expect(h.replies(APP_EVENTS_RESPONSE.GET_VOICES)).toEqual([
        { success: false, error: failure },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({ level: "error", source: "tts", ...failure }),
      ]);
    });
  });

  describe("GET_VOICES, with an engine that fails", () => {
    const engines = [
      { id: "Edge", label: "Edge" },
      { id: "ElevenLabs", label: "ElevenLabs", keyLabel: "voiceKeys.apiKey" },
    ] as const;
    const failing = (failed: string[], key = "sk_1") => {
      const logVoicesFailure = vi.fn();
      const error = new Error("HTTP 401");
      const h = createHandler({
        ttsService: {
          getVoices: async (onFail) => {
            for (const engine of failed) onFail?.(engine, error);
            return [voice];
          },
          getEngines: () => [...engines],
          logVoicesFailure,
        },
        storeManagerService: { getVoiceKey: () => key },
      });
      return { h, logVoicesFailure, error };
    };
    const warning = expect.objectContaining({
      level: "warning",
      source: "tts",
      code: FEEDBACK_CODES.TTS_VOICES_FAILED,
      message:
        "Unable to load the ElevenLabs voices. Check its API key in Settings.",
    });

    it("warns about a saved key, logging once per notice", async () => {
      const { h, logVoicesFailure, error } = failing(["ElevenLabs"]);

      await h.invoke(tts, APP_EVENTS.GET_VOICES);
      await h.invoke(tts, APP_EVENTS.GET_VOICES);

      expect(h.replies(APP_EVENTS_RESPONSE.GET_VOICES)).toEqual([
        { success: true, voices: [voice], engines },
        { success: true, voices: [voice], engines },
      ]);
      expect(h.notices).toEqual([warning]);
      expect(logVoicesFailure).toHaveBeenCalledExactlyOnceWith(
        "ElevenLabs",
        error,
      );
    });

    it("only logs an engine without a saved key, or without keys", async () => {
      const { h, logVoicesFailure } = failing(["Edge", "ElevenLabs"], "");

      await h.invoke(tts, APP_EVENTS.GET_VOICES);
      await h.invoke(tts, APP_EVENTS.GET_VOICES);

      expect(h.notices).toEqual([]);
      expect(logVoicesFailure).toHaveBeenCalledTimes(4);
    });
  });

  describe("UPDATE_TTS_SETTINGS", () => {
    const settings = { ...defaultProfile.tts, voice };

    it("saves the TTS section of the profile without a notice, since it's an autosave", async () => {
      const updateProfileData = vi.fn(async () => true);
      const h = createHandler({ storeManagerService: { updateProfileData } });

      await h.invoke(tts, APP_EVENTS.UPDATE_TTS_SETTINGS, { settings });

      expect(updateProfileData).toHaveBeenCalledExactlyOnceWith({
        tts: settings,
      });
      expect(h.replies(APP_EVENTS_RESPONSE.UPDATE_TTS_SETTINGS)).toEqual([
        { success: true },
      ]);
      expect(h.notices).toEqual([]);
    });

    it("reports a failed save as the system's, logged by the store alone", async () => {
      const log = vi.spyOn(Logger, "error");
      const h = createHandler({
        storeManagerService: { updateProfileData: async () => false },
      });

      await h.invoke(tts, APP_EVENTS.UPDATE_TTS_SETTINGS, { settings });

      const failure = {
        code: FEEDBACK_CODES.PROFILE_SAVE_FAILED,
        message: "Unable to save the TTS settings.",
      };
      expect(h.replies(APP_EVENTS_RESPONSE.UPDATE_TTS_SETTINGS)).toEqual([
        { success: false, error: failure },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "error",
          source: "system",
          ...failure,
        }),
      ]);
      expect(log).not.toHaveBeenCalled();
    });
  });

  describe("GET_TTS_TEST", () => {
    const test = { id: "preview-1", text: "Hello", voice };

    it("replies the audio with the test's id", async () => {
      const generateBuffer = vi.fn(async () => ({
        success: true,
        buffer: Buffer.from([1, 2, 3]),
      }));
      const h = createHandler({ ttsService: { generateBuffer } });

      await h.invoke(tts, APP_EVENTS.GET_TTS_TEST, test);

      expect(generateBuffer).toHaveBeenCalledWith("Hello", voice);
      const replies = h.replies(APP_EVENTS_RESPONSE.GET_TTS_TEST);
      expect(replies).toEqual([
        { success: true, id: "preview-1", data: new Uint8Array([1, 2, 3]) },
      ]);
      // A Buffer is a Uint8Array too, so check it was converted
      expect(Buffer.isBuffer(replies[0].data)).toBe(false);
      expect(h.notices).toEqual([]);
    });

    it.each([
      {
        case: "the engine fails",
        result: { success: false, error: new Error("429") },
      },
      { case: "there's no audio", result: { success: true } },
    ])("replies the failure with the id when $case", async ({ result }) => {
      const h = createHandler({
        ttsService: { generateBuffer: async () => result },
      });

      await h.invoke(tts, APP_EVENTS.GET_TTS_TEST, test);

      const failure = {
        code: FEEDBACK_CODES.TTS_GENERATION_FAILED,
        message: "Unable to generate the test audio. Try another voice.",
      };
      expect(h.replies(APP_EVENTS_RESPONSE.GET_TTS_TEST)).toEqual([
        { success: false, id: "preview-1", error: failure },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({ level: "error", source: "tts", ...failure }),
      ]);
    });

    it.each([
      [
        402,
        "Your ElevenLabs account is out of credits. Add more on its website, or pick another voice.",
      ],
      [
        404,
        "This voice is no longer in your ElevenLabs account. Pick another one.",
      ],
    ])("says why the engine refused with a %i", async (status, message) => {
      const error = new TTSRequestError("ElevenLabs", "x", "failed", status);
      const h = createHandler({
        ttsService: { generateBuffer: async () => ({ success: false, error }) },
      });

      await h.invoke(tts, APP_EVENTS.GET_TTS_TEST, test);

      const failure = { code: FEEDBACK_CODES.TTS_GENERATION_FAILED, message };
      expect(h.replies(APP_EVENTS_RESPONSE.GET_TTS_TEST)).toEqual([
        { success: false, id: "preview-1", error: failure },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({ level: "error", source: "tts", ...failure }),
      ]);
    });

    describe("from the tester, with the page's settings", () => {
      const settings = defaultProfile.tts;
      const tester = { id: "tts-test", text: "Hello 😂", voice, settings };

      it("reads the message like chat", async () => {
        const prepareText = vi.fn(() => "Hello");
        const generateBuffer = vi.fn(async () => ({
          success: true,
          buffer: Buffer.from([1]),
        }));
        const h = createHandler({
          ttsService: { prepareText, generateBuffer },
        });

        await h.invoke(tts, APP_EVENTS.GET_TTS_TEST, tester);

        expect(prepareText).toHaveBeenCalledExactlyOnceWith(
          "Hello 😂",
          settings,
        );
        expect(generateBuffer).toHaveBeenCalledExactlyOnceWith("Hello", voice);
        expect(h.replies(APP_EVENTS_RESPONSE.GET_TTS_TEST)).toEqual([
          { success: true, id: "tts-test", data: new Uint8Array([1]) },
        ]);
      });

      it("warns without speaking when the settings leave nothing to read", async () => {
        const generateBuffer = vi.fn();
        const h = createHandler({
          ttsService: { prepareText: () => null, generateBuffer },
        });

        await h.invoke(tts, APP_EVENTS.GET_TTS_TEST, tester);

        const failure = {
          code: FEEDBACK_CODES.TTS_TEST_BLOCKED,
          message:
            "This message wouldn't be read aloud: it has a banned word or nothing left to read.",
        };
        expect(generateBuffer).not.toHaveBeenCalled();
        expect(h.replies(APP_EVENTS_RESPONSE.GET_TTS_TEST)).toEqual([
          { success: false, id: "tts-test", error: failure },
        ]);
        expect(h.notices).toEqual([
          expect.objectContaining({
            level: "warning",
            source: "tts",
            ...failure,
          }),
        ]);
      });
    });
  });

  describe("TTS_PLAYED", () => {
    it("lets TTS make the next message, without a reply or notice", async () => {
      const played = vi.fn();
      const h = createHandler({ ttsService: { played } });

      await h.invoke(tts, APP_EVENTS.TTS_PLAYED, { id: 3 });

      expect(played).toHaveBeenCalledExactlyOnceWith(3);
      expect(h.sent()).toEqual([]);
    });
  });

  describe("PICK_VOICE_SAMPLES", () => {
    const folder = async () => {
      const dir = await mkdtemp(join(tmpdir(), "tokio-samples-"));
      onTestFinished(() => rm(dir, { recursive: true, force: true }));
      return dir;
    };

    it("sends nothing when the dialog is canceled", async () => {
      dialog.showOpenDialog.mockResolvedValue({
        canceled: true,
        filePaths: [],
      });
      const h = createHandler();

      await h.invoke(tts, APP_EVENTS.PICK_VOICE_SAMPLES);

      expect(dialog.showOpenDialog.mock.calls[0][1]).toMatchObject({
        title: "Select voice samples",
        properties: ["openFile", "multiSelections"],
        filters: [
          {
            name: "Audio",
            extensions: ["mp3", "wav", "m4a", "ogg", "flac", "webm"],
          },
        ],
      });
      expect(h.sent()).toEqual([]);
    });

    it("replies the files' names and bytes", async () => {
      const dir = await folder();
      const files = [join(dir, "one.mp3"), join(dir, "two.wav")];
      await writeFile(files[0], Buffer.from([1, 2]));
      await writeFile(files[1], Buffer.from([3]));
      dialog.showOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: files,
      });
      const h = createHandler();

      await h.invoke(tts, APP_EVENTS.PICK_VOICE_SAMPLES);

      const [reply] = h.replies(APP_EVENTS_RESPONSE.PICK_VOICE_SAMPLES);
      expect(reply).toEqual({
        success: true,
        samples: [
          { name: "one.mp3", data: new Uint8Array([1, 2]) },
          { name: "two.wav", data: new Uint8Array([3]) },
        ],
      });
      // A Buffer is a Uint8Array too, so check it was converted
      expect(Buffer.isBuffer(reply.samples?.[0].data)).toBe(false);
      expect(h.notices).toEqual([]);
    });

    it("leaves out empty, oversized and unreadable files, with one warning", async () => {
      const log = vi.spyOn(Logger, "warn");
      const dir = await folder();
      const [good, empty, big, missing] = [
        "good.mp3",
        "empty.mp3",
        "big.mp3",
        "missing.mp3",
      ].map((name) => join(dir, name));
      await writeFile(good, Buffer.from([1]));
      await writeFile(empty, "");
      // Sparse, so the test writes nothing
      await writeFile(big, "");
      await truncate(big, VOICE_SAMPLE_MAX_BYTES + 1);
      dialog.showOpenDialog.mockResolvedValue({
        canceled: false,
        filePaths: [good, empty, big, missing],
      });
      const h = createHandler();

      await h.invoke(tts, APP_EVENTS.PICK_VOICE_SAMPLES);

      expect(h.replies(APP_EVENTS_RESPONSE.PICK_VOICE_SAMPLES)).toEqual([
        {
          success: true,
          samples: [{ name: "good.mp3", data: new Uint8Array([1]) }],
        },
      ]);
      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "warning",
          source: "tts",
          code: FEEDBACK_CODES.VOICE_SAMPLE_FAILED,
          message:
            "Unable to add empty.mp3, big.mp3, and missing.mp3. Each sample must be an audio file of 25 MB or less.",
        }),
      ]);
      expect(log).toHaveBeenCalledExactlyOnceWith(
        expect.stringContaining("<TTS> Unable to read a voice sample - ENOENT"),
        undefined,
      );
    });
  });

  describe("CLONE_VOICE", () => {
    const engines = [
      { id: "Edge", label: "Edge" },
      { id: "ElevenLabs", label: "ElevenLabs", clones: true },
    ];
    const samples = [{ name: "me.mp3", data: new Uint8Array([1]) }];
    const request = {
      id: "clone-1",
      engine: "ElevenLabs",
      name: " My voice ",
      samples,
    };
    const voices = [
      { engine: "ElevenLabs", name: "My voice", lang: "mul", id: "v1" },
    ];
    const cloning = (
      result: { success: boolean; verify?: boolean; error?: Error } = {
        success: true,
        verify: false,
      },
    ) => {
      const cloneVoice = vi.fn(async () => result);
      const h = createHandler({
        ttsService: {
          getEngines: () => engines,
          cloneVoice,
          getVoices: async () => voices,
        },
      });
      return { h, cloneVoice };
    };

    it("clones the voice, and sends the voices with it", async () => {
      const { h, cloneVoice } = cloning();

      await h.invoke(tts, APP_EVENTS.CLONE_VOICE, request);

      expect(cloneVoice).toHaveBeenCalledExactlyOnceWith(
        "ElevenLabs",
        "My voice",
        samples,
      );
      expect(h.sent()).toEqual([
        [APP_EVENTS_RESPONSE.CLONE_VOICE, { id: "clone-1", success: true }],
        [APP_EVENTS_RESPONSE.GET_VOICES, { voices, engines, success: true }],
        [
          "notice",
          expect.objectContaining({
            level: "success",
            source: "tts",
            code: FEEDBACK_CODES.VOICE_CLONED,
            message: `Voice "My voice" cloned. It's in the voice list now.`,
          }),
        ],
      ]);
    });

    it("warns when the voice needs verifying first", async () => {
      const { h } = cloning({ success: true, verify: true });

      await h.invoke(tts, APP_EVENTS.CLONE_VOICE, request);

      expect(h.notices).toEqual([
        expect.objectContaining({
          level: "warning",
          code: FEEDBACK_CODES.VOICE_CLONED,
          message:
            'ElevenLabs created "My voice", but you need to verify the voice on its website before using it.',
        }),
      ]);
    });

    it.each([
      ["a blank name", { name: "  " }],
      ["a long name", { name: "a".repeat(101) }],
      ["no samples", { samples: [] }],
      [
        "too many samples",
        { samples: Array.from({ length: 11 }, () => samples[0]) },
      ],
      ["another file type", { samples: [{ ...samples[0], name: "me.exe" }] }],
      [
        "a prototype key as the extension",
        { samples: [{ ...samples[0], name: "me.constructor" }] },
      ],
      [
        "an empty sample",
        { samples: [{ ...samples[0], data: new Uint8Array() }] },
      ],
      [
        "an oversized sample",
        {
          samples: [
            { ...samples[0], data: new Uint8Array(VOICE_SAMPLE_MAX_BYTES + 1) },
          ],
        },
      ],
      ["an engine that can't clone", { engine: "Edge" }],
    ])("refuses %s, replying with the id", async (_, change) => {
      vi.spyOn(Logger, "error");
      const { h, cloneVoice } = cloning();

      await h.invoke(tts, APP_EVENTS.CLONE_VOICE, { ...request, ...change });

      const failure = {
        code: FEEDBACK_CODES.VOICE_CLONE_FAILED,
        message: "Unable to clone the voice.",
      };
      expect(cloneVoice).not.toHaveBeenCalled();
      expect(h.replies(APP_EVENTS_RESPONSE.CLONE_VOICE)).toEqual([
        { success: false, id: "clone-1", error: failure },
      ]);
      expect(h.notices).toEqual([expect.objectContaining(failure)]);
    });

    it.each([
      [
        "no key",
        new TTSRequestError("ElevenLabs", "missing_api_key", "no key"),
        "This voice needs your ElevenLabs API key. Add it in Settings.",
      ],
      [
        "a rejected key",
        new TTSRequestError("ElevenLabs", "invalid_api_key", "x", 401),
        "ElevenLabs didn't accept your API key. Check it in Settings.",
      ],
      [
        "no credits",
        new TTSRequestError("ElevenLabs", "x", "x", 402),
        "Your ElevenLabs account is out of credits. Add more on its website, or pick another voice.",
      ],
      [
        "a plan without cloning",
        new TTSRequestError("ElevenLabs", "x", "x", 403),
        "Your ElevenLabs plan or API key doesn't allow this. Check them on its website.",
      ],
      [
        "a busy engine",
        new TTSRequestError("ElevenLabs", "x", "x", 429),
        "ElevenLabs is busy. Try again in a moment.",
      ],
      [
        "unusable samples",
        new TTSRequestError("ElevenLabs", "x", "x", 422),
        "ElevenLabs couldn't clone a voice from these samples. Try 1 to 2 minutes of clear speech.",
      ],
      [
        "anything else",
        new TTSRequestError("ElevenLabs", "network", "fetch failed"),
        "Unable to clone the voice.",
      ],
    ])(
      "says why it failed with %s, logged once by TTS",
      async (_, error, message) => {
        const log = vi.spyOn(Logger, "error");
        const { h } = cloning({ success: false, error });

        await h.invoke(tts, APP_EVENTS.CLONE_VOICE, request);

        const failure = { code: FEEDBACK_CODES.VOICE_CLONE_FAILED, message };
        expect(h.replies(APP_EVENTS_RESPONSE.CLONE_VOICE)).toEqual([
          { success: false, id: "clone-1", error: failure },
        ]);
        expect(h.notices).toEqual([
          expect.objectContaining({
            level: "error",
            source: "tts",
            ...failure,
          }),
        ]);
        expect(log).not.toHaveBeenCalled();
      },
    );
  });

  describe("ASK_MICROPHONE", () => {
    it("asks macOS when the user hasn't decided yet", async () => {
      vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
      systemPreferences.getMediaAccessStatus.mockReturnValue("not-determined");
      systemPreferences.askForMediaAccess.mockResolvedValue(false);
      const h = createHandler();

      await h.invoke(tts, APP_EVENTS.ASK_MICROPHONE);

      expect(
        systemPreferences.askForMediaAccess,
      ).toHaveBeenCalledExactlyOnceWith("microphone");
      expect(h.replies(APP_EVENTS_RESPONSE.ASK_MICROPHONE)).toEqual([
        { success: true, granted: false },
      ]);
    });

    it.each([
      ["granted", true],
      ["denied", false],
    ] as const)("reads macOS's %s without asking", async (status, granted) => {
      vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
      systemPreferences.getMediaAccessStatus.mockReturnValue(status);
      const h = createHandler();

      await h.invoke(tts, APP_EVENTS.ASK_MICROPHONE);

      expect(systemPreferences.getMediaAccessStatus).toHaveBeenCalledWith(
        "microphone",
      );
      expect(systemPreferences.askForMediaAccess).not.toHaveBeenCalled();
      expect(h.replies(APP_EVENTS_RESPONSE.ASK_MICROPHONE)).toEqual([
        { success: true, granted },
      ]);
    });

    it.each(["win32", "linux"] as const)(
      "lets the window record on %s without asking",
      async (platform) => {
        vi.spyOn(process, "platform", "get").mockReturnValue(platform);
        const h = createHandler();

        await h.invoke(tts, APP_EVENTS.ASK_MICROPHONE);

        expect(systemPreferences.getMediaAccessStatus).not.toHaveBeenCalled();
        expect(h.replies(APP_EVENTS_RESPONSE.ASK_MICROPHONE)).toEqual([
          { success: true, granted: true },
        ]);
        expect(h.notices).toEqual([]);
      },
    );

    it("replies a failure without a notice", async () => {
      vi.spyOn(Logger, "error");
      vi.spyOn(process, "platform", "get").mockReturnValue("darwin");
      systemPreferences.askForMediaAccess.mockRejectedValue(new Error("x"));
      systemPreferences.getMediaAccessStatus.mockReturnValue("not-determined");
      const h = createHandler();

      await h.invoke(tts, APP_EVENTS.ASK_MICROPHONE);

      expect(h.replies(APP_EVENTS_RESPONSE.ASK_MICROPHONE)).toEqual([
        {
          success: false,
          error: {
            code: FEEDBACK_CODES.MICROPHONE_FAILED,
            message: "Unable to ask for the microphone.",
          },
        },
      ]);
      expect(h.notices).toEqual([]);
    });
  });
});
