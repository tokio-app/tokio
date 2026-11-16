import { Profile } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { defaultProfile } from "@/common/util";
import tts from "@/events/pages/tts";
import { createHandler } from "@test/handler";
import { mcpClient } from "@test/mcp";
import { describe, expect, it, vi } from "vitest";

const setup = (stubs: Parameters<typeof createHandler>[0] = {}) => {
  const profile: Profile = structuredClone(defaultProfile);
  profile.tts.voice = {
    engine: "ElevenLabs",
    name: "Rachel",
    lang: "mul",
    id: "el-1",
  };
  const updateProfileData = vi.fn(async (data: Partial<Profile>) => {
    Object.assign(profile, data);
    return true;
  });
  const h = createHandler(
    {
      storeManagerService: {
        getProfileData: async () => profile,
        getProfiles: () => [],
        getSettings: () => ({
          activeProfile: { name: "Main", file: "main.json" },
        }),
        updateProfileData,
        getVoiceKey: (engine: string) => (engine === "ElevenLabs" ? "sk" : ""),
      },
      ...stubs,
    },
    { stack: tts },
  );
  return { h, profile, updateProfileData };
};

describe("tts MCP tools", () => {
  describe("tts section", () => {
    it("reads the profile's TTS settings", async () => {
      const { h, profile } = setup();
      const { call } = await mcpClient(h.handler);

      const res = await call("get_settings", { section: "tts" });

      expect(res.value).toEqual({ values: profile.tts });
    });

    it("saves a voice picked without an id with an empty one, then sends the profile", async () => {
      const { h, updateProfileData } = setup();
      const { call } = await mcpClient(h.handler);

      const res = await call("update_settings", {
        section: "tts",
        changes: { voice: { engine: "Edge", name: "Elvira", lang: "es-ES" } },
      });

      expect(res).toMatchObject({ isError: false, text: "Saved." });
      expect(updateProfileData).toHaveBeenCalledOnce();
      expect(updateProfileData.mock.calls[0][0].tts?.voice).toEqual({
        engine: "Edge",
        name: "Elvira",
        lang: "es-ES",
        id: "",
      });
      expect(h.pushed(APP_EVENTS_RESPONSE.GET_PROFILE)).toHaveLength(1);
    });

    it("keeps the voice's id when another field changes", async () => {
      const { h, updateProfileData } = setup();
      const { call } = await mcpClient(h.handler);

      await call("update_settings", {
        section: "tts",
        changes: { filters: { volume: 50 } },
      });

      const saved = updateProfileData.mock.calls[0][0].tts;
      expect(saved?.voice.id).toBe("el-1");
      expect(saved?.filters).toEqual({ speed: 1, pitch: 1, volume: 50 });
    });

    it("refuses values out of the page's ranges", async () => {
      const { h, updateProfileData } = setup();
      const { call } = await mcpClient(h.handler);

      const res = await call("update_settings", {
        section: "tts",
        changes: { filters: { speed: 5 } },
      });

      expect(res.isError).toBe(true);
      expect(updateProfileData).not.toHaveBeenCalled();
    });
  });

  describe("list_voices", () => {
    const voices = [
      { engine: "Edge", name: "Elvira", lang: "es-ES", id: "" },
      { engine: "Edge", name: "Jenny", lang: "en-US", id: "" },
      { engine: "ElevenLabs", name: "Rachel", lang: "mul", id: "el-1" },
    ];
    const ttsService = {
      getVoices: async (onFail?: (engine: string, error: unknown) => void) => {
        onFail?.("Cartesia", new Error("401"));
        return voices;
      },
      logVoicesFailure: vi.fn(),
    };

    it("filters by language, with the multilingual voices, and names failures", async () => {
      const { h } = setup({ ttsService });
      const { call } = await mcpClient(h.handler);

      const res = await call("list_voices", { language: "ES" });

      expect(res.value).toEqual({
        total: 2,
        voices: [voices[0], voices[2]],
        failedEngines: ["Cartesia"],
      });
      expect(ttsService.logVoicesFailure).toHaveBeenCalled();
    });

    it("filters by engine and name, and limits", async () => {
      const { h } = setup({ ttsService });
      const { call } = await mcpClient(h.handler);

      expect(
        (await call("list_voices", { engine: "Edge", limit: 1 })).value,
      ).toMatchObject({ total: 2, voices: [voices[0]] });
      expect((await call("list_voices", { query: "jen" })).value).toMatchObject(
        { total: 1, voices: [voices[1]] },
      );
    });
  });

  describe("voice test", () => {
    it("speaks through GET_TTS_TEST and plays it as an alert test", async () => {
      const generateBuffer = vi.fn(async () => ({
        success: true,
        buffer: Buffer.from([1, 2, 3]),
      }));
      const { h, profile } = setup({
        ttsService: { prepareText: (text: string) => text, generateBuffer },
      });
      const { call } = await mcpClient(h.handler);

      const res = await call("test", { kind: "voice", args: { text: "hola" } });

      expect(res.isError).toBe(false);
      expect(generateBuffer).toHaveBeenCalledWith("hola", profile.tts.voice);
      // Private: the TTS page's tester doesn't get it
      expect(h.pushed(APP_EVENTS_RESPONSE.GET_TTS_TEST)).toEqual([]);
      expect(h.pushed(APP_EVENTS_RESPONSE.ALERT_AUDIO)).toEqual([
        expect.objectContaining({
          data: new Uint8Array([1, 2, 3]),
          channel: "alert-test",
          volume: 100,
          key: expect.stringMatching(/^tts:/),
        }),
      ]);
    });

    it("gives the handler's message when the text is blocked", async () => {
      const { h } = setup({ ttsService: { prepareText: () => null } });
      const invoke = vi.spyOn(h.handler, "invoke");
      const { call } = await mcpClient(h.handler);

      const res = await call("test", { kind: "voice", args: { text: "..." } });

      expect(res.isError).toBe(true);
      expect(invoke).toHaveBeenCalledWith(
        APP_EVENTS.GET_TTS_TEST,
        expect.anything(),
      );
      expect(h.pushed(APP_EVENTS_RESPONSE.ALERT_AUDIO)).toEqual([]);
    });
  });

  it("lists the keyed engines with hasKey only", async () => {
    const { h } = setup({
      ttsService: {
        getEngines: () => [
          { id: "Edge", label: "Edge" },
          {
            id: "ElevenLabs",
            label: "ElevenLabs",
            keyLabel: "voiceKeys.sessionId" as const,
          },
          {
            id: "Cartesia",
            label: "Cartesia",
            keyLabel: "voiceKeys.sessionId" as const,
          },
        ],
      },
    });
    const { call } = await mcpClient(h.handler);

    const res = await call("list", { kind: "voice_engines" });

    expect(res.value).toEqual({
      engines: [
        { id: "ElevenLabs", label: "ElevenLabs", hasKey: true },
        { id: "Cartesia", label: "Cartesia", hasKey: false },
      ],
    });
    expect(res.text).not.toContain("sk");
  });
});
