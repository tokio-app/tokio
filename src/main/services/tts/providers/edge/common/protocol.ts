import { randomUUID } from "crypto";
import { RawData, WebSocket } from "ws";
import { buildHeaders } from "../config";
import { EdgeConfig, EdgeVoice } from "../types";
import { authQuery, withAuthRetry, withMuid } from "./drm";
import { EdgeAuth, EdgeTTSError } from "./errors";

// Speaks the same Read Aloud protocol as edge-tts communicate.py and voices.py,
// which are the references to compare against when the service changes, see README.md.

export async function listVoices(cfg: EdgeConfig): Promise<EdgeVoice[]> {
  return withAuthRetry(cfg, "voices", async (auth) => {
    try {
      const res = await fetch(`${cfg.VOICE_LIST_URL}${authQuery(cfg, auth)}`, {
        // Not every Node's fetch decodes zstd, so don't advertise it.
        headers: {
          ...withMuid(buildHeaders(cfg, "voices")),
          "Accept-Encoding": "gzip, deflate, br",
        },
        signal: AbortSignal.timeout(cfg.REQUEST_TIMEOUT_MS),
      });
      if (!res.ok) {
        throw new EdgeTTSError("voices", "Voice list request rejected", {
          auth,
          status: res.status,
          serverDate: res.headers.get("date") ?? undefined,
        });
      }
      const data: unknown = await res.json();
      if (!Array.isArray(data)) {
        throw new EdgeTTSError("voices", "Unexpected voice list response", {
          auth,
        });
      }
      return data;
    } catch (error) {
      if (error instanceof EdgeTTSError) throw error;
      if (error instanceof SyntaxError) {
        throw new EdgeTTSError("voices", "Unexpected voice list response", {
          auth,
          cause: error,
        });
      }
      throw new EdgeTTSError("network", "Unable to reach the voice list", {
        auth,
        cause: error,
      });
    }
  });
}

// JavaScript-style UTC date, e.g. "Tue Oct 14 2026 12:00:00 GMT+0000 (Coordinated Universal Time)".
function dateToString(date = new Date()) {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${days[date.getUTCDay()]} ${months[date.getUTCMonth()]} ${pad(date.getUTCDate())} ${date.getUTCFullYear()} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())} GMT+0000 (Coordinated Universal Time)`
  );
}

function connectId() {
  return randomUUID().replaceAll("-", "");
}

// The service rejects some control characters (e.g. vertical tab).
function removeIncompatibleCharacters(text: string) {
  // oxlint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ");
}

function escapeXml(text: string) {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

const escapedSize = (text: string) =>
  Buffer.byteLength(escapeXml(text), "utf8");

// Packs whole words into chunks whose escaped UTF-8 size fits maxBytes.
// Chunks are escaped only afterwards, so a character or an XML entity is never cut.
export function chunkText(text: string, maxBytes: number): string[] {
  const chunks: string[] = [];
  let current = "";
  let currentSize = 0;

  const flush = () => {
    if (current) chunks.push(current);
    current = "";
    currentSize = 0;
  };
  const append = (piece: string, pieceSize: number, separator: string) => {
    current += separator + piece;
    currentSize += pieceSize + separator.length;
  };

  for (const word of text.split(/\s+/).filter(Boolean)) {
    const wordSize = escapedSize(word);
    const separator = current ? " " : "";
    if (currentSize + separator.length + wordSize <= maxBytes) {
      append(word, wordSize, separator);
      continue;
    }
    flush();
    if (wordSize <= maxBytes) {
      append(word, wordSize, "");
      continue;
    }
    // A single word over the limit is cut between characters.
    for (const char of word) {
      const charSize = escapedSize(char);
      if (currentSize + charSize > maxBytes) flush();
      append(char, charSize, "");
    }
  }

  flush();
  return chunks;
}

function speechConfigMessage(cfg: EdgeConfig) {
  return (
    `X-Timestamp:${dateToString()}\r\n` +
    "Content-Type:application/json; charset=utf-8\r\n" +
    "Path:speech.config\r\n\r\n" +
    '{"context":{"synthesis":{"audio":{"metadataoptions":{' +
    '"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},' +
    `"outputFormat":"${cfg.OUTPUT_FORMAT}"}}}}\r\n`
  );
}

function ssmlMessage(voice: string, escapedText: string) {
  return (
    `X-RequestId:${connectId()}\r\n` +
    "Content-Type:application/ssml+xml\r\n" +
    `X-Timestamp:${dateToString()}Z\r\n` + // NOTE: The trailing Z mirrors an Edge bug, keep it.
    "Path:ssml\r\n\r\n" +
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
    `<voice name='${voice}'>` +
    "<prosody pitch='+0Hz' rate='+0%' volume='+0%'>" +
    escapedText +
    "</prosody></voice></speak>"
  );
}

function parseHeaders(block: string) {
  const headers: Record<string, string> = {};
  for (const line of block.split("\r\n")) {
    const idx = line.indexOf(":");
    if (idx > 0) headers[line.slice(0, idx)] = line.slice(idx + 1);
  }
  return headers;
}

function toBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(data);
}

function synthesizeChunk(
  cfg: EdgeConfig,
  auth: EdgeAuth,
  voice: string,
  escapedText: string,
): Promise<Buffer<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const audio: Buffer[] = [];
    let settled = false;

    const ws = new WebSocket(
      `${cfg.WSS_URL}&ConnectionId=${connectId()}${authQuery(cfg, auth)}`,
      { headers: withMuid(buildHeaders(cfg, "wss")) },
    );

    const finish = (error: EdgeTTSError | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      ws.removeAllListeners();
      ws.on("error", () => {}); // Late socket errors after settling.
      ws.terminate();
      if (error) reject(error);
      else resolve(Buffer.concat(audio));
    };

    const timer = setTimeout(() => {
      finish(
        new EdgeTTSError("timeout", "No response from the service", { auth }),
      );
    }, cfg.REQUEST_TIMEOUT_MS);

    ws.on("unexpected-response", (req, res) => {
      req.destroy();
      finish(
        new EdgeTTSError("handshake", "WebSocket handshake rejected", {
          auth,
          status: res.statusCode,
          serverDate: res.headers["date"],
        }),
      );
    });

    ws.on("error", (error) => {
      finish(
        new EdgeTTSError("network", "WebSocket connection failed", {
          auth,
          cause: error,
        }),
      );
    });

    ws.on("open", () => {
      ws.send(speechConfigMessage(cfg));
      ws.send(ssmlMessage(voice, escapedText));
    });

    ws.on("message", (raw, isBinary) => {
      const data = toBuffer(raw);

      if (!isBinary) {
        const text = data.toString("utf8");
        const headers = parseHeaders(text.slice(0, text.indexOf("\r\n\r\n")));
        if (headers["Path"] !== "turn.end") return; // response, turn.start, audio.metadata
        finish(
          audio.length > 0
            ? null
            : new EdgeTTSError(
                "no-audio",
                `No audio received for voice "${voice}"`,
                { auth },
              ),
        );
        return;
      }

      // Binary frame: 2-byte big-endian header length, headers, then audio.
      if (data.length < 2) {
        finish(
          new EdgeTTSError("synthesis", "Binary frame without header length", {
            auth,
          }),
        );
        return;
      }
      const headerLength = data.readUInt16BE(0);
      if (headerLength + 2 > data.length) {
        finish(
          new EdgeTTSError("synthesis", "Binary frame header is truncated", {
            auth,
          }),
        );
        return;
      }
      const headers = parseHeaders(
        data.subarray(2, headerLength + 2).toString("utf8"),
      );
      const body = data.subarray(headerLength + 2);
      if (headers["Path"] !== "audio") {
        finish(
          new EdgeTTSError(
            "synthesis",
            `Unexpected binary path "${headers["Path"]}"`,
            { auth },
          ),
        );
        return;
      }
      const contentType = headers["Content-Type"];
      if (contentType === undefined && body.length === 0) return; // End-of-stream marker.
      if (contentType !== "audio/mpeg" || body.length === 0) {
        finish(
          new EdgeTTSError(
            "synthesis",
            `Unexpected audio frame (Content-Type ${contentType}, ${body.length} bytes)`,
            {
              auth,
            },
          ),
        );
        return;
      }
      audio.push(body);
    });

    ws.on("close", (code, reason) => {
      finish(
        new EdgeTTSError(
          "synthesis",
          `Socket closed before the turn ended (code ${code}${reason.length ? `, ${reason.toString()}` : ""})`,
          { auth },
        ),
      );
    });
  });
}

export async function synthesize(
  cfg: EdgeConfig,
  text: string,
  voice: string,
): Promise<Buffer<ArrayBuffer>> {
  const chunks = chunkText(
    removeIncompatibleCharacters(text),
    cfg.MAX_CHUNK_BYTES,
  ).map(escapeXml);
  if (chunks.length === 0) {
    throw new EdgeTTSError("synthesis", "Nothing to synthesize");
  }

  const audio: Buffer[] = [];
  for (const chunk of chunks) {
    audio.push(
      await withAuthRetry(cfg, "handshake", (auth) =>
        synthesizeChunk(cfg, auth, voice, chunk),
      ),
    );
  }
  // MP3 frames concatenate cleanly.
  return Buffer.concat(audio);
}
