import {
  GamesOverlaySchema,
  PlatformPermissions,
  Profile,
  TimerProfileSchema,
} from "../../schemas";

// Twitch's, YouTube's or Kick's permissions before the streamer sets them:
// everyone (the user's call)
export const defaultPlatformPermissions: PlatformPermissions = {
  all: true,
  superfans: false,
  moderators: false,
  vips: false,
};

export const defaultProfile: Profile = {
  name: "Default",
  connector: {
    username: "",
  },
  platforms: ["tiktok"],
  channels: {},
  music: {
    permissions: {
      all: true,
      followers: false,
      superfans: false,
      moderators: false,
      level: {
        enabled: false,
        value: 0,
      },
      list: {
        enabled: false,
        white: [],
        black: [],
      },
      platforms: {},
    },
    protection: {
      cooldown: 2,
      queue_length: 10,
      one_per_viewer: false,
      limit_controls: true,
    },
    controls: {
      play: {
        enabled: true,
        command: "!play",
      },
      next: {
        enabled: true,
        command: "!next",
      },
      last: {
        enabled: true,
        command: "!last",
      },
      revoke: {
        enabled: true,
        command: "!revoke",
      },
    },
    provider: {
      name: "YouTube",
      key: "",
      block_ads: false,
    },
  },
  tts: {
    voice: {
      engine: "Default",
      lang: "en",
      name: "Default",
    },
    filters: {
      pitch: 1,
      speed: 1,
      volume: 100,
    },
    permissions: {
      all: true,
      followers: false,
      superfans: false,
      moderators: false,
      level: {
        enabled: false,
        value: 0,
      },
      list: {
        enabled: false,
        white: [],
        black: [],
      },
      platforms: {},
    },
    format: {
      template: "{username} {comment}",
      trigger: {
        mode: "any",
        value: "",
      },
      remove_emojis: false,
      translate: false,
    },
    protection: {
      comment_length: 300,
      cooldown: 2,
      banned: [],
      queue_length: 10,
    },
    replacements: [],
    user_voices: [],
  },
  alerts: {
    simultaneous: false,
    queue_length: 100,
    items: [],
  },
  emotes: [],
  timer: TimerProfileSchema.parse({}),
  games: {
    actions: [],
    overlay: GamesOverlaySchema.parse({}),
  },
};
