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
    follower: randomBool(0.75),
    superfan: randomBool(0.15),
    moderator: randomBool(0.05),
    fanLevel: randomBool(0.4) ? randomInt(1, 50) : undefined,
  };
};

const singleUserFactory = () => ({
  user: userFactory(),
});

const chatEventFactory = (): ChatEvent => {
  const content = pickRandom(CHAT_MESSAGES);
  const hasEmotes = randomBool(0.4);
  const numEmotes = hasEmotes ? randomInt(1, 3) : 0;
  const emotes = Array.from({ length: numEmotes }, () =>
    emoteFactory(content.length),
  );

  return {
    user: userFactory(),
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
    shareCount: randomInt(1, 500),
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

const giftEventFactory = (): GiftEvent => {
  const selectedGift = pickRandom(GIFTS);

  const isCombo = randomBool(0.7);
  const comboCount = isCombo ? randomInt(1, 99) : 1;

  return {
    user: userFactory(),
    gift: {
      id: String(selectedGift.value),
      coins: selectedGift.coins,
      repeatEnd: isCombo ? randomBool(0.2) : true,
      type: randomInt(1, 3),
      name: selectedGift.label,
      comboCount,
      image: selectedGift.img,
    },
  };
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

export const generateTikTokEventSample = <K extends AppEvents>(
  type: K,
): Extract<TokioPayload, { type: K }> => {
  const data = TIKTOK_EVENT_SAMPLES[type]();
  return {
    type,
    data,
  } as Extract<TokioPayload, { type: K }>;
};
