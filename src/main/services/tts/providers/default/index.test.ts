import { inspect } from "node:util";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prepareText, VoicesData } from "./common";
import config from "./config";
import { TikTokTTS } from "./index";

const b64 = (text: string) => Buffer.from(text).toString("base64");

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });

const STATUS_MESSAGES: [number, string][] = [
  [1, "Authentication failed: The provided TikTok session ID is invalid"],
  [2, "Payload too large: The requested text exceeds"],
  [
    4,
    "Invalid configuration: The specified voice speaker ID is not recognized",
  ],
  [5, "Missing credentials: A TikTok session ID is required"],
  [3, "An unexpected API error occurred while processing the TTS request."],
  [-1, "An unexpected API error occurred while processing the TTS request."],
];

// The code under test calls fetch with a URL string and a string body.
type Fetch = (
  url: string,
  init?: RequestInit & { body?: string },
) => Promise<Response>;

let fetchMock: ReturnType<typeof vi.fn<Fetch>>;

const lastUrl = () => new URL(fetchMock.mock.lastCall?.[0] ?? "");

// An error that carries the session cookie, as a failed request's could.
const withCookie = (message: string) =>
  Object.assign(new Error(message), {
    headers: { Cookie: "sessionid=session-123" },
  });

describe("TikTokTTS", () => {
  let tts: TikTokTTS;

  beforeEach(() => {
    fetchMock = vi.fn<Fetch>();
    vi.stubGlobal("fetch", fetchMock);
    tts = new TikTokTTS();
  });

  describe("without a Session ID", () => {
    it("asks the public endpoint and decodes the audio", async () => {
      fetchMock.mockResolvedValue(json({ success: true, data: b64("mp3") }));

      const res = await tts.generateBuffer("Hello there", "en", "Jessie");

      expect(res).toEqual({ success: true, buffer: Buffer.from("mp3") });
      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(config.API_URL_ALT, {
        method: "POST",
        headers: config.HEADERS,
        body: JSON.stringify({ text: "Hello there", voice: "en_us_002" }),
        signal: expect.any(AbortSignal),
      });
    });

    it("fails with the error of an unsuccessful response", async () => {
      fetchMock.mockResolvedValue(
        json({ success: false, error: "Text too long" }),
      );

      const res = await tts.generateBuffer("Hello", "en", "Jessie");

      expect(res.success).toBe(false);
      expect(res.error?.message).toBe("TTS generation failed: Text too long");
    });

    it("fails with the error in an HTTP error's body", async () => {
      fetchMock.mockResolvedValue(
        json({ success: false, error: "Rate limited" }, 429),
      );

      const res = await tts.generateBuffer("Hello", "en", "Jessie");

      expect(res.success).toBe(false);
      expect(res.error?.message).toBe("TTS generation failed: Rate limited");
    });

    it("fails with the status of an HTTP error without a JSON body", async () => {
      fetchMock.mockResolvedValue(new Response("Bad Gateway", { status: 502 }));

      const res = await tts.generateBuffer("Hello", "en", "Jessie");

      expect(res.success).toBe(false);
      expect(res.error?.message).toBe("TTS generation failed: HTTP 502");
    });

    it("returns a network error as it is", async () => {
      const error = new TypeError("fetch failed");
      fetchMock.mockRejectedValue(error);

      await expect(
        tts.generateBuffer("Hello", "en", "Jessie"),
      ).resolves.toEqual({
        success: false,
        error,
      });
    });

    it("turns a thrown value that isn't an Error into one", async () => {
      fetchMock.mockRejectedValue("offline");

      const res = await tts.generateBuffer("Hello", "en", "Jessie");

      expect(res.error).toBeInstanceOf(Error);
      expect(res.error?.message).toBe("offline");
    });
  });

  describe("with a Session ID", () => {
    beforeEach(() => {
      tts.setKey("session-123");
    });

    it("asks the TikTok API with the session cookie and decodes the audio", async () => {
      fetchMock.mockResolvedValue(
        json({ status_code: 0, data: { v_str: b64("mp3") } }),
      );

      const res = await tts.generateBuffer("Hello there", "en", "Jessie");

      expect(res).toEqual({ success: true, buffer: Buffer.from("mp3") });
      const [url, init] = fetchMock.mock.calls[0];
      expect(url.startsWith(`${config.API_URL}/?`)).toBe(true);
      expect(init).toEqual({
        method: "POST",
        headers: { ...config.HEADERS, Cookie: "sessionid=session-123" },
        signal: expect.any(AbortSignal),
      });
      expect(Object.fromEntries(lastUrl().searchParams)).toEqual({
        text_speaker: "en_us_002",
        req_text: "Hello there",
        speaker_map_type: "0",
        aid: "1233",
      });
    });

    it.each(STATUS_MESSAGES)(
      "fails with the message for status %i in the response",
      async (status, message) => {
        fetchMock.mockResolvedValue(json({ status_code: status, data: null }));

        const res = await tts.generateBuffer("Hello", "en", "Jessie");

        expect(res.success).toBe(false);
        expect(res.error?.message).toContain(message);
        expect(res.error).toMatchObject({ statusCode: status });
      },
    );

    it.each(STATUS_MESSAGES)(
      "fails with the message for status %i in an HTTP error",
      async (status, message) => {
        fetchMock.mockResolvedValue(json({ status_code: status }, 400));

        const res = await tts.generateBuffer("Hello", "en", "Jessie");

        expect(res.success).toBe(false);
        expect(res.error?.message).toContain(message);
        expect(res.error).toMatchObject({ statusCode: status });
      },
    );

    it("fails with its own error for an HTTP error without a status code", async () => {
      fetchMock.mockResolvedValue(new Response("Bad Gateway", { status: 502 }));

      const res = await tts.generateBuffer("Hello", "en", "Jessie");

      expect(res.success).toBe(false);
      expect(res.error?.message).toBe("TikTok TTS request failed: HTTP 502");
    });

    it("keeps the session cookie out of a failed request's error", async () => {
      fetchMock.mockRejectedValue(
        new TypeError("fetch failed", {
          cause: withCookie("connect ETIMEDOUT"),
        }),
      );

      const res = await tts.generateBuffer("Hello", "en", "Jessie");

      expect(res.error?.message).toBe(
        "TikTok TTS request failed: fetch failed -- cause: connect ETIMEDOUT",
      );
      expect(inspect(res.error)).not.toContain("session-123");
    });

    it("keeps the session cookie out of an error reading the audio", async () => {
      const response = json({});
      vi.spyOn(response, "json").mockRejectedValue(withCookie("terminated"));
      fetchMock.mockResolvedValue(response);

      const res = await tts.generateBuffer("Hello", "en", "Jessie");

      expect(res.error?.message).toBe("TikTok TTS request failed: terminated");
      expect(inspect(res.error)).not.toContain("session-123");
    });

    it("speaks English when no language is given", async () => {
      fetchMock.mockImplementation(async () =>
        json({ status_code: 0, data: { v_str: b64("mp3") } }),
      );

      await tts.generateBuffer("1 + 1", undefined, "Jessie");
      expect(lastUrl().searchParams.get("req_text")).toBe("1 plus 1");

      await tts.generateBuffer("1 + 1", "es", "Juan");
      expect(lastUrl().searchParams.get("req_text")).toBe("1 mas 1");
      expect(lastUrl().searchParams.get("text_speaker")).toBe("es_mx_002");
    });

    it("keeps the whole text in the request", async () => {
      fetchMock.mockResolvedValue(
        json({ status_code: 0, data: { v_str: b64("mp3") } }),
      );

      await tts.generateBuffer("We're #1 & proud", "en", "Jessie");

      const params = lastUrl().searchParams;
      expect(params.get("req_text")).toBe("We're #1 and proud");
      expect(params.get("aid")).toBe("1233");
    });
  });

  describe("voices", () => {
    it("uses the default voice for an unknown or missing voice", async () => {
      fetchMock.mockImplementation(async () =>
        json({ success: true, data: b64("mp3") }),
      );

      await tts.generateBuffer("Hi", "en", "Emma Multilingual");
      await tts.generateBuffer("Hi", "en");

      expect(
        fetchMock.mock.calls.map(([, init]) => JSON.parse(init?.body ?? "")),
      ).toEqual([
        { text: "Hi", voice: config.DEFAULT_VOICE },
        { text: "Hi", voice: config.DEFAULT_VOICE },
      ]);
    });

    it("lists every voice with its language", () => {
      const voices = tts.getVoices();

      expect(voices).toHaveLength(Object.keys(VoicesData).length);
      expect(voices).toContainEqual({ name: "Default", lang: "en" });
      expect(voices).toContainEqual({ name: "Jessie", lang: "en" });
      expect(voices).toContainEqual({ name: "Pedro", lang: "es" });
      expect(voices).toContainEqual({ name: "Juan", lang: "es" });
    });

    it("takes a Session ID", () => {
      expect(tts.keyLabel).toBe("Session ID");
    });
  });
});

describe("prepareText", () => {
  it("spells out + and & in the language", () => {
    expect(prepareText("1 + 1 & 2", "en")).toBe("1+plus+1+and+2");
    expect(prepareText("1 + 1 & 2", "es")).toBe("1+mas+1+y+2");
  });

  it("turns every whitespace character into +", () => {
    expect(prepareText("a b\tc\nd  e", "en")).toBe("a+b+c+d++e");
  });

  it("uses English for an unknown language", () => {
    expect(prepareText("a+b&c", "fr")).toBe("aplusbandc");
  });
});
