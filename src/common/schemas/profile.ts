import { z } from "zod";
import { AlertTrigger, EMOTE_TRIGGER, TOKIO_EVENTS } from "../types/connector";
import { TimerProfileSchema } from "./timer";

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

// Seconds an alert's image or video shows at least, until changed, and the
// most it can be set to
export const MEDIA_DURATION = 5;
export const MEDIA_MAX_DURATION = 60;

// An image or video, file a basename inside the media folder. It stays on
// screen for duration seconds, or while the alert's sound plays if longer.
const AlertMediaSchema = AlertSoundSchema.extend({
  duration: z.number().min(1).max(MEDIA_MAX_DURATION),
  // The duration follows the video's length, also when another is picked
  match_video: z.boolean().default(false),
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

// What an alert or a game action reacts to
export const TriggerSchema = z.object({
  type: AlertTriggerSchema,
  // Only used by gift triggers. Empty means any gift.
  gifts: z.array(z.number()),
  // Only used by gift triggers. Fires once for each gift sent, instead of
  // once when the viewer's streak ends.
  every_gift: z.boolean().default(false),
  // Only used by emote triggers. Empty means any emote.
  emotes: z.array(z.string()).default([]),
  // Only used by chat triggers. Empty means any message.
  keyword: z.string().default(""),
  // Only used by member and super fan join triggers. A handle or name, empty
  // means anyone.
  user: z.string().default(""),
});

const AlertSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
  trigger: TriggerSchema,
  sound: AlertSoundSchema.nullable(),
  // Spoken instead of the sound when set
  tts: AlertTtsSchema.nullable().default(null),
  // Shown on the alert's overlay, with the sound or message or alone
  media: AlertMediaSchema.nullable().default(null),
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

// The most mobs a spawn step summons, or items a give step gives, at once
export const GAME_STEP_MAX_AMOUNT = 100;

const GameAmountSchema = z
  .number()
  .int()
  .min(1)
  .max(GAME_STEP_MAX_AMOUNT)
  .default(1);

// One thing a game action does in Minecraft. Mob and item ids are the
// game's, like "zombie". Text can hold the trigger's variables, see
// ALERT_MESSAGE_VARIABLES.
export const GameStepSchema = z.discriminatedUnion("type", [
  // Typed as in the game's chat, with or without the slash
  z.object({ type: z.literal("command"), command: z.string() }),
  // Where the player stands, named when name isn't empty
  z.object({
    type: z.literal("spawn"),
    mob: z.string(),
    amount: GameAmountSchema,
    name: z.string().default(""),
  }),
  z.object({
    type: z.literal("give"),
    item: z.string(),
    amount: GameAmountSchema,
  }),
  z.object({
    type: z.literal("weather"),
    weather: z.enum(["clear", "rain", "thunder"]),
  }),
  z.object({
    type: z.literal("time"),
    time: z.enum(["day", "noon", "night", "midnight"]),
  }),
]);

// Bedrock connects by itself; Java through the Tokio mod
export const MINECRAFT_EDITIONS = ["bedrock", "java"] as const;

// Runs its steps, in order, each time its trigger fires, in the edition it's
// made for. Actions saved before Java existed are Bedrock's.
export const GameActionSchema = z.object({
  id: z.string(),
  enabled: z.boolean(),
  edition: z.enum(MINECRAFT_EDITIONS).default("bedrock"),
  trigger: TriggerSchema,
  // On Like, it runs once every likes_every likes from all viewers, as the
  // countdown timer counts them
  likes_every: z.number().int().min(1).default(100),
  steps: z.array(GameStepSchema),
});

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
      // One waiting request per viewer, and no song twice in the queue
      one_per_viewer: z.boolean().default(false),
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
      // Max alerts waiting per queue
      queue_length: z.number().min(1).default(100),
      items: AlertItemsSchema.default([]),
    })
    .default({ simultaneous: false, queue_length: 100, items: [] }),
  // TikTok can't list a LIVE's emotes, so they're collected as viewers use
  // them, in the order they first appeared.
  emotes: z.array(SavedEmoteSchema).default([]),
  // The countdown timer on Tools, its settings and clock. Profiles saved
  // before it existed start from the defaults.
  timer: TimerProfileSchema.prefault({}),
  // What LIVE events do in Minecraft, on Games. Profiles saved before it
  // existed have no actions.
  games: z
    .object({ actions: z.array(GameActionSchema).default([]) })
    .prefault({}),
});

export type Profile = z.infer<typeof ProfileSchema>;
export type Permissions = z.infer<typeof PermissionsSchema>;
export type Trigger = z.infer<typeof TriggerSchema>;
export type Alert = z.infer<typeof AlertSchema>;
export type GameStep = z.infer<typeof GameStepSchema>;
export type GameAction = z.infer<typeof GameActionSchema>;
export type MinecraftEdition = GameAction["edition"];
export type AlertSound = z.infer<typeof AlertSoundSchema>;
export type AlertMedia = z.infer<typeof AlertMediaSchema>;
// An image or video in the media library
export type MediaFile = Pick<AlertMedia, "name" | "file">;
export type SavedEmote = z.infer<typeof SavedEmoteSchema>;
export type AlertTts = z.infer<typeof AlertTtsSchema>;
