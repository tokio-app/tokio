import { once } from "node:events";
import { IncomingMessage } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RawData,
  WebSocket,
  WebSocketServer,
  type ServerOptions,
  type VerifyClientCallbackAsync,
} from "ws";
import { createConfig } from "../config";
import type { EdgeConfig, EdgeVoice } from "../types";

// drm.ts keeps the clock skew between calls, so every test gets a fresh copy.
let protocol: typeof import("./protocol");
let EdgeTTSError: typeof import("./errors").EdgeTTSError;

const VOICE = "es-MX-JorgeNeural";
const SERVER_DATE = "Mon, 19 Oct 2026 12:00:00 GMT";

async function failure(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    if (error instanceof EdgeTTSError) return error;
    throw error;
  }
  throw new Error("Expected an EdgeTTSError");
}

// Size of a chunk once synthesize escapes it.
const escapedSize = (text: string) =>
  Buffer.byteLength(
    text
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&apos;"),
  );

describe("chunkText", () => {
  beforeEach(async () => {
    protocol = await import("./protocol");
  });

  it("keeps every chunk's escaped UTF-8 size within the limit", () => {
    const text = `Tom & Jerry's <best> "day" — café 😀 ñandú `.repeat(20);

    for (const maxBytes of [6, 8, 13, 15, 40, 100, 4096]) {
      const chunks = protocol.chunkText(text, maxBytes);

      expect(chunks.length).toBeGreaterThan(0);
      for (const chunk of chunks) {
        expect(escapedSize(chunk)).toBeLessThanOrEqual(maxBytes);
        // A cut character would come back as U+FFFD
        expect(Buffer.from(chunk).toString()).toBe(chunk);
      }
      expect(chunks.join("").replace(/\s/g, "")).toBe(text.replace(/\s/g, ""));
    }
  });

  it("packs whole words with single spaces", () => {
    expect(protocol.chunkText("  one   two\n\nthree\tfour ", 100)).toEqual([
      "one two three four",
    ]);
    expect(protocol.chunkText("aa bb cc dd ee", 5)).toEqual([
      "aa bb",
      "cc dd",
      "ee",
    ]);
  });

  it("counts XML entities by their escaped size and never cuts them", () => {
    // Unescaped, "<a> <b>" would fit in 7 bytes
    expect(protocol.chunkText("<a> <b>", 9)).toEqual(["<a>", "<b>"]);
    expect(protocol.chunkText(`"x" 'y'`, 13)).toEqual([`"x"`, `'y'`]);
    expect(protocol.chunkText("&&&&&", 12)).toEqual(["&&", "&&", "&"]);
    expect(protocol.chunkText("a&b", 6)).toEqual(["a&", "b"]);
  });

  it("never cuts a multibyte character", () => {
    expect(protocol.chunkText("😀😀😀", 9)).toEqual(["😀😀", "😀"]);
    expect(protocol.chunkText("ééé", 3)).toEqual(["é", "é", "é"]);
    expect(protocol.chunkText("naïve", 4)).toEqual(["naï", "ve"]);
  });

  it("splits a word over the limit between characters", () => {
    expect(protocol.chunkText("abcdefghij", 4)).toEqual(["abcd", "efgh", "ij"]);
    expect(protocol.chunkText("hi abcdefghij yo", 4)).toEqual([
      "hi",
      "abcd",
      "efgh",
      "ij",
      "yo",
    ]);
  });

  it("returns nothing for blank text", () => {
    expect(protocol.chunkText("", 100)).toEqual([]);
    expect(protocol.chunkText(" \n\t  ", 100)).toEqual([]);
  });
});

type Frame = { data: string; isBinary: boolean };
type Connection = {
  url: URL;
  headers: IncomingMessage["headers"];
  frames: Frame[];
};
type Turn = (socket: WebSocket, ssml: string) => void;

const toText = (raw: RawData) =>
  (Buffer.isBuffer(raw)
    ? raw
    : Array.isArray(raw)
      ? Buffer.concat(raw)
      : Buffer.from(raw)
  ).toString("utf8");

const textFrame = (path: string, body = "{}") =>
  `X-RequestId:0123\r\nContent-Type:application/json; charset=utf-8\r\nPath:${path}\r\n\r\n${body}`;

// 2-byte big-endian header length, headers, then the data.
const binaryFrame = (
  data: string | Buffer,
  headers = "Path:audio\r\nContent-Type:audio/mpeg\r\n",
  headerLength?: number,
) => {
  const head = Buffer.from(`X-RequestId:0123\r\n${headers}`);
  const length = Buffer.alloc(2);
  length.writeUInt16BE(headerLength ?? head.length);
  return Buffer.concat([length, head, Buffer.from(data)]);
};

// The text the client asked to speak, still escaped.
const spoken = (ssml: string) =>
  /<prosody[^>]*>(.*)<\/prosody>/s.exec(ssml)?.[1] ?? "";

const speak = (...audio: string[]): Turn => {
  return (socket) => {
    socket.send(textFrame("turn.start"));
    for (const data of audio) socket.send(binaryFrame(data));
    socket.send(textFrame("turn.end"));
  };
};

describe("synthesize", () => {
  let server: WebSocketServer | undefined;
  let connections: Connection[];
  let handshakes: URL[];

  // A local Read Aloud service: `turn` answers each ssml message.
  async function listen(
    turn: Turn,
    options: Pick<ServerOptions, "verifyClient"> = {},
    overrides: Partial<EdgeConfig> = {},
  ): Promise<EdgeConfig> {
    const wss = new WebSocketServer({ host: "127.0.0.1", port: 0, ...options });
    server = wss;
    wss.on("connection", (socket, req) => {
      const connection: Connection = {
        url: new URL(req.url ?? "", "ws://127.0.0.1"),
        headers: req.headers,
        frames: [],
      };
      connections.push(connection);
      socket.on("message", (raw, isBinary) => {
        const data = toText(raw);
        connection.frames.push({ data, isBinary });
        if (data.includes("Path:ssml")) turn(socket, data);
      });
    });
    await once(wss, "listening");
    const address = wss.address();
    if (!address || typeof address === "string")
      throw new Error("Expected a TCP server");
    return {
      ...createConfig(),
      WSS_URL: `ws://127.0.0.1:${address.port}/?TrustedClientToken=x`,
      REQUEST_TIMEOUT_MS: 2000,
      ...overrides,
    };
  }

  // Rejects handshakes while `reject` returns a status, recording each one.
  const verifyClient =
    (
      reject: (url: URL, attempt: number) => number | null,
      headers: Record<string, string> = { Date: SERVER_DATE },
    ): VerifyClientCallbackAsync =>
    (info, cb) => {
      const url = new URL(info.req.url ?? "", "ws://127.0.0.1");
      handshakes.push(url);
      const status = reject(url, handshakes.length);
      if (status === null) cb(true);
      else cb(false, status, undefined, headers);
    };

  beforeEach(async () => {
    vi.resetModules();
    protocol = await import("./protocol");
    ({ EdgeTTSError } = await import("./errors"));
    connections = [];
    handshakes = [];
  });

  afterEach(async () => {
    if (!server) return;
    for (const client of server.clients) client.terminate();
    await new Promise((resolve) => server?.close(resolve));
    server = undefined;
  });

  it("sends the speech config, then the SSML with the voice and the escaped text", async () => {
    const cfg = await listen(speak("mp3"));

    await protocol.synthesize(cfg, `Tom & "Jerry" <3 'x'`, VOICE);

    const [config, ssml] = connections[0].frames;
    expect(connections[0].frames).toHaveLength(2);
    expect(config.isBinary).toBe(false);
    expect(config.data).toContain("Path:speech.config\r\n");
    expect(config.data).toContain(`"outputFormat":"${cfg.OUTPUT_FORMAT}"`);
    expect(ssml.isBinary).toBe(false);
    expect(ssml.data).toContain("Path:ssml\r\n");
    expect(ssml.data).toContain(`<voice name='${VOICE}'>`);
    expect(spoken(ssml.data)).toBe(
      "Tom &amp; &quot;Jerry&quot; &lt;3 &apos;x&apos;",
    );
  });

  it("connects with the auth query, the Origin and a muid cookie", async () => {
    const cfg = await listen(speak("mp3"));

    await protocol.synthesize(cfg, "Hola", VOICE);

    const { url, headers } = connections[0];
    expect(url.searchParams.get("TrustedClientToken")).toBe("x");
    expect(url.searchParams.get("ConnectionId")).toMatch(/^[0-9a-f]{32}$/);
    expect(url.searchParams.get("Sec-MS-GEC")).toMatch(
      /^[0-9A-F]{16}-[0-9A-F]{64}$/,
    );
    expect(url.searchParams.get("Sec-MS-GEC-Version")).toBe(
      `2-${cfg.CHROMIUM_FULL_VERSION}`,
    );
    expect(headers.origin).toBe(cfg.ORIGIN);
    expect(headers.cookie).toMatch(/^muid=[0-9A-F]{32};$/);
  });

  it("replaces control characters with spaces", async () => {
    const cfg = await listen(speak("mp3"));

    await protocol.synthesize(cfg, "a\u0001b\u000Bc\u001Fd", VOICE);

    expect(spoken(connections[0].frames[1].data)).toBe("a b c d");
  });

  it("joins the audio frames until the turn ends", async () => {
    const cfg = await listen((socket) => {
      socket.send(textFrame("response"));
      socket.send(textFrame("turn.start"));
      socket.send(binaryFrame("abc"));
      socket.send(textFrame("audio.metadata", '{"Metadata":[]}'));
      socket.send(binaryFrame("def"));
      socket.send(binaryFrame("", "Path:audio\r\n")); // End of stream
      socket.send(textFrame("turn.end"));
    });

    const audio = await protocol.synthesize(cfg, "Hola", VOICE);

    expect(audio.toString()).toBe("abcdef");
  });

  it("sends long text as several chunks and joins their audio", async () => {
    const cfg = await listen(
      (socket, ssml) => speak(`[${spoken(ssml)}]`)(socket, ssml),
      {},
      { MAX_CHUNK_BYTES: 10 },
    );

    const audio = await protocol.synthesize(
      cfg,
      "one two three four five",
      VOICE,
    );

    expect(connections.map((c) => spoken(c.frames[1].data))).toEqual([
      "one two",
      "three four",
      "five",
    ]);
    expect(audio.toString()).toBe("[one two][three four][five]");
  });

  describe("errors", () => {
    it("fails with no-audio when the turn ends without audio", async () => {
      const cfg = await listen(speak());

      const error = await failure(protocol.synthesize(cfg, "Hola", VOICE));

      expect(error.stage).toBe("no-audio");
      expect(error.message).toContain(`No audio received for voice "${VOICE}"`);
      expect(error.auth).toEqual({
        tokenVersion: "2",
        gecVersion: `2-${cfg.CHROMIUM_FULL_VERSION}`,
      });
    });

    it.each([
      [
        "a binary frame shorter than 2 bytes",
        Buffer.from([0]),
        "Binary frame without header length",
      ],
      [
        "a truncated header",
        binaryFrame("", "Path:audio\r\n", 500),
        "Binary frame header is truncated",
      ],
      [
        "an unexpected path",
        binaryFrame("abc", "Path:video\r\n"),
        'Unexpected binary path "video"',
      ],
      [
        "the wrong content type",
        binaryFrame("abc", "Path:audio\r\nContent-Type:audio/ogg\r\n"),
        "Unexpected audio frame (Content-Type audio/ogg, 3 bytes)",
      ],
      [
        "an empty audio frame with a content type",
        binaryFrame(""),
        "Unexpected audio frame (Content-Type audio/mpeg, 0 bytes)",
      ],
    ])("fails on %s", async (_name, frame, message) => {
      const cfg = await listen((socket) => {
        socket.send(binaryFrame("abc"));
        socket.send(frame);
        socket.send(textFrame("turn.end"));
      });

      const error = await failure(protocol.synthesize(cfg, "Hola", VOICE));

      expect(error.stage).toBe("synthesis");
      expect(error.message).toContain(message);
    });

    it("fails when the socket closes before the turn ends", async () => {
      const cfg = await listen((socket) => {
        socket.send(binaryFrame("abc"));
        socket.close(1007, `Unsupported voice ${VOICE}`);
      });

      const error = await failure(protocol.synthesize(cfg, "Hola", VOICE));

      expect(error.stage).toBe("synthesis");
      expect(error.message).toContain(
        `Socket closed before the turn ended (code 1007, Unsupported voice ${VOICE})`,
      );
    });

    it("fails without connecting when there's nothing to say", async () => {
      const cfg = await listen(speak("mp3"));

      for (const text of ["", "  \n\t ", "\u0001\u0002"]) {
        const error = await failure(protocol.synthesize(cfg, text, VOICE));
        expect(error.stage).toBe("synthesis");
        expect(error.message).toContain("Nothing to synthesize");
      }
      expect(connections).toHaveLength(0);
    });

    it("times out when the service doesn't answer", async () => {
      const cfg = await listen(() => {}, {}, { REQUEST_TIMEOUT_MS: 100 });

      const error = await failure(protocol.synthesize(cfg, "Hola", VOICE));

      expect(error.stage).toBe("timeout");
      expect(error.message).toContain("No response from the service");
    });

    it("fails with the status and the server date of a rejected handshake", async () => {
      const cfg = await listen(speak("mp3"), {
        verifyClient: verifyClient(() => 429),
      });

      const error = await failure(protocol.synthesize(cfg, "Hola", VOICE));

      expect(error.stage).toBe("handshake");
      expect(error.status).toBe(429);
      expect(error.serverDate).toBe(SERVER_DATE);
      expect(error.message).toContain("HTTP 429");
      expect(handshakes).toHaveLength(1);
      expect(connections).toHaveLength(0);
    });
  });

  describe("handshake retry", () => {
    it("retries a 403 with a server date after correcting the clock", async () => {
      const cfg = await listen(speak("mp3"), {
        verifyClient: verifyClient(
          (_url, attempt) => (attempt === 1 ? 403 : null),
          {
            Date: new Date().toUTCString(),
          },
        ),
      });

      const audio = await protocol.synthesize(cfg, "Hola", VOICE);

      expect(audio.toString()).toBe("mp3");
      expect(
        handshakes.map((u) => u.searchParams.get("Sec-MS-GEC-Version")),
      ).toEqual([
        `2-${cfg.CHROMIUM_FULL_VERSION}`,
        `2-${cfg.CHROMIUM_FULL_VERSION}`,
      ]);
      expect(connections).toHaveLength(1);
    });

    it("falls back to the next token version", async () => {
      const cfg = await listen(speak("mp3"), {
        verifyClient: verifyClient(
          (url) =>
            url.searchParams.get("Sec-MS-GEC-Version")?.startsWith("2-")
              ? 403
              : null,
          { Date: new Date().toUTCString() },
        ),
      });

      const audio = await protocol.synthesize(cfg, "Hola", VOICE);

      expect(audio.toString()).toBe("mp3");
      expect(
        handshakes.map((u) => u.searchParams.get("Sec-MS-GEC-Version")),
      ).toEqual([
        `2-${cfg.CHROMIUM_FULL_VERSION}`,
        `2-${cfg.CHROMIUM_FULL_VERSION}`,
        `1-${cfg.CHROMIUM_FULL_VERSION}`,
      ]);
      expect(connections[0].url.searchParams.get("Sec-MS-GEC")).toMatch(
        /^[0-9A-F]{64}$/,
      );
    });

    it("names every token version when all of them are rejected", async () => {
      const cfg = await listen(speak("mp3"), {
        verifyClient: verifyClient(() => 403, {}),
      });

      const error = await failure(protocol.synthesize(cfg, "Hola", VOICE));

      expect(error.stage).toBe("handshake");
      expect(error.status).toBe(403);
      expect(error.message).toContain("Rejected for every token version: v2 (");
      expect(handshakes).toHaveLength(2);
    });
  });
});

describe("listVoices", () => {
  const voice: EdgeVoice = {
    Name: "Microsoft Server Speech Text to Speech Voice (es-MX, JorgeNeural)",
    ShortName: VOICE,
    Gender: "Male",
    Locale: "es-MX",
    FriendlyName: "Microsoft Jorge Online (Natural) - Spanish (Mexico)",
    Status: "GA",
  };
  const cfg = createConfig();

  let get: ReturnType<
    typeof vi.fn<(url: string, init?: RequestInit) => Promise<Response>>
  >;
  const json = (data: unknown) => new Response(JSON.stringify(data));

  beforeEach(async () => {
    vi.resetModules();
    get = vi.fn<(url: string, init?: RequestInit) => Promise<Response>>();
    vi.stubGlobal("fetch", get);
    protocol = await import("./protocol");
    ({ EdgeTTSError } = await import("./errors"));
  });

  it("returns the voice list", async () => {
    get.mockResolvedValue(json([voice]));

    await expect(protocol.listVoices(cfg)).resolves.toEqual([voice]);
  });

  it("asks without zstd, with a muid cookie, the auth query and a timeout", async () => {
    get.mockResolvedValue(json([]));

    await protocol.listVoices(cfg);

    const [url, init] = get.mock.calls[0];
    expect(url.startsWith(cfg.VOICE_LIST_URL)).toBe(true);
    expect(new URL(url).searchParams.get("Sec-MS-GEC-Version")).toBe(
      `2-${cfg.CHROMIUM_FULL_VERSION}`,
    );
    expect(init?.headers).toMatchObject({
      "Accept-Encoding": "gzip, deflate, br",
      Cookie: expect.stringMatching(/^muid=[0-9A-F]{32};$/),
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("fails with voices on a response that isn't a list", async () => {
    get.mockResolvedValue(json({ voices: [] }));

    const error = await failure(protocol.listVoices(cfg));

    expect(error.stage).toBe("voices");
    expect(error.message).toContain("Unexpected voice list response");
  });

  it("fails with voices on a response that isn't JSON", async () => {
    get.mockResolvedValue(new Response("<html>"));

    const error = await failure(protocol.listVoices(cfg));

    expect(error.stage).toBe("voices");
    expect(error.message).toContain("Unexpected voice list response");
  });

  it("fails with voices, the status and the server date on an HTTP error", async () => {
    get.mockResolvedValue(
      new Response("", { status: 500, headers: { date: SERVER_DATE } }),
    );

    const error = await failure(protocol.listVoices(cfg));

    expect(error.stage).toBe("voices");
    expect(error.status).toBe(500);
    expect(error.serverDate).toBe(SERVER_DATE);
  });

  it("tries the next token version on a 403", async () => {
    get
      .mockResolvedValueOnce(new Response("", { status: 403 }))
      .mockResolvedValueOnce(json([voice]));

    await expect(protocol.listVoices(cfg)).resolves.toEqual([voice]);
    expect(
      new URL(get.mock.calls[1][0]).searchParams.get("Sec-MS-GEC-Version"),
    ).toBe(`1-${cfg.CHROMIUM_FULL_VERSION}`);
  });

  it("fails with network when the service can't be reached", async () => {
    get.mockRejectedValue(new TypeError("fetch failed"));

    const error = await failure(protocol.listVoices(cfg));

    expect(error.stage).toBe("network");
    expect(error.status).toBeUndefined();
    expect(error.message).toContain("Unable to reach the voice list");
  });
});
