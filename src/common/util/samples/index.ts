import {
  AppEvents,
  ChatEvent,
  Emotes,
  Fan,
  GiftEvent,
  LikeEvent,
  MusicInfo,
  RoomUserEvent,
  ShareEvent,
  TOKIO_EVENTS,
  TokioEventMap,
  TokioPayload,
  TopGifter,
  UserData,
} from "@/common/types";
import { ADJECTIVES, CHAT_MESSAGES, GIFTS, LANGUAGES, NOUNS } from "./data";

const randomBool = (probability = 0.5): boolean => Math.random() < probability;
const pickRandom = <T>(arr: T[]): T =>
  arr[Math.floor(Math.random() * arr.length)];
const randomInt = (min: number, max: number): number =>
  Math.floor(Math.random() * (max - min + 1)) + min;

const emoteFactory = (contentLength: number): Emotes => {
  const emoteID = String(randomInt(1000, 9999));

  return {
    emoteID,
    index: randomInt(0, contentLength),
    images: [`https://picsum.photos/seed/${emoteID}_large/64/64`],
  };
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
  const profilePictures = [`https://picsum.photos/seed/${handle}/200/200`];
  const fanLevel = randomBool(0.4) ? randomInt(1, 50) : 0;

  return {
    username,
    handle,
    profilePictures,
    follower: false,
    superfan: false,
    moderator: false,
    fanLevel,
    fanBadge: fanLevel ? fanBadgeOf(fanLevel) : "",
    userId: String(randomInt(1e9, 9e9)),
  };
};

const singleUserFactory = () => ({
  user: userFactory(),
});

// The viewer as their chat messages show them
const chatterFactory = (user = userFactory()): UserData => ({
  ...user,
  follower: randomBool(0.75),
  superfan: randomBool(0.15),
  moderator: randomBool(0.05),
});

const chatEventFactory = (
  user = chatterFactory(),
  numEmotes = randomBool(0.4) ? randomInt(1, 3) : 0,
): ChatEvent => {
  const content = pickRandom(CHAT_MESSAGES);
  const emotes = Array.from({ length: numEmotes }, () =>
    emoteFactory(content.length),
  );

  return {
    user,
    comment: {
      content,
      emotes,
      lang: pickRandom(LANGUAGES),
    },
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

const TIKTOK_EVENT_SAMPLES: {
  [K in AppEvents]: () => TokioEventMap[K];
} = {
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
};

/** A chat message with at least one emote, as an emote trigger needs. */
export const generateEmoteChatSample = (): ChatEvent =>
  chatEventFactory(chatterFactory(), randomInt(1, 3));

// One payload type per event, so a union of events gives a union of payloads.
export const generateTikTokEventSample = <K extends AppEvents>(
  type: K,
): { [P in K]: { type: P; data: TokioEventMap[P] } }[K] => ({
  type,
  data: TIKTOK_EVENT_SAMPLES[type](),
});

// The test LIVE's room fills up to this many viewers, one per press.
const TEST_VIEWERS = 8;
const DAY = 24 * 60 * 60 * 1000;

// What a viewer gave, and when their last gift came
type Tally = { coins: number; gifts: number; giftedAt: number };

/**
 * A LIVE for overlays' Test button, played one press at a time. Each call
 * sends every live event at once, then the top gifters and the fans, and
 * carries on from the call before: the same viewers come back, likes and
 * coins add up, and a gift streak grows over a few presses before it ends, the
 * way TikTok sends it.
 */
export const createTestLive = () => {
  // Live, only chat says how a viewer relates to the host, the same each time.
  const cast: { viewer: UserData; chatter: UserData }[] = [];
  // In the order each reached their total, so a tie goes to the first there
  const tally = new Map<UserData, Tally>();
  // Gifters from the profile's earlier LIVEs, for the all-time top 10
  const past = new Map<UserData, Tally>(
    Array.from({ length: 12 }, () => {
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

  return (): TokioPayload[] => {
    const joined = cast.length < TEST_VIEWERS ? newcomer() : pickRandom(cast);

    viewers += randomInt(0, 5);
    views += randomInt(5, 15);
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
