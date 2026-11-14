import assert from "node:assert";
import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TTSRequestError } from "../../common";
import config from "./config";
import { ElevenLabsTTS } from "./index";

const KEY = "sk_secret-key";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

let fetchMock: ReturnType<typeof vi.fn<Fetch>>;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });

const page = (names: string[], next?: string) =>
  json({
    voices: names.map((name) => ({ voice_id: `id-${name}`, name })),
    has_more: next !== undefined,
    next_page_token: next ?? null,
  });

const voice = (name: string) => ({ id: `id-${name}`, name, lang: "mul" });

const listUrl = (token?: string) =>
  `${config.API_URL}/v2/voices?page_size=100${token ? `&next_page_token=${token}` : ""}`;

describe("ElevenLabsTTS", () => {
  let tts: ElevenLabsTTS;

  beforeEach(() => {
    fetchMock = vi.fn<Fetch>();
    vi.stubGlobal("fetch", fetchMock);
    tts = new ElevenLabsTTS();
    tts.setKey(KEY);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("getVoices", () => {
    it("lists the account's voices by id, as multilingual", async () => {
      fetchMock.mockResolvedValue(page(["Ava", "Ava"]));

      expect(await tts.getVoices()).toEqual([voice("Ava"), voice("Ava")]);
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(listUrl(), {
        method: "GET",
        headers: { "xi-api-key": KEY },
        signal: expect.any(AbortSignal),
      });
    });

    it("follows the next pages", async () => {
      fetchMock
        .mockResolvedValueOnce(page(["Ava"], "t/1"))
        .mockResolvedValueOnce(page(["Ben"]));

      expect(await tts.getVoices()).toEqual([voice("Ava"), voice("Ben")]);
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        listUrl(),
        listUrl("t%2F1"),
      ]);
    });

    it("gives every page one deadline", async () => {
      const timeout = vi.spyOn(AbortSignal, "timeout");
      fetchMock
        .mockResolvedValueOnce(page(["Ava"], "next"))
        .mockResolvedValueOnce(page(["Ben"]));

      await tts.getVoices();

      expect(timeout).toHaveBeenCalledExactlyOnceWith(config.LIST_TIMEOUT_MS);
      const [first, second] = fetchMock.mock.calls.map(([, init]) => init);
      expect(second?.signal).toBe(first?.signal);
    });

    it("stops after 10 pages", async () => {
      fetchMock.mockImplementation(async () => page(["Ava"], "more"));

      expect(await tts.getVoices()).toHaveLength(10);
      expect(fetchMock).toHaveBeenCalledTimes(10);
    });

    it("lists nothing without a key, without asking", async () => {
      tts.setKey("");

      expect(await tts.getVoices()).toEqual([]);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("keeps the list for a minute", async () => {
      vi.useFakeTimers();
      fetchMock.mockImplementation(async () => page(["Ava"]));

      await tts.getVoices();
      vi.advanceTimersByTime(59_999);
      await tts.getVoices();
      expect(fetchMock).toHaveBeenCalledOnce();

      vi.advanceTimersByTime(1);
      await tts.getVoices();
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("forgets the list when the key is set, without asking", async () => {
      fetchMock.mockImplementation(async () => page(["Ava"]));
      await tts.getVoices();

      tts.setKey("sk_other");
      expect(fetchMock).toHaveBeenCalledOnce();
      await tts.getVoices();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.lastCall?.[1]?.headers).toEqual({
        "xi-api-key": "sk_other",
      });
    });

    it("shares one request between calls at once", async () => {
      fetchMock.mockImplementation(async () => page(["Ava"]));

      const lists = await Promise.all([tts.getVoices(), tts.getVoices()]);

      expect(lists).toEqual([[voice("Ava")], [voice("Ava")]]);
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("doesn't keep a list that finished after the key changed", async () => {
      let answer!: (res: Response) => void;
      fetchMock.mockReturnValueOnce(new Promise((r) => (answer = r)));
      const old = tts.getVoices();

      tts.setKey("sk_other");
      answer(page(["Old"]));
      expect(await old).toEqual([voice("Old")]);

      fetchMock.mockResolvedValueOnce(page(["New"]));
      expect(await tts.getVoices()).toEqual([voice("New")]);
    });

    it("throws a failure with its status and code, and doesn't keep it", async () => {
      fetchMock.mockResolvedValueOnce(
        json(
          {
            detail: {
              type: "authentication_error",
              code: "invalid_api_key",
              message: "Invalid API key",
            },
          },
          401,
        ),
      );

      const error = await tts.getVoices().catch((e: unknown) => e);

      expect(error).toBeInstanceOf(TTSRequestError);
      expect(error).toMatchObject({
        engine: "ElevenLabs",
        status: 401,
        code: "invalid_api_key",
        message:
          "ElevenLabs request failed: HTTP 401 invalid_api_key - Invalid API key",
      });
      fetchMock.mockResolvedValueOnce(page(["Ava"]));
      expect(await tts.getVoices()).toEqual([voice("Ava")]);
    });
  });

  describe("generateBuffer", () => {
    it("asks for the voice's audio by its id", async () => {
      fetchMock.mockResolvedValue(new Response(Buffer.from("mp3")));

      const res = await tts.generateBuffer("Hello", "en", "voice/1");

      expect(res).toEqual({ success: true, buffer: Buffer.from("mp3") });
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
        `${config.API_URL}/v1/text-to-speech/voice%2F1?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "xi-api-key": KEY },
          body: JSON.stringify({
            text: "Hello",
            model_id: "eleven_flash_v2_5",
          }),
          signal: expect.any(AbortSignal),
        },
      );
    });

    it("fails without a key, without asking", async () => {
      tts.setKey("");

      const res = await tts.generateBuffer("Hello", "en", "voice-1");

      expect(res.success).toBe(false);
      expect(res.error).toMatchObject({ code: "missing_api_key" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
      [
        "a detail object",
        { detail: { code: "insufficient_credits", message: "No credits" } },
        402,
        "insufficient_credits",
        "ElevenLabs request failed: HTTP 402 insufficient_credits - No credits",
      ],
      [
        "a legacy status",
        { detail: { status: "voice_not_found", message: "Gone" } },
        404,
        "voice_not_found",
        "ElevenLabs request failed: HTTP 404 voice_not_found - Gone",
      ],
      [
        // As a live key without voices_write answered
        "a missing permission, sent as a plain 401",
        {
          detail: {
            code: "unauthorized",
            message:
              "The API key you used is missing the permission voices_write to execute this operation.",
          },
        },
        401,
        "missing_permissions",
        "ElevenLabs request failed: HTTP 401 missing_permissions - The API key you used is missing the permission voices_write to execute this operation.",
      ],
      [
        "a list of validation errors",
        { detail: [{ loc: ["body", "text"], msg: "Field required" }] },
        422,
        "validation_error",
        "ElevenLabs request failed: HTTP 422 validation_error - Field required",
      ],
      [
        "a string",
        { detail: "Too many requests" },
        429,
        "http_429",
        "ElevenLabs request failed: HTTP 429 http_429 - Too many requests",
      ],
      [
        "no JSON",
        "Bad Gateway",
        502,
        "http_502",
        "ElevenLabs request failed: HTTP 502 http_502",
      ],
    ])(
      "fails with the status and code of %s",
      async (_, body, status, code, message) => {
        fetchMock.mockResolvedValue(
          typeof body === "string"
            ? new Response(body, { status })
            : json(body, status),
        );

        const res = await tts.generateBuffer("Hello", "en", "voice-1");

        expect(res.success).toBe(false);
        expect(res.error).toBeInstanceOf(TTSRequestError);
        expect(res.error).toMatchObject({ status, code, message });
      },
    );

    it("fails on a network error without its cause", async () => {
      fetchMock.mockRejectedValue(
        Object.assign(new TypeError("fetch failed"), {
          headers: { "xi-api-key": KEY },
        }),
      );

      const res = await tts.generateBuffer("Hello", "en", "voice-1");

      expect(res.error).toMatchObject({
        code: "network",
        message: "ElevenLabs request failed: fetch failed",
      });
      expect(res.error?.cause).toBeUndefined();
      expect(inspect(res.error)).not.toContain(KEY);
    });

    it("never puts the key in an error", async () => {
      fetchMock.mockResolvedValue(json({ detail: { code: "x" } }, 401));

      const res = await tts.generateBuffer("Hello", "en", "voice-1");

      expect(inspect(res.error, { depth: Infinity })).not.toContain(KEY);
    });
  });

  describe("cloneVoice", () => {
    const samples = [
      { name: "talk.MP3", data: new Uint8Array([1, 2]) },
      { name: "Recording 1.webm", data: new Uint8Array([3]) },
    ];

    it("uploads the name and each sample, numbered and typed by its extension", async () => {
      fetchMock.mockResolvedValue(json({ voice_id: "new-id" }));

      const res = await tts.cloneVoice("My voice", samples, "en");

      expect(res).toEqual({ id: "new-id", verify: false });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`${config.API_URL}/v1/voices/add`);
      expect(init).toMatchObject({
        method: "POST",
        headers: { "xi-api-key": KEY },
        signal: expect.any(AbortSignal),
      });
      const form = init?.body;
      assert(form instanceof FormData);
      expect(form.get("name")).toBe("My voice");
      const files = form.getAll("files").filter((f) => f instanceof File);
      expect(files.map((f) => [f.name, f.type, f.size])).toEqual([
        ["sample-1.mp3", "audio/mpeg", 2],
        ["sample-2.webm", "audio/webm", 1],
      ]);
      expect(new Uint8Array(await files[0].arrayBuffer())).toEqual(
        samples[0].data,
      );
    });

    it("says when the voice needs verifying", async () => {
      fetchMock.mockResolvedValue(
        json({ voice_id: "new-id", requires_verification: true }),
      );

      expect(await tts.cloneVoice("Me", samples, "en")).toEqual({
        id: "new-id",
        verify: true,
      });
    });

    it("lists the voices again after a clone", async () => {
      fetchMock.mockResolvedValueOnce(page(["Ava"]));
      await tts.getVoices();
      fetchMock.mockResolvedValueOnce(json({ voice_id: "new-id" }));
      await tts.cloneVoice("Me", samples, "en");

      fetchMock.mockResolvedValueOnce(page(["Ava", "Me"]));
      expect(await tts.getVoices()).toEqual([voice("Ava"), voice("Me")]);
    });

    it("throws a failure with its status", async () => {
      fetchMock.mockResolvedValue(
        json({ detail: { code: "invalid_audio", message: "Too short" } }, 400),
      );

      await expect(tts.cloneVoice("Me", samples, "en")).rejects.toMatchObject({
        status: 400,
        code: "invalid_audio",
      });
    });

    it("throws without a key, without asking", async () => {
      tts.setKey("");

      await expect(tts.cloneVoice("Me", samples, "en")).rejects.toMatchObject({
        code: "missing_api_key",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
