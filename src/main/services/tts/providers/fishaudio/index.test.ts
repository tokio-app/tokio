import assert from "node:assert";
import { inspect } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TTSRequestError } from "../../common";
import config from "./config";
import { FishAudioTTS } from "./index";

const KEY = "fish_secret-key";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

let fetchMock: ReturnType<typeof vi.fn<Fetch>>;

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });

const item = (
  name: string,
  extra: { type?: string; state?: string; languages?: string[] } = {},
) => ({
  _id: `id-${name}`,
  type: "tts",
  state: "trained",
  title: name,
  ...extra,
});

const page = (
  items: ReturnType<typeof item>[],
  extra: { total?: number; has_more?: boolean | null } = {},
) => json({ total: items.length, items, ...extra });

const full = () =>
  Array.from({ length: config.PAGE_SIZE }, (_, i) => item(`v${i}`));

const voice = (name: string) => ({ id: `id-${name}`, name, lang: "mul" });

const listUrl = (n = 1) =>
  `${config.API_URL}/model?self=true&page_size=100&page_number=${n}`;
const libraryUrl = (n = 1) =>
  `${config.API_URL}/model?licensed=true&sort_by=task_count&page_size=100&page_number=${n}`;

describe("FishAudioTTS", () => {
  let tts: FishAudioTTS;

  beforeEach(() => {
    fetchMock = vi.fn<Fetch>();
    vi.stubGlobal("fetch", fetchMock);
    tts = new FishAudioTTS();
    tts.setKey(KEY);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("getVoices", () => {
    // The account's listing and the library's answer apart
    const answer = (
      own: (n: number) => Response,
      library: (n: number) => Response = () => page([]),
    ) =>
      fetchMock.mockImplementation(async (url) => {
        const n = Number(new URL(url).searchParams.get("page_number"));
        return url.includes("self=true") ? own(n) : library(n);
      });
    const urls = () => fetchMock.mock.calls.map(([url]) => url);

    it("lists the account's trained voices as multilingual, and the library's licensed ones", async () => {
      answer(
        () =>
          page([
            item("Ava"),
            item("Svc", { type: "svc" }),
            item("Training", { state: "training" }),
            item("Failed", { state: "failed" }),
            item("Created", { state: "created" }),
          ]),
        () =>
          page([
            item("Lina", { languages: ["es"] }),
            item("Duo", { languages: ["en", "ja"] }),
            item("None"),
            // Also the account's: listed once
            item("Ava", { languages: ["en"] }),
          ]),
      );

      expect(await tts.getVoices()).toEqual([
        voice("Ava"),
        { id: "id-Lina", name: "Lina", lang: "es" },
        voice("Duo"),
        voice("None"),
      ]);
      const init = {
        method: "GET",
        headers: { Authorization: `Bearer ${KEY}` },
        signal: expect.any(AbortSignal),
      };
      expect(fetchMock).toHaveBeenCalledWith(listUrl(), init);
      expect(fetchMock).toHaveBeenCalledWith(libraryUrl(), init);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it("follows the pages under one deadline", async () => {
      const timeout = vi.spyOn(AbortSignal, "timeout");
      answer((n) =>
        n === 1
          ? page(full(), { total: 101, has_more: true })
          : page([item("Last")], { total: 101 }),
      );

      const voices = await tts.getVoices();

      expect(voices).toHaveLength(101);
      expect(voices.at(-1)).toEqual(voice("Last"));
      expect(urls()).toEqual([listUrl(1), libraryUrl(1), listUrl(2)]);
      expect(timeout).toHaveBeenCalledExactlyOnceWith(config.LIST_TIMEOUT_MS);
      const signals = new Set(fetchMock.mock.calls.map(([, i]) => i?.signal));
      expect(signals.size).toBe(1);
    });

    it.each([
      ["has_more is false", { total: 500, has_more: false }, full],
      ["a page is short", { total: 500 }, () => [item("Ava")]],
      ["the pages reach the total", { total: 100, has_more: null }, full],
    ])("stops when %s", async (_, extra, items) => {
      answer(() => page(items(), extra));

      await tts.getVoices();

      expect(urls()).toEqual([listUrl(1), libraryUrl(1)]);
    });

    it("stops after 10 pages of the account's, and 3 of the library's", async () => {
      const more = () => page(full(), { total: 5000, has_more: true });
      answer(more, () =>
        page(
          Array.from({ length: config.PAGE_SIZE }, (_, i) => item(`lib${i}`)),
          { total: 5000, has_more: true },
        ),
      );

      expect(await tts.getVoices()).toHaveLength(1300);
      expect(urls().filter((u) => u.includes("self=true"))).toHaveLength(10);
      expect(urls().filter((u) => u.includes("licensed=true"))).toHaveLength(3);
    });
  });

  describe("generateBuffer", () => {
    it("asks for the voice's mp3 by its id, without a language", async () => {
      fetchMock.mockResolvedValue(new Response(Buffer.from("mp3")));

      const res = await tts.generateBuffer("Hello", "en", "voice/1");

      expect(res).toEqual({ success: true, buffer: Buffer.from("mp3") });
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
        `${config.API_URL}/v1/tts`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            model: "s2.1-pro",
            Authorization: `Bearer ${KEY}`,
          },
          body: JSON.stringify({
            text: "Hello",
            reference_id: "voice/1",
            format: "mp3",
            mp3_bitrate: 128,
            latency: "normal",
          }),
          signal: expect.any(AbortSignal),
        },
      );
    });

    it("fails without a key, without asking", async () => {
      tts.setKey("");

      const res = await tts.generateBuffer("Hello", "en", "voice-1");

      expect(res.error).toMatchObject({ code: "missing_api_key" });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("fails with the status, and the message and reason", async () => {
      fetchMock.mockResolvedValue(
        json(
          { status: 402, message: "Insufficient balance", reason: "no_credit" },
          402,
        ),
      );

      const res = await tts.generateBuffer("Hello", "en", "voice-1");

      expect(res.error).toBeInstanceOf(TTSRequestError);
      expect(res.error).toMatchObject({
        engine: "Fish Audio",
        status: 402,
        code: "http_402",
        message:
          "Fish Audio request failed: HTTP 402 http_402 - Insufficient balance (no_credit)",
      });
    });

    it("leaves out a reason that isn't text", async () => {
      fetchMock.mockResolvedValue(
        json({ status: 429, message: "Too many requests", reason: 1 }, 429),
      );

      const res = await tts.generateBuffer("Hello", "en", "voice-1");

      expect(res.error?.message).toBe(
        "Fish Audio request failed: HTTP 429 http_429 - Too many requests",
      );
    });

    it("fails with only the status when the body isn't JSON", async () => {
      fetchMock.mockResolvedValue(new Response("Bad Gateway", { status: 502 }));

      const res = await tts.generateBuffer("Hello", "en", "voice-1");

      expect(res.error).toMatchObject({
        status: 502,
        code: "http_502",
        message: "Fish Audio request failed: HTTP 502 http_502",
      });
    });

    it("never puts the key in an error", async () => {
      fetchMock.mockResolvedValue(
        json({ status: 401, message: "Unauthorized" }, 401),
      );

      const res = await tts.generateBuffer("Hello", "en", "voice-1");

      expect(inspect(res.error, { depth: Infinity })).not.toContain(KEY);
    });
  });

  describe("cloneVoice", () => {
    const samples = [
      { name: "talk.MP3", data: new Uint8Array([1, 2]) },
      { name: "Recording 1.webm", data: new Uint8Array([3]) },
    ];

    it("uploads the fields and each sample, numbered and typed by its extension", async () => {
      fetchMock.mockResolvedValue(
        json({ _id: "new-id", state: "trained" }, 201),
      );

      const res = await tts.cloneVoice("My voice", samples, "en");

      expect(res).toEqual({ id: "new-id", verify: false });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(`${config.API_URL}/model`);
      expect(init).toMatchObject({
        method: "POST",
        headers: { Authorization: `Bearer ${KEY}` },
        signal: expect.any(AbortSignal),
      });
      const form = init?.body;
      assert(form instanceof FormData);
      expect(form.get("type")).toBe("tts");
      expect(form.get("title")).toBe("My voice");
      expect(form.get("train_mode")).toBe("fast");
      expect(form.get("visibility")).toBe("private");
      const files = form.getAll("voices").filter((f) => f instanceof File);
      expect(files.map((f) => [f.name, f.type, f.size])).toEqual([
        ["sample-1.mp3", "audio/mpeg", 2],
        ["sample-2.webm", "audio/webm", 1],
      ]);
      expect(new Uint8Array(await files[0].arrayBuffer())).toEqual(
        samples[0].data,
      );
    });

    it("fails as unusable samples when the training failed", async () => {
      fetchMock.mockResolvedValue(
        json({ _id: "new-id", state: "failed" }, 201),
      );

      const error = await tts
        .cloneVoice("Me", samples, "en")
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(TTSRequestError);
      expect(error).toMatchObject({
        code: "training_failed",
        status: 422,
        message: "Fish Audio couldn't train the voice.",
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
