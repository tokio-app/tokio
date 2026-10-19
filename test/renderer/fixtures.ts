import type {
  AlertSound,
  CatalogOverlay,
  OverlayConfig,
  Profile,
  StoreSchema,
} from "@/common/schemas";
import {
  AppNotification,
  CustomGift,
  FEEDBACK_CODES,
  MyInstantsSound,
  OverlayApp,
  PackageLicense,
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
