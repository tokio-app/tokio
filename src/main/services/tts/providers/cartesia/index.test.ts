import assert from "node:assert";
import { inspect } from "node:util";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TTSRequestError } from "../../common";
import config from "./config";
import { CartesiaTTS } from "./index";

const KEY = "sk_car_secret-key";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

let fetchMock: ReturnType<typeof vi.fn<Fetch>>;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });

const page = (names: string[], next?: string) =>
  json({
    data: names.map((name) => ({ id: `id-${name}`, name, language: "en" })),
    has_more: next !== undefined,
    next_page: next ?? null,
  });

const voice = (name: string, lang = "en") => ({ id: `id-${name}`, name, lang });

const listUrl = (cursor?: string) =>
  `${config.API_URL}/voices?limit=100${cursor ? `&starting_after=${cursor}` : ""}`;
const ownUrl = () => `${config.API_URL}/voices?limit=100&is_owner=true`;

const headers = {
  Authorization: `Bearer ${KEY}`,
  "Cartesia-Version": "2026-08-14",
};

describe("CartesiaTTS", () => {
  let tts: CartesiaTTS;

  beforeEach(() => {
    fetchMock = vi.fn<Fetch>();
    vi.stubGlobal("fetch", fetchMock);
    tts = new CartesiaTTS();
    tts.setKey(KEY);
  });

  describe("getVoices", () => {
    // The account's listing and the whole library's answer apart
    const answer = (
      all: (cursor: string | null) => Response,
      own: (cursor: string | null) => Response = () => page([]),
    ) =>
      fetchMock.mockImplementation(async (url) => {
        const cursor = new URL(url).searchParams.get("starting_after");
        return url.includes("is_owner=true") ? own(cursor) : all(cursor);
      });
    const urls = () => fetchMock.mock.calls.map(([url]) => url);

    it("lists the voices with each one's language", async () => {
      answer(() => page(["Ava"]));

      expect(await tts.getVoices()).toEqual([voice("Ava")]);
      const init = { method: "GET", headers, signal: expect.any(AbortSignal) };
      expect(fetchMock).toHaveBeenCalledWith(ownUrl(), init);
      expect(fetchMock).toHaveBeenCalledWith(listUrl(), init);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("lists the account's own voices first, once", async () => {
      answer(
        () => page(["Ava", "Mine"]),
        () => page(["Mine"]),
      );

      expect(await tts.getVoices()).toEqual([voice("Mine"), voice("Ava")]);
    });

    it("lists a voice without a language as multilingual", async () => {
      answer(() => json({ data: [{ id: "a", name: "A" }], has_more: false }));

      expect(await tts.getVoices()).toEqual([
        { id: "a", name: "A", lang: "mul" },
      ]);
    });

    it("follows the cursor under one signal", async () => {
      answer((cursor) => (cursor ? page(["Ben"]) : page(["Ava"], "c/1")));

      expect(await tts.getVoices()).toEqual([voice("Ava"), voice("Ben")]);
      expect(urls()).toEqual([ownUrl(), listUrl(), listUrl("c%2F1")]);
      const signals = new Set(fetchMock.mock.calls.map(([, i]) => i?.signal));
      expect(signals.size).toBe(1);
    });

    it("stops each listing after 10 pages", async () => {
      answer(
        (cursor) => page([`Ava${cursor ?? ""}`], `${Number(cursor ?? 0) + 1}`),
        (cursor) => page([`Mine${cursor ?? ""}`], `${Number(cursor ?? 0) + 1}`),
      );

      expect(await tts.getVoices()).toHaveLength(20);
      expect(urls().filter((u) => u.includes("is_owner"))).toHaveLength(10);
      expect(urls().filter((u) => !u.includes("is_owner"))).toHaveLength(10);
    });
  });

  describe("generateBuffer", () => {
    const body = (init?: RequestInit) => {
      assert(typeof init?.body === "string");
      return JSON.parse(init.body);
    };

    it("speaks in the voice's base language", async () => {
      fetchMock.mockResolvedValue(new Response(Buffer.from("mp3")));

      const res = await tts.generateBuffer("Hola", "es-MX", "voice-1");

      expect(res).toEqual({ success: true, buffer: Buffer.from("mp3") });
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
        `${config.API_URL}/tts/bytes`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", ...headers },
          body: JSON.stringify({
            model_id: "sonic-3.6",
            transcript: "Hola",
            voice: { id: "voice-1" },
            output_format: {
              container: "mp3",
              sample_rate: 44100,
              bit_rate: 128000,
            },
            language: "es",
          }),
          signal: expect.any(AbortSignal),
        },
      );
    });

    it.each([["mul"], [undefined]])(
      "sends no language for %s",
      async (lang) => {
        fetchMock.mockResolvedValue(new Response(Buffer.from("mp3")));

        await tts.generateBuffer("Hello", lang, "voice-1");

        expect(body(fetchMock.mock.calls[0][1])).not.toHaveProperty("language");
      },
    );

    it("fails without a key, without asking", async () => {
      tts.setKey("");

      const res = await tts.generateBuffer("Hello", "en", "voice-1");

      expect(res.error).toMatchObject({ code: "missing_api_key" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([
      [
        "a message and code",
        { message: "Out of credits", code: "credits_exhausted" },
        402,
        "credits_exhausted",
        "Cartesia request failed: HTTP 402 credits_exhausted - Out of credits",
      ],
      [
        "an error object",
        { error: { message: "Plan can't clone", code: "plan_required" } },
        403,
        "plan_required",
        "Cartesia request failed: HTTP 403 plan_required - Plan can't clone",
      ],
      [
        // As a live free account answered a clone
        "a free plan, sent as a 402",
        {
          message:
            "This feature is not available on the free tier, please upgrade your subscription at (https://play.cartesia.ai/subscription) or contact us at support@cartesia.ai.",
        },
        402,
        "plan_required",
        "Cartesia request failed: HTTP 402 plan_required - This feature is not available on the free tier, please upgrade your subscription at (https://play.cartesia.ai/subscription) or contact us at support@cartesia.ai.",
      ],
      [
        "an error string",
        { error: "Invalid API key" },
        401,
        "http_401",
        "Cartesia request failed: HTTP 401 http_401 - Invalid API key",
      ],
      [
        "no JSON",
        "Bad Gateway",
        502,
        "http_502",
        "Cartesia request failed: HTTP 502 http_502",
      ],
    ])(
      "fails with the status and code of %s",
      async (_, errBody, status, code, message) => {
        fetchMock.mockResolvedValue(
          typeof errBody === "string"
            ? new Response(errBody, { status })
            : json(errBody, status),
        );

        const res = await tts.generateBuffer("Hello", "en", "voice-1");

        expect(res.error).toBeInstanceOf(TTSRequestError);
        expect(res.error).toMatchObject({ status, code, message });
      },
    );

    it("never puts the key in an error", async () => {
      fetchMock.mockResolvedValue(json({ error: { code: "x" } }, 401));

      const res = await tts.generateBuffer("Hello", "en", "voice-1");

      expect(inspect(res.error, { depth: Infinity })).not.toContain(KEY);
    });
  });

  describe("cloneVoice", () => {
    const samples = [{ name: "talk.MP3", data: new Uint8Array([1, 2]) }];

    it("uploads the clip, the name and the language", async () => {
      fetchMock.mockResolvedValue(json({ id: "new-id" }));

      const res = await tts.cloneVoice("My voice", samples, "es-419");

      expect(res).toEqual({ id: "new-id", verify: false });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`${config.API_URL}/voices/clone`);
      expect(init).toMatchObject({
        method: "POST",
        headers,
        signal: expect.any(AbortSignal),
      });
      const form = init?.body;
      assert(form instanceof FormData);
      expect(form.get("name")).toBe("My voice");
      expect(form.get("language")).toBe("es");
      const clip = form.get("clip");
      assert(clip instanceof File);
      expect([clip.name, clip.type, clip.size]).toEqual([
        "sample-1.mp3",
        "audio/mpeg",
        2,
      ]);
      expect(new Uint8Array(await clip.arrayBuffer())).toEqual(samples[0].data);
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
