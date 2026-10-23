import { z } from "zod";
import { ALERTS_PATH, TIMER_PATH } from "../util/constants/server";

/**
 * An official overlay in the catalog that tokio-app/overlays publishes with
 * every release (overlays.json, format in that repo's README). Only the fields
 * Tokio reads; fields added later are dropped.
 */
export const CatalogOverlaySchema = z.object({
  // Its folder name there, and its folder and URL path here. Never changes.
  // The alerts' overlays are served under /alerts/, the countdown timer's at
  // /timer/.
  id: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .refine((id) => id !== ALERTS_PATH && id !== TIMER_PATH),
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
});

export type CatalogOverlay = z.infer<typeof CatalogOverlaySchema>;
