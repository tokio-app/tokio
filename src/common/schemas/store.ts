import { z } from "zod";
import type { ControlAction } from "../types/controls";
import { AlertSoundSchema } from "./profile";
import { StoredStudioOverlaysSchema } from "./studio";

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
  // Chat commands the overlay answers that no setting holds, so Chat
  // translation leaves them as typed. Older versions strip it.
  commands: z.array(z.string()).optional(),
};

export const OverlayMetaSchema = z.object(OverlayMeta);

// An ID handed out in Tools → Test overlays, for overlays tested without
// importing them.
const TestOverlaySchema = z.object({
  id: z.string(),
  name: z.string(),
});

// The events the Home page's activity feed shows, by the kinds of
// ActivityItem. Kinds added later are shown.
export const ActivityFeedSchema = z.object({
  chat: z.boolean().default(true),
  gift: z.boolean().default(true),
  follow: z.boolean().default(true),
  share: z.boolean().default(true),
  superfan: z.boolean().default(true),
  join: z.boolean().default(true),
  sub: z.boolean().default(true),
  giftsub: z.boolean().default(true),
  cheer: z.boolean().default(true),
  raid: z.boolean().default(true),
  redeem: z.boolean().default(true),
  superchat: z.boolean().default(true),
  kicks: z.boolean().default(true),
});

// The Twitch account Tokio signed in to, the same for every profile. key is
// the refresh token, encrypted like the provider keys: never sent to the
// window, logged or exported.
const TwitchAccountSchema = z
  .object({
    id: z.string().default(""),
    login: z.string().default(""),
    key: z.string().default(""),
  })
  .prefault({});

// Game connections, the same for every profile. Keyed by game, each off
// until turned on, so stores saved before games load.
export const GamesSettingsSchema = z
  .object({
    // Tokio listens for Minecraft on MINECRAFT_PORT, the game joins with
    // /connect from its chat
    minecraft: z.object({ enabled: z.boolean().default(false) }).prefault({}),
  })
  .prefault({});

// An Electron accelerator per live control, the same for every profile. ""
// is none, as each starts: a global shortcut takes its keys from every app.
const accelerator = z.string().default("");
export const ShortcutsSchema = z
  .object({
    skipSong: accelerator,
    stopTts: accelerator,
    replayAlert: accelerator,
    pause: accelerator,
  } satisfies Record<ControlAction, typeof accelerator>)
  .prefault({});

// The phone remote and the control API, off until turned on. The key is
// their only gate on the LAN; "" until the first time it's on.
export const RemoteSettingsSchema = z
  .object({
    enabled: z.boolean().default(false),
    key: z.string().default(""),
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
  overlayUpdates: z
    .object({
      // Installs new official overlay versions in the background, except a
      // breaking one (a new first version number), which waits for the user
      auto: z.boolean(),
    })
    .default({ auto: true }),
  // The version Tokio last ran as, to show what's new after an update. "" in
  // stores from before it was kept.
  lastVersion: z.string().default(""),
  // The update Tokio restarted to install, checked on the next start. ""
  // when none is pending.
  installingVersion: z.string().default(""),
  tray: z
    .object({
      // Closing the window keeps Tokio running, with an icon in the tray
      enabled: z.boolean(),
    })
    .default({ enabled: true }),
  logs: z
    .object({
      // Detailed logs: the debug lines too, such as one for each LIVE event
      debug: z.boolean(),
    })
    .default({ debug: false }),
  // A tag in APP_LANGUAGES, or "system" to follow the OS. Any string, so a
  // language removed later can't invalidate the store.
  language: z.string().default("system"),
  // Chat translation: a code in TRANSLATION_LANGUAGES, or "" when it's off.
  // Any string loads, like language; main applies only the listed ones.
  translation: z
    .object({ language: z.string().default("") })
    .default({ language: "" }),
  overlays: z.array(z.object({ ...OverlayMeta, id: z.string() })),
  testOverlays: z.array(TestOverlaySchema).default([]),
  // Uploaded sounds, available to alerts in every profile
  sounds: z.array(AlertSoundSchema).default([]),
  // Uploaded images and videos, the same way: a name and a file
  media: z.array(AlertSoundSchema).default([]),
  // Pictures of what game actions make, for the games overlay, in their own
  // library: a name and a file in the Minecraft pictures folder
  minecraftPictures: z.array(AlertSoundSchema).default([]),
  // Overlay Studio's overlays, the same for every profile. One that doesn't
  // parse is dropped on load.
  studio: StoredStudioOverlaysSchema.default([]),
  activeFeatures: z.object({
    tts: z.boolean(),
    music: z.boolean(),
    alerts: z.boolean(),
  }),
  activityFeed: ActivityFeedSchema.prefault({}),
  // Accounts signed in to on platforms that need one
  accounts: z.object({ twitch: TwitchAccountSchema }).prefault({}),
  games: GamesSettingsSchema,
  shortcuts: ShortcutsSchema,
  remote: RemoteSettingsSchema,
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
export type TwitchAccount = z.infer<typeof TwitchAccountSchema>;
export type GamesSettings = z.infer<typeof GamesSettingsSchema>;
export type Shortcuts = z.infer<typeof ShortcutsSchema>;
export type RemoteSettings = z.infer<typeof RemoteSettingsSchema>;
export type AppSettings = z.infer<typeof AppSettingsSchema>;
export type StoreSchema = z.infer<typeof StoreZodSchema>;
