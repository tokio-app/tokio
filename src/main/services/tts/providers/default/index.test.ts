import { AxiosError, AxiosHeaders } from "axios";
import { inspect } from "node:util";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prepareText, VoicesData } from "./common";
import config from "./config";
import { TikTokTTS } from "./index";

const { post } = vi.hoisted(() => ({
  post: vi.fn<
    (
      url: string,
      body: unknown,
      options: { headers: Record<string, string>; timeout?: number },
    ) => Promise<{ data: unknown }>
  >(),
}));

vi.mock("axios", async (importOriginal) => ({
  ...(await importOriginal<typeof import("axios")>()),
  default: { post },
}));

const b64 = (text: string) => Buffer.from(text).toString("base64");

const httpError = (data: unknown) =>
  new AxiosError("Request failed", "ERR_BAD_REQUEST", undefined, null, {
    status: 400,
    statusText: "Bad Request",
    data,
    headers: {},
    config: { headers: new AxiosHeaders() },
  });

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

const lastUrl = () => new URL(post.mock.lastCall?.[0] ?? "");

describe("TikTokTTS", () => {
  let tts: TikTokTTS;

  beforeEach(() => {
    post.mockReset();
    tts = new TikTokTTS();
  });

  describe("without a Session ID", () => {
    it("asks the public endpoint and decodes the audio", async () => {
      post.mockResolvedValue({ data: { success: true, data: b64("mp3") } });

      const res = await tts.generateBuffer("Hello there", "en", "Jessie");

      expect(res).toEqual({ success: true, buffer: Buffer.from("mp3") });
      expect(post).toHaveBeenCalledExactlyOnceWith(
        config.API_URL_ALT,
        { text: "Hello there", voice: "en_us_002" },
        { headers: config.HEADERS, timeout: config.REQUEST_TIMEOUT_MS },
      );
    });

    it("fails with the error of an unsuccessful response", async () => {
      post.mockResolvedValue({
        data: { success: false, error: "Text too long" },
      });

      const res = await tts.generateBuffer("Hello", "en", "Jessie");

      expect(res.success).toBe(false);
      expect(res.error?.message).toBe("TTS generation failed: Text too long");
    });

    it("fails with the error in an HTTP error's body", async () => {
      const error = httpError({ success: false, error: "Rate limited" });
      post.mockRejectedValue(error);

      const res = await tts.generateBuffer("Hello", "en", "Jessie");

      expect(res.success).toBe(false);
      expect(res.error?.message).toBe("TTS generation failed: Rate limited");
      expect(res.error?.cause).toBe(error);
    });

    it("returns a network error as it is", async () => {
      const error = new AxiosError("connect ECONNREFUSED", "ECONNREFUSED");
      post.mockRejectedValue(error);

      await expect(
        tts.generateBuffer("Hello", "en", "Jessie"),
      ).resolves.toEqual({
        success: false,
        error,
      });
    });
  });

  describe("with a Session ID", () => {
    beforeEach(() => {
      tts.setKey("session-123");
    });

    it("asks the TikTok API with the session cookie and decodes the audio", async () => {
      post.mockResolvedValue({
        data: { status_code: 0, data: { v_str: b64("mp3") } },
      });

      const res = await tts.generateBuffer("Hello there", "en", "Jessie");

      expect(res).toEqual({ success: true, buffer: Buffer.from("mp3") });
      const [url, body, options] = post.mock.calls[0];
      expect(url.startsWith(`${config.API_URL}/?`)).toBe(true);
      expect(body).toBeNull();
      expect(options.headers).toEqual({
        ...config.HEADERS,
        Cookie: "sessionid=session-123",
      });
      expect(options.timeout).toBe(config.REQUEST_TIMEOUT_MS);
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
        post.mockResolvedValue({ data: { status_code: status, data: null } });

        const res = await tts.generateBuffer("Hello", "en", "Jessie");

        expect(res.success).toBe(false);
        expect(res.error?.message).toContain(message);
        expect(res.error).toMatchObject({ statusCode: status });
      },
    );

    it.each(STATUS_MESSAGES)(
      "fails with the message for status %i in an HTTP error",
      async (status, message) => {
        post.mockRejectedValue(httpError({ status_code: status }));

        const res = await tts.generateBuffer("Hello", "en", "Jessie");

        expect(res.success).toBe(false);
        expect(res.error?.message).toContain(message);
        expect(res.error).toMatchObject({ statusCode: status });
      },
    );

    it("fails with its own error for an HTTP error without a status code", async () => {
      post.mockRejectedValue(httpError("Bad Gateway"));

      const res = await tts.generateBuffer("Hello", "en", "Jessie");

      expect(res.success).toBe(false);
      expect(res.error?.message).toBe(
        "TikTok TTS request failed: Request failed",
      );
    });

    it("keeps the session cookie out of a failed request's error", async () => {
      post.mockRejectedValue(
        new AxiosError("timeout of 10000ms exceeded", "ECONNABORTED", {
          headers: new AxiosHeaders({ Cookie: "sessionid=session-123" }),
        }),
      );

      const res = await tts.generateBuffer("Hello", "en", "Jessie");

      expect(res.error?.message).toContain("timeout of 10000ms exceeded");
      expect(inspect(res.error)).not.toContain("session-123");
    });

    it("speaks English when no language is given", async () => {
      post.mockResolvedValue({
        data: { status_code: 0, data: { v_str: b64("mp3") } },
      });

      await tts.generateBuffer("1 + 1", undefined, "Jessie");
      expect(lastUrl().searchParams.get("req_text")).toBe("1 plus 1");

      await tts.generateBuffer("1 + 1", "es", "Juan");
      expect(lastUrl().searchParams.get("req_text")).toBe("1 mas 1");
      expect(lastUrl().searchParams.get("text_speaker")).toBe("es_mx_002");
    });

    it("keeps the whole text in the request", async () => {
      post.mockResolvedValue({
        data: { status_code: 0, data: { v_str: b64("mp3") } },
      });

      await tts.generateBuffer("We're #1 & proud", "en", "Jessie");

      const params = lastUrl().searchParams;
      expect(params.get("req_text")).toBe("We're #1 and proud");
      expect(params.get("aid")).toBe("1233");
    });
  });

  describe("voices", () => {
    it("uses the default voice for an unknown or missing voice", async () => {
      post.mockResolvedValue({ data: { success: true, data: b64("mp3") } });

      await tts.generateBuffer("Hi", "en", "Emma Multilingual");
      await tts.generateBuffer("Hi", "en");

      expect(post.mock.calls.map(([, body]) => body)).toEqual([
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
