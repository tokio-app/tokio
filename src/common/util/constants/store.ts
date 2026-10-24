import { StoreSchema } from "@/common/schemas";

const defaultEntity = {
  file: "default.json",
  name: "Default",
};

const defaultProvider = { name: "Default", key: "", active: true };

export const defaultStoreData: StoreSchema = {
  settings: {
    server: {
      enabled: false,
    },
    updates: {
      auto: true,
    },
    tray: {
      enabled: true,
    },
    overlays: [],
    testOverlays: [],
    sounds: [],
    media: [],
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
    liveStats: {
      likes: 0,
      viewers: 0,
      views: 0,
    },
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
