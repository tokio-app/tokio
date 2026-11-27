import {
  AlertTrigger,
  AppEvents,
  ChatEvent,
  CheerEvent,
  EMOTE_TRIGGER,
  Emotes,
  Fan,
  GiftEvent,
  GiftSubEvent,
  KicksEvent,
  LikeEvent,
  MusicInfo,
  Platform,
  PLATFORMS,
  RaidEvent,
  RedeemEvent,
  RoomUserEvent,
  ShareEvent,
  SubscribeEvent,
  SuperChatEvent,
  TOKIO_EVENTS,
  TokioEventMap,
  TokioPayload,
  TopGifter,
  UserData,
} from "@/common/types";
import { platformOf, rowPlatforms } from "../platforms";
import { jewelsOf } from "../youtube";
import {
  ADJECTIVES,
  CHAT_MESSAGES,
  GIFTS,
  LANGUAGES,
  NOUNS,
  TRANSLATED_CHATS,
  YOUTUBE_GIFTS,
} from "./data";

const randomBool = (probability = 0.5): boolean => Math.random() < probability;
const pickRandom = <T>(arr: readonly T[]): T =>
  arr[Math.floor(Math.random() * arr.length)];
const randomInt = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const picture = (seed: string) => `https://picsum.photos/seed/${seed}/200/200`;

// Real emotes: Twitch's Kappa and LUL, Kick's KEKW and GG
const TWITCH_EMOTES = ["25", "425618"];
const KICK_EMOTES = ["37226", "39275"];

// Each platform's emote ids and pictures, as its chat sends them. TikTok's
// and YouTube's are made up.
const EMOTES: Record<Platform, () => Omit<Emotes, "index">> = {
  tiktok: () => {
    const id = String(randomInt(1000, 9999));
    return {
      emoteID: id,
      images: [`https://picsum.photos/seed/${id}_large/64/64`],
    };
  },
  twitch: () => {
    const id = pickRandom(TWITCH_EMOTES);
    return {
      emoteID: `twitch:${id}`,
      images: [
        `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/2.0`,
      ],
    };
  },
  youtube: () => {
    const id = `UC${randomInt(1e8, 9e8)}/${randomInt(1000, 9999)}`;
    return {
      emoteID: `youtube:${id}`,
      images: [`https://picsum.photos/seed/${randomInt(1000, 9999)}/64/64`],
    };
  },
  kick: () => {
    const id = pickRandom(KICK_EMOTES);
    return {
      emoteID: `kick:${id}`,
      images: [`https://files.kick.com/emotes/${id}/fullsize`],
    };
  },
};

const musicFactory = (): MusicInfo[] => {
  return Array.from({ length: 5 }, (_, i) => ({
    playing: i === 2,
    played: 2 > i,
    title: `${pickRandom(ADJECTIVES)} - ${pickRandom(NOUNS)}`,
    thumbnail: `https://picsum.photos/seed/${i}_large/400/400`,
  }));
};

// TikTok's picture of a fan level's badge, a new one every 10 levels
const fanBadgeOf = (level: number) =>
  `https://p16-webcast.tiktokcdn.com/webcast-va/fans_badge_icon_lv${Math.max(1, Math.floor(level / 10) * 10)}_v4.png~tplv-obj.image`;

// Live, only chat messages say how a viewer relates to the host.
const userFactory = (): UserData => {
  const adjective = pickRandom(ADJECTIVES);
  const noun = pickRandom(NOUNS);
  const numberSuffix = randomInt(10, 9999);
  const username = `${adjective} ${noun}`;
  const handle = `${adjective.toLowerCase()}${noun.toLowerCase()}${numberSuffix}`;
  const fanLevel = randomBool(0.4) ? randomInt(1, 50) : 0;

  return {
    username,
    handle,
    profilePictures: [picture(handle)],
    follower: false,
    superfan: false,
    moderator: false,
    fanLevel,
    fanBadge: fanLevel ? fanBadgeOf(fanLevel) : "",
    userId: String(randomInt(1e9, 9e9)),
    platform: "tiktok",
  };
};

// The viewer as their TikTok chat messages show them
const chatterFactory = (user = userFactory()): UserData => ({
  ...user,
  follower: randomBool(0.75),
  superfan: randomBool(0.15),
  moderator: randomBool(0.05),
});

// What Twitch's and Kick's chat badges say: moderators, subscribers (with
// their months, now and then) and VIPs. Only chat carries them.
const badges = () => {
  const superfan = randomBool(0.3);
  return {
    moderator: randomBool(0.05),
    superfan,
    vip: randomBool(0.1),
    ...(superfan && randomBool(0.7) && { subMonths: randomInt(1, 36) }),
  };
};

// A Twitch viewer outside chat: the display name apart from the login, a
// namespaced id, and the picture Tokio looks up
const twitchViewer = (): UserData => {
  const username = `${pickRandom(ADJECTIVES)}_${pickRandom(NOUNS)}${randomInt(1, 999)}`;
  const handle = username.toLowerCase();
  return {
    username,
    handle,
    profilePictures: [picture(handle)],
    follower: false,
    userId: `twitch:${randomInt(1e7, 9e8)}`,
    platform: "twitch",
  };
};

// Twitch's chat goes without pictures
const twitchChatter = (user = twitchViewer()): UserData => ({
  ...user,
  profilePictures: [],
  ...badges(),
});

// A YouTube viewer: a handle for a name, a namespaced channel id, no fan
// level and no follower flag
const youtubeViewer = (): UserData => {
  const handle = `${pickRandom(ADJECTIVES)}${pickRandom(NOUNS)}${randomInt(1, 9999)}`;
  return {
    username: handle,
    handle,
    profilePictures: [picture(handle)],
    follower: false,
    moderator: false,
    superfan: false,
    userId: `youtube:UC${randomInt(1e8, 9e8)}`,
    platform: "youtube",
  };
};

// Chat says who moderates and who's a member, with a member badge's months
const youtubeChatter = (user = youtubeViewer()): UserData => {
  const superfan = randomBool(0.3);
  return {
    ...user,
    moderator: randomBool(0.05),
    superfan,
    ...(superfan &&
      randomBool(0.7) && { subMonths: pickRandom([1, 2, 6, 12, 24]) }),
  };
};

// A YouTube Gift's sender carries no badges
const youtubeGifter = ({
  username,
  handle,
  profilePictures,
  userId,
}: UserData): UserData => ({
  username,
  handle,
  profilePictures,
  follower: false,
  userId,
  platform: "youtube",
});

// A Kick viewer as a Kicks' sender: the channel's slug for a handle, a
// namespaced id and a picture
const kickViewer = (): UserData => {
  const username = `${pickRandom(ADJECTIVES)}${pickRandom(NOUNS)}${randomInt(1, 999)}`;
  return {
    username,
    handle: username.toLowerCase(),
    profilePictures: [picture(username)],
    follower: false,
    userId: `kick:${randomInt(1e6, 9e7)}`,
    platform: "kick",
  };
};

// Kick's chat has no pictures
const kickChatter = (user = kickViewer()): UserData => ({
  ...user,
  profilePictures: [],
  ...badges(),
});

// Subs and gifted subs name the viewer by username, and Tokio finds the id
const kickSubber = (user = kickViewer()): UserData => ({
  ...user,
  profilePictures: [],
});

// Hosts and redemptions name the viewer by username alone
const kickNamed = ({ username, handle } = kickViewer()): UserData => ({
  username,
  handle,
  profilePictures: [],
  follower: false,
  platform: "kick",
});

const TWITCH_TIERS = ["1000", "1000", "1000", "2000", "3000", "prime"];
// Prime can't be gifted
const TWITCH_GIFT_TIERS = ["1000", "1000", "2000", "3000"];
const REWARDS = [
  { title: "Hydrate!", cost: 100 },
  { title: "Pick the next song", cost: 500 },
  { title: "Say hi in a funny voice", cost: 1000 },
];

// Twitch's tiers, or YouTube's and Kick's none. Kick's say no message.
const subscribeEventFactory = (
  user: UserData,
  tiers = [""],
  withMessage = true,
): SubscribeEvent => {
  const months = randomBool(0.4) ? 1 : randomInt(2, 36);
  return {
    user,
    tier: pickRandom(tiers),
    months,
    message:
      withMessage && months > 1 && randomBool(0.6)
        ? pickRandom(CHAT_MESSAGES)
        : "",
  };
};

const giftSubEventFactory = (user: UserData, tiers = [""]): GiftSubEvent => ({
  user,
  count: pickRandom([1, 1, 5, 10, 20]),
  tier: pickRandom(tiers),
});

const cheerEventFactory = (user = twitchViewer()): CheerEvent => ({
  user,
  bits: pickRandom([1, 100, 100, 500, 1000, 5000]),
  message: randomBool(0.7) ? pickRandom(CHAT_MESSAGES) : "",
});

// The user is the raiding (or hosting) channel's streamer
const raidEventFactory = (user: UserData): RaidEvent => ({
  user,
  viewers: randomInt(2, 400),
});

// Kick's reward ids are numbers
const redeemEventFactory = (user: UserData): RedeemEvent => {
  const reward = pickRandom(REWARDS);
  const kick = platformOf(user) === "kick";
  return {
    user,
    reward: {
      id: kick ? String(REWARDS.indexOf(reward) + 1) : `reward-${reward.cost}`,
      ...reward,
    },
    input:
      reward.cost === 500
        ? `${pickRandom(ADJECTIVES)} ${pickRandom(NOUNS)}`
        : "",
  };
};

const kicksEventFactory = (user = kickViewer()): KicksEvent => ({
  user,
  kicks: pickRandom([1, 10, 50, 100, 500, 1000, 2000]),
  message: randomBool(0.5) ? pickRandom(CHAT_MESSAGES) : "",
});

const SUPER_CHAT_AMOUNTS = [
  "$2.00",
  "$5.00",
  "$5.00",
  "$10.00",
  "€5.00",
  "MX$100.00",
];

const superChatEventFactory = (user = youtubeViewer()): SuperChatEvent => {
  const sticker = randomBool(0.2);
  return {
    user,
    amount: pickRandom(SUPER_CHAT_AMOUNTS),
    message: sticker ? "" : pickRandom(CHAT_MESSAGES),
    sticker: sticker
      ? `https://picsum.photos/seed/${user.handle}-sticker/200/200`
      : "",
  };
};

// A real YouTube Gift as the mapping sends it, at its price in Jewels, now
// and then a combo of a few
const youtubeGiftEventFactory = (user = youtubeViewer()): GiftEvent => {
  const { key, name } = pickRandom(YOUTUBE_GIFTS);
  return {
    user: youtubeGifter(user),
    gift: {
      id: `youtube:${key}`,
      name,
      image: `https://www.gstatic.com/youtube/img/pdg/gift/assets/${key}.png=w640-h640`,
      coins: jewelsOf(key) ?? 0,
      type: 0,
      comboCount: randomBool(0.2) ? randomInt(2, 5) : 1,
      repeatEnd: true,
    },
  };
};

const singleUserFactory = () => ({
  user: userFactory(),
});

// Some chats in another language, translated, on TikTok, the only chat
// with a language. Elsewhere some are only emotes.
const chatEventFactory = (
  user = chatterFactory(),
  numEmotes = randomBool(0.4) ? randomInt(1, 3) : 0,
  // Only the overlays' test LIVE sends emotes alone: a test's message needs
  // words to say
  emoteOnly = false,
): ChatEvent => {
  const platform = platformOf(user);
  const { content, lang, translation }: Omit<ChatEvent["comment"], "emotes"> =
    platform !== "tiktok"
      ? {
          content:
            emoteOnly && numEmotes && randomBool(0.2)
              ? ""
              : pickRandom(CHAT_MESSAGES),
          lang: "",
        }
      : randomBool(0.25)
        ? structuredClone(pickRandom(TRANSLATED_CHATS))
        : { content: pickRandom(CHAT_MESSAGES), lang: pickRandom(LANGUAGES) };
  const emotes = Array.from({ length: numEmotes }, () => ({
    ...EMOTES[platform](),
    index: randomInt(0, content.length),
  }));

  return {
    user,
    comment: { content, emotes, lang, ...(translation && { translation }) },
  };
};

const likeEventFactory = (): LikeEvent => {
  const likeCount = randomInt(1, 15);
  const totalLikes = randomInt(1500, 2500000);

  return {
    user: userFactory(),
    likeCount,
    totalLikes: totalLikes + likeCount,
  };
};

const shareEventFactory = (): ShareEvent => {
  return {
    user: userFactory(),
    shareCount: randomInt(1, 3),
  };
};

const roomUserEventFactory = (): RoomUserEvent => {
  const viewers = randomInt(100, 15000);
  const views = viewers + randomInt(500, 50000);
  const numRanks = randomInt(3, 10);
  const descendingScores = Array.from({ length: numRanks }, () =>
    randomInt(500, 100000),
  ).sort((a, b) => b - a);
  const ranks = descendingScores.map((score, index) => ({
    ...userFactory(),
    score,
    position: index + 1,
  }));

  return {
    ranks,
    views,
    viewers,
  };
};

const giftEvent = (
  user: UserData,
  gift: (typeof GIFTS)[number],
  comboCount: number,
  repeatEnd: boolean,
): GiftEvent => ({
  user,
  gift: {
    id: String(gift.value),
    coins: gift.coins,
    repeatEnd,
    type: gift.type,
    name: gift.label,
    comboCount,
    image: gift.img,
  },
});

// A whole streak, as alerts count it, or a gift that can't be one
const giftEventFactory = (): GiftEvent => {
  const gift = pickRandom(GIFTS);
  return giftEvent(userFactory(), gift, randomInt(1, gift.maxCombo), true);
};

type Factories = { [K in AppEvents]?: () => TokioEventMap[K] };

// Each platform's events, shaped as its mapping sends them. TikTok's also
// hold what no platform sends (Music change) and the room's viewers.
const SAMPLES: Record<Platform, Factories> = {
  tiktok: {
    [TOKIO_EVENTS.CHAT]: chatEventFactory,
    [TOKIO_EVENTS.LIKE]: likeEventFactory,
    [TOKIO_EVENTS.SHARE]: shareEventFactory,
    [TOKIO_EVENTS.FOLLOW]: singleUserFactory,
    [TOKIO_EVENTS.SUPER_FAN]: singleUserFactory,
    [TOKIO_EVENTS.MEMBER_JOIN]: singleUserFactory,
    [TOKIO_EVENTS.SUPER_FAN_JOIN]: singleUserFactory,
    [TOKIO_EVENTS.ROOM_USER]: roomUserEventFactory,
    [TOKIO_EVENTS.ENVELOPE]: () => {},
    [TOKIO_EVENTS.SUPER_FAN_BOX]: () => {},
    [TOKIO_EVENTS.GIFT]: giftEventFactory,
    [TOKIO_EVENTS.MUSIC_CHANGE]: musicFactory,
  },
  twitch: {
    [TOKIO_EVENTS.CHAT]: () => chatEventFactory(twitchChatter()),
    [TOKIO_EVENTS.FOLLOW]: () => ({ user: twitchViewer() }),
    [TOKIO_EVENTS.SUBSCRIBE]: () =>
      subscribeEventFactory(twitchViewer(), TWITCH_TIERS),
    [TOKIO_EVENTS.GIFT_SUB]: () =>
      giftSubEventFactory(twitchViewer(), TWITCH_GIFT_TIERS),
    [TOKIO_EVENTS.CHEER]: () => cheerEventFactory(),
    [TOKIO_EVENTS.RAID]: () => raidEventFactory(twitchViewer()),
    [TOKIO_EVENTS.REDEEM]: () => redeemEventFactory(twitchViewer()),
  },
  youtube: {
    [TOKIO_EVENTS.CHAT]: () => chatEventFactory(youtubeChatter()),
    [TOKIO_EVENTS.GIFT]: () => youtubeGiftEventFactory(),
    [TOKIO_EVENTS.SUBSCRIBE]: () => subscribeEventFactory(youtubeViewer()),
    [TOKIO_EVENTS.GIFT_SUB]: () => giftSubEventFactory(youtubeViewer()),
    [TOKIO_EVENTS.SUPER_CHAT]: () => superChatEventFactory(),
  },
  kick: {
    [TOKIO_EVENTS.CHAT]: () => chatEventFactory(kickChatter()),
    [TOKIO_EVENTS.KICKS]: () => kicksEventFactory(),
    [TOKIO_EVENTS.SUBSCRIBE]: () =>
      subscribeEventFactory(kickSubber(), [""], false),
    [TOKIO_EVENTS.GIFT_SUB]: () => giftSubEventFactory(kickSubber()),
    [TOKIO_EVENTS.RAID]: () => raidEventFactory(kickNamed()),
    [TOKIO_EVENTS.REDEEM]: () => redeemEventFactory(kickNamed()),
  },
};

const CHATTERS: Record<Platform, () => UserData> = {
  tiktok: chatterFactory,
  twitch: twitchChatter,
  youtube: youtubeChatter,
  kick: kickChatter,
};

/** A chat message with at least one emote, as an emote trigger needs. */
export const generateEmoteChatSample = (
  platform: Platform = "tiktok",
): ChatEvent => chatEventFactory(CHATTERS[platform](), randomInt(1, 3));

/**
 * A sample of the event as the platform sends it. An event the platform
 * doesn't send comes from the first platform that does.
 */
// One payload type per event, so a union of events gives a union of payloads.
export const generateEventSample = <K extends AppEvents>(
  type: K,
  platform: Platform = "tiktok",
): { [P in K]: { type: P; data: TokioEventMap[P] } }[K] => {
  const from = SAMPLES[platform][type]
    ? platform
    : (PLATFORMS.find((p) => SAMPLES[p][type]) ?? "tiktok");
  return { type, data: SAMPLES[from][type]!() };
};

/** A sample of what sets the trigger off: an emote comes in a chat. */
export const generateTriggerSample = (
  type: AlertTrigger,
  platform?: Platform,
): TokioEventMap[AppEvents] =>
  type === EMOTE_TRIGGER
    ? generateEmoteChatSample(platform)
    : generateEventSample(type, platform).data;

/**
 * The platform a trigger row's sample comes from: the row's own, else the
 * first of the profile's that sends its event. None for a row no platform
 * sends (Music change), whose sample is TikTok's.
 */
export const samplePlatform = (
  row: { type: AlertTrigger; platform?: Platform },
  profilePlatforms: readonly Platform[],
): Platform | undefined => {
  const sending = rowPlatforms(row, profilePlatforms);
  return row.platform ?? profilePlatforms.find((p) => sending.includes(p));
};

// The test LIVE's room fills up to this many viewers, one per press.
const TEST_VIEWERS = 8;
const DAY = 24 * 60 * 60 * 1000;

// What a viewer gave, and when their last gift came
type Tally = { coins: number; gifts: number; giftedAt: number };

// A platform's few viewers for the test LIVE, each the same in chat every
// time
const fewViewers = (
  viewer: () => UserData,
  chatter: (u: UserData) => UserData,
) =>
  Array.from({ length: 3 }, () => {
    const user = viewer();
    return { viewer: user, chatter: chatter(user) };
  });

/**
 * A LIVE for overlays' Test button, played one press at a time. Each call
 * sends every live event the profile's platforms send, each in its
 * platform's shape, then the top gifters and the fans, and carries on from
 * the call before: the same viewers come back, likes and coins add up, and a
 * gift streak grows over a few presses before it ends, the way TikTok sends
 * it. The gifters and fans are TikTok's, empty without it.
 */
export const createTestLive = (platforms: readonly Platform[]) => {
  const tiktok = platforms.includes("tiktok");
  // Live, only chat says how a viewer relates to the host, the same each time.
  const cast: { viewer: UserData; chatter: UserData }[] = [];
  // In the order each reached their total, so a tie goes to the first there
  const tally = new Map<UserData, Tally>();
  // Gifters from the profile's earlier LIVEs, for the all-time top 10
  const past = new Map<UserData, Tally>(
    Array.from({ length: tiktok ? 12 : 0 }, () => {
      const gifts = randomInt(5, 300);
      return [
        userFactory(),
        {
          coins: gifts * randomInt(1, 60),
          gifts,
          giftedAt: Date.now() - randomInt(1, 90) * DAY,
        },
      ];
    }),
  );
  // The other platforms' events come from a few viewers of their own
  const twitch = fewViewers(twitchViewer, twitchChatter);
  const youtube = fewViewers(youtubeViewer, youtubeChatter);
  const kick = fewViewers(kickViewer, kickChatter);
  let viewers = randomInt(20, 200);
  let views = viewers + randomInt(50, 2000);
  let totalLikes = randomInt(500, 20000);

  // A viewer with a name the room doesn't have yet
  const newcomer = () => {
    const taken = (user: UserData) =>
      cast.some((c) => c.viewer.username === user.username);
    // Some past gifters come back.
    const back = [...past.keys()].filter((user) => !taken(user));
    let viewer =
      back.length && randomBool(0.3) ? pickRandom(back) : userFactory();
    while (taken(viewer)) viewer = userFactory();
    const joined = { viewer, chatter: chatterFactory(viewer) };
    cast.push(joined);
    return joined;
  };
  const anyone = () => pickRandom(cast).viewer;

  const startStreak = () => {
    const gift = pickRandom(GIFTS);
    return {
      viewer: anyone(),
      gift,
      size: randomInt(1, gift.maxCombo),
      sent: 0,
    };
  };
  let streak: ReturnType<typeof startStreak> | undefined;

  const tiktokPress = (): TokioPayload[] => {
    const joined = cast.length < TEST_VIEWERS ? newcomer() : pickRandom(cast);

    const likeCount = randomInt(1, 15);
    // The total also counts likes from viewers the test leaves out.
    totalLikes += likeCount + randomInt(0, 40);

    // Type 1 gifts grow a few at a time, then TikTok sends the last count
    // again to end the streak. Other gifts come once, ended.
    let gift: GiftEvent;
    const s = (streak ??= startStreak());
    if (s.gift.type === 1 && s.sent < s.size) {
      s.sent = Math.min(s.size, s.sent + randomInt(1, 3));
      gift = giftEvent(s.viewer, s.gift, s.sent, false);
    } else {
      gift = giftEvent(s.viewer, s.gift, s.size, true);
      const before = tally.get(s.viewer);
      tally.delete(s.viewer);
      tally.set(s.viewer, {
        coins: (before?.coins ?? 0) + s.size * s.gift.coins,
        gifts: (before?.gifts ?? 0) + s.size,
        giftedAt: Date.now(),
      });
      streak = undefined;
    }

    return [
      { type: TOKIO_EVENTS.MEMBER_JOIN, data: { user: joined.viewer } },
      { type: TOKIO_EVENTS.SUPER_FAN_JOIN, data: { user: anyone() } },
      {
        type: TOKIO_EVENTS.CHAT,
        data: chatEventFactory(pickRandom(cast).chatter),
      },
      {
        type: TOKIO_EVENTS.LIKE,
        data: { user: anyone(), likeCount, totalLikes },
      },
      { type: TOKIO_EVENTS.GIFT, data: gift },
      { type: TOKIO_EVENTS.FOLLOW, data: { user: anyone() } },
      { type: TOKIO_EVENTS.SHARE, data: { user: anyone(), shareCount: 1 } },
      { type: TOKIO_EVENTS.SUPER_FAN, data: { user: anyone() } },
      // A super fan box comes as both events.
      { type: TOKIO_EVENTS.SUPER_FAN_BOX, data: undefined },
      { type: TOKIO_EVENTS.ENVELOPE, data: undefined },
    ];
  };

  const presses: Record<Platform, () => TokioPayload[]> = {
    tiktok: tiktokPress,
    twitch: () => {
      const from = () => pickRandom(twitch).viewer;
      return [
        {
          type: TOKIO_EVENTS.CHAT,
          data: chatEventFactory(pickRandom(twitch).chatter, undefined, true),
        },
        { type: TOKIO_EVENTS.FOLLOW, data: { user: from() } },
        {
          type: TOKIO_EVENTS.SUBSCRIBE,
          data: subscribeEventFactory(from(), TWITCH_TIERS),
        },
        {
          type: TOKIO_EVENTS.GIFT_SUB,
          data: giftSubEventFactory(from(), TWITCH_GIFT_TIERS),
        },
        { type: TOKIO_EVENTS.CHEER, data: cheerEventFactory(from()) },
        { type: TOKIO_EVENTS.RAID, data: raidEventFactory(twitchViewer()) },
        { type: TOKIO_EVENTS.REDEEM, data: redeemEventFactory(from()) },
      ];
    },
    youtube: () => {
      const from = () => pickRandom(youtube).viewer;
      return [
        {
          type: TOKIO_EVENTS.CHAT,
          data: chatEventFactory(pickRandom(youtube).chatter, undefined, true),
        },
        { type: TOKIO_EVENTS.GIFT, data: youtubeGiftEventFactory(from()) },
        { type: TOKIO_EVENTS.SUBSCRIBE, data: subscribeEventFactory(from()) },
        { type: TOKIO_EVENTS.GIFT_SUB, data: giftSubEventFactory(from()) },
        { type: TOKIO_EVENTS.SUPER_CHAT, data: superChatEventFactory(from()) },
      ];
    },
    kick: () => {
      const from = () => pickRandom(kick).viewer;
      return [
        {
          type: TOKIO_EVENTS.CHAT,
          data: chatEventFactory(pickRandom(kick).chatter, undefined, true),
        },
        { type: TOKIO_EVENTS.KICKS, data: kicksEventFactory(from()) },
        {
          type: TOKIO_EVENTS.SUBSCRIBE,
          data: subscribeEventFactory(kickSubber(from()), [""], false),
        },
        {
          type: TOKIO_EVENTS.GIFT_SUB,
          data: giftSubEventFactory(kickSubber(from())),
        },
        { type: TOKIO_EVENTS.RAID, data: raidEventFactory(kickNamed()) },
        {
          type: TOKIO_EVENTS.REDEEM,
          data: redeemEventFactory(kickNamed(from())),
        },
      ];
    },
  };

  return (): TokioPayload[] => {
    const events = platforms.flatMap((platform) => presses[platform]());
    viewers += randomInt(0, 5);
    views += randomInt(5, 15);

    // Ranks carry only these fields, from the coins of the gifts that ended.
    const gifters = [...tally].sort(([, a], [, b]) => b.coins - a.coins);
    const ranks = gifters.map(
      ([{ username, handle, profilePictures, userId }, { coins }], i) => ({
        username,
        handle,
        profilePictures,
        userId,
        score: coins,
        position: i + 1,
      }),
    );

    const topGifter = (user: UserData): TopGifter => {
      const thisLive = tally.get(user);
      const earlier = past.get(user);
      return {
        userId: user.userId ?? "",
        username: user.username,
        handle: user.handle,
        picture: user.profilePictures[0] ?? "",
        live: { coins: thisLive?.coins ?? 0, gifts: thisLive?.gifts ?? 0 },
        allTime: {
          coins: (thisLive?.coins ?? 0) + (earlier?.coins ?? 0),
          gifts: (thisLive?.gifts ?? 0) + (earlier?.gifts ?? 0),
        },
        giftedAt: (thisLive ?? earlier)!.giftedAt,
        ...(user.platform && { platform: user.platform }),
      };
    };
    const allTime = [...new Set([...tally.keys(), ...past.keys()])]
      .map(topGifter)
      .sort((a, b) => b.allTime.coins - a.allTime.coins);

    // This LIVE's viewers were seen now, past gifters at their last gift.
    const seen = new Map(
      [...past].map(([user, { giftedAt }]) => [user, giftedAt]),
    );
    for (const { viewer } of cast) seen.set(viewer, Date.now());
    const fans: Fan[] = [...seen]
      .filter(([user]) => user.fanLevel)
      .map(
        ([
          { userId, username, handle, fanLevel, fanBadge, superfan },
          seenAt,
        ]) => ({
          userId: userId ?? "",
          username,
          handle,
          fanLevel: fanLevel ?? 0,
          fanBadge: fanBadge ?? "",
          superfan: superfan ?? false,
          seenAt,
        }),
      )
      .sort((a, b) => b.fanLevel - a.fanLevel || b.seenAt - a.seenAt)
      .slice(0, 100);

    return [
      ...events,
      { type: TOKIO_EVENTS.MUSIC_CHANGE, data: musicFactory() },
      { type: TOKIO_EVENTS.ROOM_USER, data: { viewers, views, ranks } },
      {
        type: "tokio:gifters",
        data: {
          live: gifters.slice(0, 10).map(([user]) => topGifter(user)),
          allTime: allTime.slice(0, 10),
        },
      },
      { type: "tokio:fans", data: { fans } },
    ];
  };
};
