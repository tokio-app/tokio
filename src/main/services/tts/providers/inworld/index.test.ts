import { inspect } from "node:util";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TTSRequestError } from "../../common";
import config from "./config";
import { InworldTTS } from "./index";

const KEY = "c2VjcmV0LWtleTpzZWNyZXQ=";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

let fetchMock: ReturnType<typeof vi.fn<Fetch>>;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });

const page = (names: string[], next?: string, languageCode?: string) =>
  json({
    voices: names.map((name) => ({
      voiceId: `id-${name}`,
      displayName: name,
      languageCode,
      source: "SYSTEM",
    })),
    nextPageToken: next,
  });

const voice = (name: string, lang = "mul") => ({
  id: `id-${name}`,
  name,
  lang,
});

const listUrl = (token?: string) =>
  `${config.API_URL}/voices/v1/voices?pageSize=500${token ? `&pageToken=${token}` : ""}`;

describe("InworldTTS", () => {
  let tts: InworldTTS;

  beforeEach(() => {
    fetchMock = vi.fn<Fetch>();
    vi.stubGlobal("fetch", fetchMock);
    tts = new InworldTTS();
    tts.setKey(KEY);
  });

  describe("getVoices", () => {
    it("lists the voices by id with the key as sent", async () => {
      fetchMock.mockResolvedValue(page(["Ava"], undefined, "en-US"));

      expect(await tts.getVoices()).toEqual([voice("Ava", "en-US")]);
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(listUrl(), {
        method: "GET",
        headers: { Authorization: `Basic ${KEY}` },
        signal: expect.any(AbortSignal),
      });
    });

    it("lists a voice without a language as multilingual", async () => {
      fetchMock.mockResolvedValue(page(["Ava"]));

      expect(await tts.getVoices()).toEqual([voice("Ava")]);
    });

    it("follows the next pages under one signal", async () => {
      fetchMock
        .mockResolvedValueOnce(page(["Ava"], "t/1"))
        .mockResolvedValueOnce(page(["Ben"], ""));

      expect(await tts.getVoices()).toEqual([voice("Ava"), voice("Ben")]);
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        listUrl(),
        listUrl("t%2F1"),
      ]);
      const [first, second] = fetchMock.mock.calls.map(([, init]) => init);
      expect(second?.signal).toBe(first?.signal);
    });

    it("stops after 10 pages", async () => {
      fetchMock.mockImplementation(async () => page(["Ava"], "more"));

      expect(await tts.getVoices()).toHaveLength(10);
      expect(fetchMock).toHaveBeenCalledTimes(10);
    });
  });

  describe("generateBuffer", () => {
    it("decodes the audio of the voice's id, without a language", async () => {
      fetchMock.mockResolvedValue(
        json({ audioContent: Buffer.from("mp3").toString("base64") }),
      );

      const res = await tts.generateBuffer("Hello", "en", "voice/1");

      expect(res).toEqual({ success: true, buffer: Buffer.from("mp3") });
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
        `${config.API_URL}/tts/v1/voice`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${KEY}`,
          },
          body: JSON.stringify({
            text: "Hello",
            voiceId: "voice/1",
            modelId: "inworld-tts-2-flash",
            audioConfig: { audioEncoding: "MP3" },
          }),
          signal: expect.any(AbortSignal),
        },
      );
    });

    it.each([
      ["missing", {}],
      ["empty", { audioContent: "" }],
    ])("fails when the audio is %s", async (_, body) => {
      fetchMock.mockResolvedValue(json(body));

      const res = await tts.generateBuffer("Hello", "en", "voice-1");

      expect(res.error).toBeInstanceOf(TTSRequestError);
      expect(res.error).toMatchObject({ code: "bad_response", status: 200 });
    });

    it("fails without a key, without asking", async () => {
      tts.setKey("");

      const res = await tts.generateBuffer("Hello", "en", "voice-1");

      expect(res.error).toMatchObject({ code: "missing_api_key" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
      [
        "a gRPC error",
        { code: 16, message: "Invalid credentials", details: [] },
        401,
        "http_401",
        "Inworld request failed: HTTP 401 http_401 - Invalid credentials",
      ],
      [
        "no JSON",
        "Bad Gateway",
        502,
        "http_502",
        "Inworld request failed: HTTP 502 http_502",
      ],
    ])(
      "fails with the status and message of %s",
      async (_, body, status, code, message) => {
        fetchMock.mockResolvedValue(
          typeof body === "string"
            ? new Response(body, { status })
            : json(body, status),
        );

        const res = await tts.generateBuffer("Hello", "en", "voice-1");

        expect(res.error).toBeInstanceOf(TTSRequestError);
        expect(res.error).toMatchObject({ status, code, message });
      },
    );

    it("never puts the key in an error", async () => {
      fetchMock.mockResolvedValue(json({ code: 7, message: "No" }, 403));

      const res = await tts.generateBuffer("Hello", "en", "voice-1");

      expect(inspect(res.error, { depth: Infinity })).not.toContain(KEY);
    });
  });

  describe("cloneVoice", () => {
    const samples = [{ name: "talk.wav", data: new Uint8Array([1, 2, 255]) }];

    it("sends the sample as base64 and returns the new id", async () => {
      fetchMock.mockResolvedValue(json({ voice: { voiceId: "new-id" } }));

      const res = await tts.cloneVoice("My voice", samples, "en");

      expect(res).toEqual({ id: "new-id", verify: false });
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
        `${config.API_URL}/voices/v1/voices:clone`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Basic ${KEY}`,
          },
          body: JSON.stringify({
            displayName: "My voice",
            voiceSamples: [{ audioData: "AQL/" }],
          }),
          signal: expect.any(AbortSignal),
        },
      );
    });

    it("throws the samples' errors as unusable samples when no voice comes", async () => {
      fetchMock.mockResolvedValue(
        json({
          audioSamplesValidated: [
            { errors: [{ text: "Too short" }, { text: "Too noisy" }] },
            { warnings: [{ text: "Quiet" }] },
          ],
        }),
      );

      const error = await tts
        .cloneVoice("Me", samples, "en")
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(TTSRequestError);
      expect(error).toMatchObject({
        engine: "Inworld",
        code: "invalid_samples",
        status: 422,
        message: "Inworld couldn't clone the voice: Too short; Too noisy",
      });
    });

    it("throws a failure with its status", async () => {
      fetchMock.mockResolvedValue(
        json({ code: 7, message: "Write permissions are required" }, 403),
      );

      await expect(tts.cloneVoice("Me", samples, "en")).rejects.toMatchObject({
        status: 403,
        message:
          "Inworld request failed: HTTP 403 http_403 - Write permissions are required",
      });
    });
  });
});
