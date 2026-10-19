import { z } from "zod";
import { AlertSoundSchema } from "./profile";

const ProviderSchema = z.object({
  name: z.string(),
  key: z.string(),
  active: z.boolean(),
});

const EntityMetadataSchema = z.object({
  file: z.string(),
  name: z.string(),
});

const OverlayMeta = {
  name: z.string(),
  version: z.string(),
  external: z.boolean().optional(),
  config: z.boolean(),
};

export const OverlayMetaSchema = z.object(OverlayMeta);

// An ID handed out on the Tools page, for overlays tested without importing them.
const TestOverlaySchema = z.object({
  id: z.string(),
  name: z.string(),
});

// The events the Home page's activity feed shows, by the kinds of
// ActivityItem. Kinds added later are shown.
const ActivityFeedSchema = z.object({
  chat: z.boolean().default(true),
  gift: z.boolean().default(true),
  follow: z.boolean().default(true),
  share: z.boolean().default(true),
  superfan: z.boolean().default(true),
  join: z.boolean().default(true),
});

const AppSettingsSchema = z.object({
  server: z.object({
    enabled: z.boolean(),
  }),
  updates: z
    .object({
      // Checks for new releases on startup and every few hours
      auto: z.boolean(),
    })
    .default({ auto: true }),
  overlays: z.array(z.object({ ...OverlayMeta, id: z.string() })),
  testOverlays: z.array(TestOverlaySchema).default([]),
  // Uploaded sounds, available to alerts in every profile
  sounds: z.array(AlertSoundSchema).default([]),
  activeFeatures: z.object({
    tts: z.boolean(),
    music: z.boolean(),
    alerts: z.boolean(),
  }),
  activityFeed: ActivityFeedSchema.default({
    chat: true,
    gift: true,
    follow: true,
    share: true,
    superfan: true,
    join: true,
  }),
  liveStats: z.object({
    likes: z.number(),
    views: z.number(),
    viewers: z.number(),
  }),
  activeProfile: EntityMetadataSchema,
  activeTTSProvider: ProviderSchema,
  activeConnProvider: ProviderSchema,
  providers: z.object({
    tts: z.array(ProviderSchema),
    connector: z.array(ProviderSchema),
  }),
});

export const StoreZodSchema = z.object({
  settings: AppSettingsSchema,
  profiles: z.array(EntityMetadataSchema),
});

export type AppProvider = z.infer<typeof ProviderSchema>;
export type EntityMetadata = z.infer<typeof EntityMetadataSchema>;
export type OverlayMetadata = z.infer<typeof OverlayMetaSchema>;
export type TestOverlay = z.infer<typeof TestOverlaySchema>;
export type ActivityFeed = z.infer<typeof ActivityFeedSchema>;
export type AppSettings = z.infer<typeof AppSettingsSchema>;
export type StoreSchema = z.infer<typeof StoreZodSchema>;
