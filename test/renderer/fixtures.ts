import type {
  Alert,
  AlertMedia,
  AlertSound,
  CatalogOverlay,
  MediaFile,
  OverlayConfig,
  Profile,
  StoreSchema,
} from "@/common/schemas";
import {
  ActivityUser,
  AppNotification,
  CustomGift,
  FEEDBACK_CODES,
  LiveSession,
  MyInstantsSound,
  OverlayApp,
  PackageLicense,
  TimerData,
  VoiceData,
  VoiceEngine,
} from "@/common/types";
import { defaultProfile, defaultStoreData } from "@/common/util";

const slug = (name: string) => name.toLowerCase().replace(/\W+/g, "-");

export const overlayApp = (
  id: string,
  patch: Partial<OverlayApp> = {},
): OverlayApp => ({
  id,
  name: id,
  version: "1.0.0",
  external: false,
  config: true,
  path: `C:\\Users\\me\\.tokio\\overlays\\${id}\\index.html`,
  ...patch,
});

export const catalogEntry = (
  id: string,
  patch: Partial<CatalogOverlay> = {},
): CatalogOverlay => ({
  id,
  name: id,
  version: "1.0.0",
  description: `The ${id} overlay.`,
  config: true,
  url: `https://github.com/tokio-app/overlays/releases/download/v1.0.0/${id}.zip`,
  size: 1024,
  sha256: "0".repeat(64),
  preview: null,
  ...patch,
});

export const voice = (
  name: string,
  lang = "en-US",
  engine = "edge",
): VoiceData => ({ engine, name, lang });

export const engine = (
  id: string,
  label: string,
  keyLabel?: string,
): VoiceEngine => ({ id, label, ...(keyLabel && { keyLabel }) });

export const alertSound = (name: string): AlertSound => ({
  name,
  file: `${slug(name)}.mp3`,
});

// A sound as an alert has it, whole unless cut
export const alertClip = (
  name: string,
  cut: Partial<Pick<NonNullable<Alert["sound"]>, "start" | "end">> = {},
): NonNullable<Alert["sound"]> => ({
  ...alertSound(name),
  start: 0,
  end: null,
  ...cut,
});

// An image in the media library
export const mediaFile = (name: string): MediaFile => ({
  name,
  file: `${slug(name)}.png`,
});

// An alert's image, or a library file as an alert's media
export const alertMedia = (
  file: MediaFile | string,
  patch: Partial<AlertMedia> = {},
): AlertMedia => ({
  ...(typeof file === "string" ? mediaFile(file) : file),
  duration: 5,
  match_video: false,
  volume: 100,
  ...patch,
});

export const instantSound = (name: string): MyInstantsSound => ({
  name,
  url: `https://www.myinstants.com/media/sounds/${slug(name)}.mp3`,
  file: `${slug(name)}.mp3`,
});

export const gift = (value: number, label: string): CustomGift => ({
  value,
  label,
  img: `https://example.com/${slug(label)}.png`,
  coins: value,
});

/** A viewer in the Home page's feed, with a picture. */
export const viewer = (name: string): ActivityUser => ({
  handle: slug(name),
  name,
  picture: `https://example.com/${slug(name)}.png`,
});

/** LIVE_SESSION's data: no LIVE and nothing counted, changed by `patch`. */
export const liveSession = (patch: Partial<LiveSession> = {}): LiveSession => ({
  startedAt: null,
  totals: { followers: 0, shares: 0, gifts: 0, coins: 0 },
  activity: [],
  ...patch,
});

let notices = 0;

export const notification = (
  message: string,
  patch: Partial<AppNotification> = {},
): AppNotification => ({
  id: `notice-${++notices}`,
  level: "info",
  source: "system",
  message,
  timestamp: Date.now(),
  ...patch,
});

export const packageLicense = (
  name: string,
  patch: Partial<PackageLicense> = {},
): PackageLicense => ({
  id: `${name}@1.0.0`,
  name,
  version: "1.0.0",
  license: "MIT",
  copyleft: false,
  ...patch,
});

/** Two sections of fields, every value at its default. */
export const overlayConfig = (): OverlayConfig => ({
  sections: [
    { id: "general", name: "General" },
    { id: "style", name: "Style" },
  ],
  fields: [
    {
      id: "title",
      name: "Title",
      section: "general",
      type: "input",
      attributes: {
        mode: "text",
        placeholder: "Type a title",
        value: "Goal",
        default: "Goal",
      },
    },
    {
      id: "size",
      name: "Size",
      section: "style",
      type: "slider",
      attributes: { value: 50, default: 50, min: 0, max: 100 },
    },
    {
      id: "show",
      name: "Show count",
      section: "style",
      type: "check",
      attributes: { value: true, default: true },
    },
  ],
});

/** A failed reply, as main sends them. */
export const failure = (message = "Something went wrong.") => ({
  success: false,
  error: { code: FEEDBACK_CODES.UNKNOWN, message },
});

/**
 * The GET_PROFILE reply with the default profile, changed by `recipe`. The
 * defaults are cloned, so tests never change the shared ones.
 */
export function profileReply(recipe?: (profile: Profile) => void) {
  const profile = structuredClone(defaultProfile);
  recipe?.(profile);
  return { success: true, profile };
}

/** The GET_SETTINGS reply with the default store, changed by `recipe`. */
export function settingsReply(recipe?: (store: StoreSchema) => void) {
  const data = structuredClone(defaultStoreData);
  recipe?.(data);
  return { success: true, data };
}

/**
 * A TIMER reply or push with the default timer, idle at its starting time,
 * changed by `recipe`.
 */
export function timerReply(recipe?: (data: TimerData) => void) {
  const settings = structuredClone(defaultProfile.timer.settings);
  const data: TimerData = {
    settings,
    state: { status: "idle", remaining: settings.start * 60_000 },
    added: 0,
  };
  recipe?.(data);
  return { success: true, data };
}
