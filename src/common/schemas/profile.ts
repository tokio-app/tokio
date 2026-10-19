import { z } from "zod";
import { AlertTrigger, EMOTE_TRIGGER, TOKIO_EVENTS } from "../types/connector";

const PermissionsSchema = z.object({
  all: z.boolean(),
  followers: z.boolean(),
  superfans: z.boolean(),
  moderators: z.boolean(),
  level: z.object({
    enabled: z.boolean(),
    value: z.number().min(0),
  }),
  list: z.object({
    enabled: z.boolean(),
    white: z.array(z.string()),
    black: z.array(z.string()),
  }),
});

const MusicControl = z.object({
  enabled: z.boolean(),
  command: z.string(),
});

// Every live event (AppEvents) but Room Users can trigger an alert.
const LiveTriggerSchema = z
  .enum(TOKIO_EVENTS)
  .exclude(["CONNECTED", "DISCONNECTED", "MUSIC_PROCCESS_ENDED", "ROOM_USER"]);

const AlertTriggerSchema = z.union([
  LiveTriggerSchema,
  z.literal(EMOTE_TRIGGER),
]);

// Emote is listed right after Chat, the event it comes from.
export const ALERT_TRIGGERS = LiveTriggerSchema.options.flatMap(
  (trigger): AlertTrigger[] =>
    trigger === TOKIO_EVENTS.CHAT ? [trigger, EMOTE_TRIGGER] : [trigger],
);

// file is a basename inside the sounds folder
export const AlertSoundSchema = z.object({
  name: z.string(),
  file: z.string(),
});

const VoiceSchema = z.object({
  // Empty for voices saved before the engines were combined, they keep
  // the provider that was selected in Settings then.
  engine: z.string().default(""),
  name: z.string(),
  lang: z.string(),
});

const AlertTtsSchema = z.object({
  voice: VoiceSchema,
  // Can hold the trigger's variables, see ALERT_MESSAGE_VARIABLES
  message: z.string(),
  speed: z.number().min(0.5).max(2),
  pitch: z.number().min(0.5).max(2),
});

const AlertSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
  trigger: z.object({
    type: AlertTriggerSchema,
    // Only used by gift alerts. Empty means any gift.
    gifts: z.array(z.number()),
    // Only used by emote alerts. Empty means any emote.
    emotes: z.array(z.string()).default([]),
    // Only used by chat alerts. Empty means any message.
    keyword: z.string().default(""),
    // Only used by member and super fan join alerts. A handle or name, empty
    // means anyone.
    user: z.string().default(""),
  }),
  sound: AlertSoundSchema.nullable(),
  // Spoken instead of the sound when set
  tts: AlertTtsSchema.nullable().default(null),
  volume: z.number().min(0).max(100),
});

// Room Users alerts are no longer possible. Dropping the saved ones keeps
// the profile loading.
const RoomUserAlertSchema = z.object({
  trigger: z.object({ type: z.literal(TOKIO_EVENTS.ROOM_USER) }),
});

const AlertItemsSchema = z.preprocess(
  (items) =>
    Array.isArray(items)
      ? items.filter((item) => !RoomUserAlertSchema.safeParse(item).success)
      : items,
  z.array(AlertSchema),
);

const SavedEmoteSchema = z.object({
  id: z.string(),
  image: z.string(),
});

// TODO: Finish Profile schema
export const ProfileSchema = z.object({
  name: z.string().min(3),
  connector: z.object({
    username: z.string(),
  }),
  music: z.object({
    permissions: PermissionsSchema,
    protection: z.object({
      cooldown: z.number(),
      queue_length: z.number(),
    }),
    controls: z.object({
      play: MusicControl,
      next: MusicControl,
      last: MusicControl,
      revoke: MusicControl,
    }),
    provider: z.object({
      name: z.enum(["YouTube", "Spotify"]),
      key: z.string(),
    }),
  }),
  tts: z.object({
    voice: VoiceSchema,
    filters: z.object({
      speed: z.number(),
      pitch: z.number(),
      volume: z.number(),
    }),
    permissions: PermissionsSchema,
    format: z.object({
      template: z.string(),
      trigger: z.object({
        mode: z.enum(["any", "dot", "slash", "custom"]),
        value: z.string(),
      }),
      // Emojis are left out of what's read, chat and alert messages alike
      remove_emojis: z.boolean().default(false),
    }),
    protection: z.object({
      cooldown: z.number(),
      queue_length: z.number(),
      comment_length: z.number(),
      banned: z.array(z.string()),
    }),
    replacements: z.array(
      z.object({
        old: z.string(),
        new: z.string(),
      }),
    ),
  }),
  // Defaults keep profiles saved before alerts existed valid.
  alerts: z
    .object({
      simultaneous: z.boolean().default(false),
      // Max sounds waiting per queue
      queue_length: z.number().min(1).default(100),
      items: AlertItemsSchema.default([]),
    })
    .default({ simultaneous: false, queue_length: 100, items: [] }),
  // TikTok can't list a LIVE's emotes, so they're collected as viewers use
  // them, in the order they first appeared.
  emotes: z.array(SavedEmoteSchema).default([]),
});

export type Profile = z.infer<typeof ProfileSchema>;
export type Permissions = z.infer<typeof PermissionsSchema>;
export type Alert = z.infer<typeof AlertSchema>;
export type AlertSound = z.infer<typeof AlertSoundSchema>;
export type SavedEmote = z.infer<typeof SavedEmoteSchema>;
export type AlertTts = z.infer<typeof AlertTtsSchema>;
