import {
  AppEvents,
  ChatEvent,
  Emotes,
  GiftEvent,
  LikeEvent,
  MusicInfo,
  RoomUserEvent,
  ShareEvent,
  TOKIO_EVENTS,
  TokioEventMap,
  TokioPayload,
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

// Live, only chat messages say how a viewer relates to the host.
const userFactory = (): UserData => {
  const adjective = pickRandom(ADJECTIVES);
  const noun = pickRandom(NOUNS);
  const numberSuffix = randomInt(10, 9999);
  const username = `${adjective} ${noun}`;
  const handle = `${adjective.toLowerCase()}${noun.toLowerCase()}${numberSuffix}`;
  const profilePictures = [`https://picsum.photos/seed/${handle}/200/200`];

  return {
    username,
    handle,
    profilePictures,
    follower: false,
    superfan: false,
    moderator: false,
    fanLevel: randomBool(0.4) ? randomInt(1, 50) : 0,
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

const chatEventFactory = (user = chatterFactory()): ChatEvent => {
  const content = pickRandom(CHAT_MESSAGES);
  const hasEmotes = randomBool(0.4);
  const numEmotes = hasEmotes ? randomInt(1, 3) : 0;
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

// One payload type per event, so a union of events gives a union of payloads.
export const generateTikTokEventSample = <K extends AppEvents>(
  type: K,
): { [P in K]: { type: P; data: TokioEventMap[P] } }[K] => ({
  type,
  data: TIKTOK_EVENT_SAMPLES[type](),
});

// The test LIVE's room fills up to this many viewers, one per press.
const TEST_VIEWERS = 8;

/**
 * A LIVE for overlays' Test button, played one press at a time. Each call
 * sends every live event at once and carries on from the call before: the
 * same viewers come back, likes and coins add up, and a gift streak grows over
 * a few presses before it ends, the way TikTok sends it.
 */
export const createTestLive = () => {
  // Live, only chat says how a viewer relates to the host, the same each time.
  const cast: { viewer: UserData; chatter: UserData }[] = [];
  const coins = new Map<UserData, number>();
  let viewers = randomInt(20, 200);
  let views = viewers + randomInt(50, 2000);
  let totalLikes = randomInt(500, 20000);

  // A viewer with a name the room doesn't have yet
  const newcomer = () => {
    let viewer = userFactory();
    while (cast.some((c) => c.viewer.username === viewer.username)) {
      viewer = userFactory();
    }
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
      coins.set(s.viewer, (coins.get(s.viewer) ?? 0) + s.size * s.gift.coins);
      streak = undefined;
    }

    // Ranks carry only these fields, from the coins of the gifts that ended.
    const ranks = [...coins]
      .sort(([, a], [, b]) => b - a)
      .map(([{ username, handle, profilePictures }, score], i) => ({
        username,
        handle,
        profilePictures,
        score,
        position: i + 1,
      }));

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
    ];
  };
};
