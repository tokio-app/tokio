import { formatError, MCP_PATH } from "@/common/util";
import Logger from "@/logger";
import { bodyError, remoteGuard } from "@/services/server/remote";
import type { AppHandlerVariables } from "@/types";
import { createMcpHandler } from "@modelcontextprotocol/server";
import express, { Request, RequestHandler, Response, Router } from "express";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream } from "node:stream/web";
import { createMcpServer, REGISTRY } from "./registry";
import type { Registry } from "./defs";

// Only this computer. The phone sends the key unencrypted over Wi-Fi, so the
// LAN gets the controls (/remote/api) and never the whole app.
const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/** Whether a socket's remote address is this computer. */
export const isLoopback = (address: string | undefined) =>
  address !== undefined && LOOPBACK.has(address);

// Browsers always send an Origin, MCP clients never do, so a web page can't
// reach it (as the Minecraft socket's verifyClient). Then loopback, from the
// socket itself: never req.ip or a header a client sets.
const localOnly: RequestHandler = (req, res, next) => {
  if (
    req.headers.origin !== undefined ||
    !isLoopback(req.socket.remoteAddress)
  ) {
    res.status(403).json({ error: "forbidden" });
    return;
  }
  next();
};

// The Express request as the web Request the SDK takes, its body already
// parsed by express.json
const toWebRequest = (req: Request, signal: AbortSignal) => {
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    for (const each of [value ?? []].flat()) headers.append(name, each);
  }
  return new globalThis.Request(
    `http://${req.headers.host ?? "127.0.0.1"}${req.originalUrl}`,
    { method: req.method, headers, signal },
  );
};

/**
 * MCP at /mcp, stateless, one server per request. In order: no Origin and
 * loopback (403), remote control on (403) and its key (401), then the body.
 */
export function createMcpRoutes(
  handler: AppHandlerVariables,
  registry: Registry = REGISTRY,
): Router {
  const log = () => handler.pathManagerService.files?.logs.system;
  const mcp = createMcpHandler(() => createMcpServer(handler, registry), {
    responseMode: "json",
    onerror: (error) => Logger.debug(`<MCP> ${formatError(error)}`, log()),
  });

  const serve = async (req: Request, res: Response) => {
    const abort = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) abort.abort();
    });
    try {
      const response = await mcp.fetch(
        toWebRequest(req, abort.signal),
        req.body === undefined ? {} : { parsedBody: req.body },
      );
      res.status(response.status);
      response.headers.forEach((value, name) => res.append(name, value));
      if (!response.body) {
        res.end();
        return;
      }
      // Piped, not buffered: an SSE answer streams
      await pipeline(
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the DOM and Node types of the same stream
        Readable.fromWeb(response.body as ReadableStream<Uint8Array>),
        res,
      );
    } catch (error) {
      // A client that left mid-answer
      if (abort.signal.aborted) return;
      Logger.error(
        `<MCP> Unable to answer -- ${formatError(error)}`,
        log(),
        error,
      );
      if (res.headersSent) res.destroy();
      else res.status(500).json({ error: "failed" });
    }
  };

  const router = express.Router();
  router.all(
    `/${MCP_PATH}`,
    localOnly,
    remoteGuard(() => handler.storeManagerService.getSettings().remote),
    // A full Overlay Studio overlay can pass 100 KB
    express.json({ limit: "1mb" }),
    serve,
    bodyError,
  );
  return router;
}
