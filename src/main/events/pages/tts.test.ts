import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  FEEDBACK_CODES,
} from "@/common/types";
import { defaultProfile } from "@/common/util";
import { createHandler } from "@test/handler";
import { describe, expect, it, vi } from "vitest";
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

    it("reports a failed save as the system's", async () => {
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
});
