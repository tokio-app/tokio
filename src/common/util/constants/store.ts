import { StoreSchema } from "@/common/schemas";

const defaultEntity = {
  file: "default.json",
  name: "Default",
};

const defaultProvider = { name: "Default", key: "" };

// The LIVE's stats while none is connected. Frozen, as every reset shares it.
export const EMPTY_LIVE_STATS = Object.freeze({
  likes: 0,
  viewers: 0,
  views: 0,
});

export const defaultStoreData: StoreSchema = {
  settings: {
    server: {
      enabled: false,
    },
    updates: {
      auto: true,
    },
    lastVersion: "",
    tray: {
      enabled: true,
    },
    language: "system",
    overlays: [],
    testOverlays: [],
    sounds: [],
    media: [],
    minecraftPictures: [],
    studio: [],
    activeFeatures: {
      tts: false,
      music: false,
      alerts: false,
    },
    activityFeed: {
      chat: true,
      gift: true,
      follow: true,
      share: true,
      superfan: true,
      join: true,
    },
    games: {
      minecraft: { enabled: false },
    },
    liveStats: { ...EMPTY_LIVE_STATS },
    activeProfile: defaultEntity,
    activeConnProvider: defaultProvider,
    activeTTSProvider: defaultProvider,
    providers: {
      tts: [defaultProvider],
      connector: [defaultProvider],
    },
  },
  profiles: [defaultEntity],
};
