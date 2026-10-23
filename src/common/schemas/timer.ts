import { z } from "zod";

// What the countdown timer is doing, see TimerService
export const TIMER_STATUSES = ["idle", "running", "paused", "stopped"] as const;

// Its buttons on Tools
export const TIMER_ACTIONS = ["start", "pause", "stop", "reset"] as const;

// What Color gives: #rrggbb, or #rrggbbaa with alpha
const ColorSchema = z.string().regex(/^#(?:[0-9a-f]{6}|[0-9a-f]{8})$/i);

const addedSeconds = (value: number) => z.number().min(0).default(value);

// Seconds each trigger adds, before the multiplier. 0 leaves it out.
const TimerSecondsSchema = z.object({
  // Per coin of the gifts sent
  coin: addedSeconds(1),
  // Every likes_every likes
  likes: addedSeconds(10),
  likes_every: z.number().int().min(1).default(100),
  superfan: addedSeconds(300),
  superfan_box: addedSeconds(0),
  envelope: addedSeconds(0),
  follow: addedSeconds(30),
  share: addedSeconds(10),
  chat: addedSeconds(0),
  join: addedSeconds(0),
  superfan_join: addedSeconds(0),
});

// How the overlay shows the timer
const TimerLookSchema = z.object({
  // Over the clock, none when blank. Not trimmed: main's echo of a save would
  // drop a space being typed.
  title: z.string().max(60).default(""),
  // ×2 under the clock while the multiplier isn't 1
  show_multiplier: z.boolean().default(true),
  // Minutes before the end when the clock takes warning_color, 0 never
  warn_at: z.number().min(0).default(1),
  // Fonts installed where the streaming app runs, Archivo when empty
  clock_font: z.string().max(60).default(""),
  title_font: z.string().max(60).default(""),
  clock_color: ColorSchema.default("#f1f5f9"),
  title_color: ColorSchema.default("#f1f5f9"),
  // Added time and the multiplier
  accent_color: ColorSchema.default("#f43f5e"),
  warning_color: ColorSchema.default("#f43f5e"),
});

export const TimerSettingsSchema = z.object({
  // Minutes the countdown starts from, and goes back to on Reset
  start: z.number().int().min(1).default(60),
  // Minutes on the clock that added time stops at, 0 for no limit
  cap: z.number().min(0).default(0),
  // Multiplies the seconds every trigger adds, e.g. 2 for double time
  multiplier: z.number().min(0).default(1),
  // Seconds before one viewer's chat, follows, shares or joins add time again
  cooldown: z.number().min(0).default(30),
  // Pauses a running timer when Tokio disconnects from the LIVE
  pause_on_end: z.boolean().default(true),
  seconds: TimerSecondsSchema.prefault({}),
  look: TimerLookSchema.prefault({}),
});

// A profile's timer: its settings and the clock as it was saved
export const TimerProfileSchema = z.object({
  settings: TimerSettingsSchema.prefault({}),
  status: z.enum(TIMER_STATUSES).default("idle"),
  // Milliseconds left
  remaining: z.number().min(0).default(0),
});

export type TimerStatus = (typeof TIMER_STATUSES)[number];
export type TimerAction = (typeof TIMER_ACTIONS)[number];
export type TimerSettings = z.infer<typeof TimerSettingsSchema>;
export type TimerProfile = z.infer<typeof TimerProfileSchema>;
