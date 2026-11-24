import { z } from "zod";
import { PLATFORMS, type Platform } from "../types/connector";
import {
  ALERTS_PATH,
  GAMES_PATH,
  MCP_PATH,
  REMOTE_PATH,
  STUDIO_PATH,
  TIMER_PATH,
} from "../util/constants/server";

// Paths Tokio serves itself: the phone remote and its API at /remote/, and
// the MCP server at /mcp
const RESERVED_IDS = [
  ALERTS_PATH,
  TIMER_PATH,
  GAMES_PATH,
  STUDIO_PATH,
  REMOTE_PATH,
  MCP_PATH,
];

/**
 * An official overlay in the catalog that tokio-app/overlays publishes with
 * every release (overlays.json, format in that repo's README). Only the fields
 * Tokio reads; fields added later are dropped.
 */
export const CatalogOverlaySchema = z.object({
  // Its folder name there, and its folder and URL path here. Never changes.
  // The alerts' overlays are served under /alerts/, the countdown timer's at
  // /timer/, the games overlay at /games/ and Overlay Studio's under /studio/
  // (RESERVED_IDS).
  id: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .refine((id) => !RESERVED_IDS.includes(id)),
  name: z.string(),
  version: z.string(),
  description: z.string(),
  // Whether it has settings
  config: z.boolean(),
  // The zip, its size in bytes and its SHA-256
  url: z.string(),
  size: z.number().int().positive(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/i),
  preview: z.string().nullable(),
  // The platforms it works on. Missing means every platform, as in catalogs
  // published before it. A platform this Tokio doesn't know is left out, so
  // the entry still parses.
  platforms: z
    .array(z.string())
    .transform((list) =>
      list.filter((p): p is Platform =>
        (PLATFORMS as readonly string[]).includes(p),
      ),
    )
    .optional(),
});

export type CatalogOverlay = z.infer<typeof CatalogOverlaySchema>;
