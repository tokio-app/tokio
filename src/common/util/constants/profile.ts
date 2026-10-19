import { Profile } from "../../schemas";

export const defaultProfile: Profile = {
  name: "Default",
  connector: {
    username: "",
  },
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
    },
    protection: {
      cooldown: 2,
      queue_length: 10,
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
    },
    format: {
      template: "{username} {comment}",
      trigger: {
        mode: "any",
        value: "",
      },
      remove_emojis: false,
    },
    protection: {
      comment_length: 300,
      cooldown: 2,
      banned: [],
      queue_length: 10,
    },
    replacements: [],
  },
  alerts: {
    simultaneous: false,
    queue_length: 100,
    items: [],
  },
  emotes: [],
};
