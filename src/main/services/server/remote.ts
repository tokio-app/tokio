import type { RemoteSettings } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE, ControlAction } from "@/common/types";
import { REMOTE_PATH } from "@/common/util";
import { language, t } from "@/helper/i18n";
import type { Invoke } from "@/types";
import ARCHIVO from "@fontsource-variable/archivo/files/archivo-latin-wdth-normal.woff2?inline";
import express, { ErrorRequestHandler, RequestHandler, Router } from "express";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import REMOTE_HTML from "./remote.html?raw";

const REMOTE_PAGE = REMOTE_HTML.replace("__ARCHIVO__", () => ARCHIVO);

// NOTE: DO NOT CHANGE. Stream Deck setups call these paths.
const ACTIONS = new Map<string, ControlAction>([
  ["skip-song", "skipSong"],
  ["stop-tts", "stopTts"],
  ["replay-alert", "replayAlert"],
  ["pause", "pause"],
]);

const BodySchema = z.object({ paused: z.boolean().optional() }).strict();

// The page's texts, keyed as remote.html reads them
const LABELS = [
  "title",
  "skipSong",
  "stopTts",
  "replayAlert",
  "pause",
  "resume",
  "paused",
  "done",
  "nothingToReplay",
  "noMusic",
  "unreachable",
  "newLink",
  "off",
  "noKey",
] as const;

export interface RemoteLabels {
  lang: string;
  text: Record<string, string>;
}

/** The page's texts in the user's language. */
export const remoteLabels = (): RemoteLabels => {
  // Where to turn it on and scan the code: Settings → Remote control
  const params = {
    settings: t("nav.settings"),
    section: t("settings.remote.title"),
  };
  return {
    lang: language(),
    text: Object.fromEntries(
      LABELS.map((label) => [label, t(`remote.${label}`, params)]),
    ),
  };
};

export interface RemoteDeps {
  remote: () => RemoteSettings;
  // Read straight from the service, never through invoke
  paused: () => boolean;
  invoke: Invoke;
  labels: () => RemoteLabels;
}

const authorized = (header: string | undefined, key: string) => {
  if (!key || !header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice("Bearer ".length));
  const wanted = Buffer.from(key);
  return given.length === wanted.length && timingSafeEqual(given, wanted);
};

/**
 * Remote control on (403 otherwise) and its key (401), before anything reads
 * the body. The control API and MCP share it.
 */
export const remoteGuard =
  (remote: () => RemoteSettings): RequestHandler =>
  (req, res, next) => {
    const { enabled, key } = remote();
    if (!enabled) {
      res.status(403).json({ error: "off" });
      return;
    }
    if (!authorized(req.headers.authorization, key)) {
      res.status(401).json({ error: "key" });
      return;
    }
    next();
  };

// A body express.json can't read, or one too big
export const bodyError: ErrorRequestHandler = (err, _req, res, _next) => {
  const status =
    typeof err === "object" && err !== null && "status" in err
      ? Number(err.status)
      : 500;
  res.status(status).json({ error: status < 500 ? "body" : "failed" });
};

/**
 * The phone remote at /remote/ and the control API under /remote/api/. The
 * key is the API's only gate on the LAN. No CORS headers: a page on another
 * origin can't send the Authorization header without a preflight, which fails.
 */
export function createRemoteRoutes(deps: RemoteDeps): Router {
  const router = express.Router();

  // Express 5 matches /remote/ too. It holds no key: that stays in the link.
  router.get(`/${REMOTE_PATH}`, (_req, res) => {
    const { lang, text } = deps.labels();
    // Escaped, so a text can't close the script block
    const json = JSON.stringify(text).replace(/</g, "\\u003c");
    res
      .type("html")
      .send(
        REMOTE_PAGE.replace("__LANG__", () => lang).replace(
          "__LABELS__",
          () => json,
        ),
      );
  });

  const api = express.Router();
  api.use(remoteGuard(deps.remote));
  api.get("/state", (_req, res) => {
    res.json({ paused: deps.paused() });
  });
  api.post("/:action", express.json({ limit: "1kb" }), async (req, res) => {
    const action = ACTIONS.get(req.params.action);
    if (!action) {
      res.status(404).json({ error: "action" });
      return;
    }
    // No body is {}; express.json leaves it undefined
    const body = BodySchema.safeParse(req.body ?? {});
    if (!body.success) {
      res.status(400).json({ error: "body" });
      return;
    }
    const { error, replies } = await deps.invoke(APP_EVENTS.CONTROL, {
      action,
      paused: body.data.paused,
    });
    for (const [channel, reply] of replies) {
      if (channel !== APP_EVENTS_RESPONSE.CONTROL) continue;
      if (reply.success) {
        res.json({ done: reply.done, paused: reply.paused });
      } else {
        res.status(500).json({ error: reply.error?.message ?? "" });
      }
      return;
    }
    res.status(500).json({ error: error?.message ?? "" });
  });
  api.use((_req, res) => {
    res.status(404).json({ error: "not found" });
  });
  api.use(bodyError);
  router.use(`/${REMOTE_PATH}/api`, api);

  return router;
}
