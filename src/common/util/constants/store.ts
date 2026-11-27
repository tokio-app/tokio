import { FeedKinds, StoreSchema } from "@/common/schemas";

const defaultEntity = {
  file: "default.json",
  name: "Default",
};

const defaultProvider = { name: "Default", key: "" };

// Every kind of event, on a platform's feed
const EVERY_KIND: FeedKinds = {
  chat: true,
  gift: true,
  follow: true,
  share: true,
  superfan: true,
  join: true,
  sub: true,
  giftsub: true,
  cheer: true,
  raid: true,
  redeem: true,
  superchat: true,
  kicks: true,
};

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
    overlayUpdates: {
      auto: true,
    },
    lastVersion: "",
    installingVersion: "",
    tray: {
      enabled: true,
    },
    logs: {
      debug: false,
    },
    language: "system",
    translation: { language: "" },
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
      tiktok: { ...EVERY_KIND },
      twitch: { ...EVERY_KIND },
      youtube: { ...EVERY_KIND },
      kick: { ...EVERY_KIND },
    },
    accounts: { twitch: { id: "", login: "", key: "" } },
    games: {
      minecraft: { enabled: false },
    },
    shortcuts: {
      skipSong: "",
      stopTts: "",
      replayAlert: "",
      pause: "",
    },
    remote: { enabled: false, key: "" },
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
