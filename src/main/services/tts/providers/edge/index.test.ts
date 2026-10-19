import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listVoices, synthesize } from "./common/protocol";
import { EdgeTTS, EdgeTTSError, edgeDisplayName, edgeShortName } from "./index";
import type { EdgeVoice } from "./types";

vi.mock("./common/protocol", () => ({
  listVoices: vi.fn(),
  synthesize: vi.fn(),
}));

const DEFAULT = "en-US-EmmaMultilingualNeural";

const voice = (ShortName: string, Locale: string): EdgeVoice => ({
  Name: `Microsoft Server Speech Text to Speech Voice (${ShortName})`,
  ShortName,
  Gender: "Female",
  Locale,
  FriendlyName: ShortName,
  Status: "GA",
});

const VOICES = [
  voice("es-MX-JorgeNeural", "es-MX"),
  voice("es-MX-DaliaNeural", "es-MX"),
  voice(DEFAULT, "en-US"),
];

const roundTrip = (v: EdgeVoice) =>
  edgeShortName({ lang: v.Locale, name: edgeDisplayName(v) });

describe("Edge voice names", () => {
  it.each([
    ["es-MX-JorgeNeural", "es-MX", "Jorge"],
    [DEFAULT, "en-US", "Emma Multilingual"],
    ["zh-CN-liaoning-XiaobeiNeural", "zh-CN-liaoning", "Xiaobei"],
    ["de-DE-Florian2MultilingualNeural", "de-DE", "Florian2 Multilingual"],
    ["en-US-AIGenerate1Neural", "en-US", "AIGenerate1"],
  ])("turns %s into a display name and back", (shortName, lang, name) => {
    const v = voice(shortName, lang);

    expect(edgeDisplayName(v)).toBe(name);
    expect(edgeShortName({ lang, name })).toBe(shortName);
    expect(roundTrip(v)).toBe(shortName);
  });

  // edgeDisplayName keeps the whole ShortName, and edgeShortName adds the Locale in front of it.
  it.fails("round-trips a ShortName whose prefix isn't its Locale", () => {
    expect(roundTrip(voice("en-US-AvaNeural", "en-GB"))).toBe(
      "en-US-AvaNeural",
    );
  });

  it("accepts the raw suffix saved by earlier versions", () => {
    expect(edgeShortName({ lang: "es-MX", name: "JorgeNeural" })).toBe(
      "es-MX-JorgeNeural",
    );
    expect(
      edgeShortName({ lang: "en-US", name: "EmmaMultilingualNeural" }),
    ).toBe(DEFAULT);
  });
});

describe("EdgeTTS", () => {
  let tts: EdgeTTS;
  const list = vi.mocked(listVoices);
  const speak = vi.mocked(synthesize);

  beforeEach(() => {
    vi.useFakeTimers();
    list.mockReset().mockResolvedValue(VOICES);
    speak.mockReset().mockResolvedValue(Buffer.from("mp3"));
    tts = new EdgeTTS();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("getVoices", () => {
    it("lists the voices by language and display name", async () => {
      await expect(tts.getVoices()).resolves.toEqual([
        { lang: "es-MX", name: "Jorge" },
        { lang: "es-MX", name: "Dalia" },
        { lang: "en-US", name: "Emma Multilingual" },
      ]);
      expect(list).toHaveBeenCalledExactlyOnceWith(tts.config);
    });

    it("keeps the list for a day, then fetches it again", async () => {
      const first = await tts.getVoices();
      vi.advanceTimersByTime(tts.config.VOICES_TTL_MS - 1);
      expect(await tts.getVoices()).toBe(first);
      expect(list).toHaveBeenCalledOnce();

      list.mockResolvedValue([VOICES[0]]);
      vi.advanceTimersByTime(1);

      expect(await tts.getVoices()).toEqual([{ lang: "es-MX", name: "Jorge" }]);
      expect(list).toHaveBeenCalledTimes(2);
    });

    it("returns the old list when fetching it again fails", async () => {
      const first = await tts.getVoices();
      list.mockRejectedValue(new EdgeTTSError("network", "offline"));
      vi.advanceTimersByTime(tts.config.VOICES_TTL_MS);

      expect(await tts.getVoices()).toBe(first);
      expect(list).toHaveBeenCalledTimes(2);
    });

    it("fails when there's no list to fall back on", async () => {
      const error = new EdgeTTSError("network", "offline");
      list.mockRejectedValue(error);

      await expect(tts.getVoices()).rejects.toBe(error);
    });

    it("takes the Chromium version and token versions it's given", () => {
      const custom = new EdgeTTS({
        CHROMIUM_FULL_VERSION: "150.0.0.1",
        TOKEN_VERSIONS: ["1"],
      });

      expect(custom.config).toMatchObject({
        CHROMIUM_FULL_VERSION: "150.0.0.1",
        TOKEN_VERSIONS: ["1"],
      });
      expect(tts.config.TOKEN_VERSIONS).toEqual(["2", "1"]);
    });
  });

  describe("generateBuffer", () => {
    it("speaks with the voice's short name", async () => {
      const res = await tts.generateBuffer("Hola", "es-MX", "Jorge");

      expect(res).toEqual({ success: true, buffer: Buffer.from("mp3") });
      expect(speak).toHaveBeenCalledExactlyOnceWith(
        tts.config,
        "Hola",
        "es-MX-JorgeNeural",
      );
    });

    it("speaks with a voice it hasn't listed yet", async () => {
      await tts.generateBuffer("Hola", "es-MX", "Jorge");

      expect(list).not.toHaveBeenCalled();
      expect(speak).toHaveBeenCalledWith(
        tts.config,
        "Hola",
        "es-MX-JorgeNeural",
      );
    });

    it("speaks with a listed voice and with its legacy name", async () => {
      await tts.getVoices();

      await tts.generateBuffer("Hola", "es-MX", "Dalia");
      await tts.generateBuffer("Hola", "es-MX", "JorgeNeural");

      expect(speak.mock.calls.map(([, , name]) => name)).toEqual([
        "es-MX-DaliaNeural",
        "es-MX-JorgeNeural",
      ]);
    });

    it.each([
      ["no language", undefined, "Jorge"],
      ["no voice", "es-MX", undefined],
      ["an empty voice", "es-MX", ""],
    ])("uses the default voice with %s", async (_name, lang, name) => {
      await tts.generateBuffer("Hola", lang, name);

      expect(speak).toHaveBeenCalledWith(tts.config, "Hola", DEFAULT);
    });

    it("uses the default voice for a voice that isn't in the list", async () => {
      await tts.getVoices();

      // A TikTok voice left in the profile
      await tts.generateBuffer("Hello", "en", "Default");

      expect(speak).toHaveBeenCalledWith(tts.config, "Hello", DEFAULT);
    });

    it("returns the error it gets", async () => {
      const error = new EdgeTTSError("handshake", "rejected", { status: 403 });
      speak.mockRejectedValue(error);

      await expect(
        tts.generateBuffer("Hola", "es-MX", "Jorge"),
      ).resolves.toEqual({
        success: false,
        error,
      });
    });

    it("wraps a thrown value that isn't an Error", async () => {
      speak.mockRejectedValue("socket gone");

      const res = await tts.generateBuffer("Hola", "es-MX", "Jorge");

      expect(res.success).toBe(false);
      expect(res.error).toBeInstanceOf(EdgeTTSError);
      expect(res.error).toMatchObject({
        stage: "synthesis",
        message: expect.stringContaining("socket gone"),
      });
    });
  });
});
