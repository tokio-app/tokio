import { z } from "zod";
import { AlertSoundSchema } from "./profile";

const ProviderSchema = z.object({
  name: z.string(),
  key: z.string(),
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

// Game connections, the same for every profile. Keyed by game, each off
// until turned on, so stores saved before games load.
export const GamesSettingsSchema = z
  .object({
    // Tokio listens for Minecraft on MINECRAFT_PORT, the game joins with
    // /connect from its chat
    minecraft: z.object({ enabled: z.boolean().default(false) }).prefault({}),
  })
  .prefault({});

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
  tray: z
    .object({
      // Closing the window keeps Tokio running, with an icon in the tray
      enabled: z.boolean(),
    })
    .default({ enabled: true }),
  overlays: z.array(z.object({ ...OverlayMeta, id: z.string() })),
  testOverlays: z.array(TestOverlaySchema).default([]),
  // Uploaded sounds, available to alerts in every profile
  sounds: z.array(AlertSoundSchema).default([]),
  // Uploaded images and videos, the same way: a name and a file
  media: z.array(AlertSoundSchema).default([]),
  // Pictures of what game actions make, for the games overlay, in their own
  // library: a name and a file in the Minecraft pictures folder
  minecraftPictures: z.array(AlertSoundSchema).default([]),
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
  games: GamesSettingsSchema,
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
export type GamesSettings = z.infer<typeof GamesSettingsSchema>;
export type AppSettings = z.infer<typeof AppSettingsSchema>;
export type StoreSchema = z.infer<typeof StoreZodSchema>;
