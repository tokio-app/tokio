// Kick's chat feed publications, mapped to Tokio's. Only the fields read
// here are typed, from what the feed sent.
import {
  ChatEvent,
  Emotes,
  TOKIO_EVENTS,
  TokioEventMap,
  UserData,
} from "@/common/types";

type Sender = {
  id: number;
  username: string;
  slug: string;
  // A subscriber's or founder's count is their months subscribed
  identity?: { badges?: { type: string; count?: number }[] };
};

type ChatMessage = { content: string; sender: Sender };

type Subscription = { username: string; months?: number };

type GiftedSubscriptions = {
  gifter_username: string;
  gifted_usernames: string[];
};

type KicksGifted = {
  sender: { id: number; username: string; profile_picture?: string | null };
  gift: { gift_id: string | number; name: string; amount: number };
};

type StreamHost = { host_username: string; number_viewers: number };

// Its shape has varied: the title flat or in reward, the redeemer flat or
// in user
type RewardRedeemed = {
  reward_title?: string;
  reward_id?: string | number;
  reward?: { id?: string | number; title?: string; cost?: number };
  user_input?: string | null;
  username?: string;
  user?: { username?: string };
};

type Mappable =
  | TOKIO_EVENTS.CHAT
  | TOKIO_EVENTS.GIFT
  | TOKIO_EVENTS.SUBSCRIBE
  | TOKIO_EVENTS.GIFT_SUB
  | TOKIO_EVENTS.RAID
  | TOKIO_EVENTS.REDEEM;
export type Mapped = {
  [K in Mappable]: { event: K; data: TokioEventMap[K] };
}[Mappable];

// Some events come with Laravel's namespace, some without
export const eventName = (event: string) => event.replace(/^App\\Events\\/, "");

// A publication's data is a JSON string inside the JSON, now and then
// already an object. Null when it's neither.
export function decode(data: unknown): object | null {
  if (typeof data === "string") {
    try {
      const parsed: unknown = JSON.parse(data);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }
  return data && typeof data === "object" ? data : null;
}

// [emote:<id>:<name>], inline in a chat's content
const EMOTE = /\[emote:(\d+):[^\]]*\]/g;

const emotePicture = (id: string) =>
  `https://files.kick.com/emotes/${id}/fullsize`;

// A viewer the feed names only by their username: no id, no picture
function named(username: string): UserData {
  return {
    username,
    // A slug is its username in lowercase
    handle: username.toLowerCase(),
    profilePictures: [],
    // Kick's feed doesn't say who follows
    follower: false,
    platform: "kick",
  };
}

function toChat(e: ChatMessage): ChatEvent {
  // TikTok's shape: content without the emotes, each at its place in it
  let content = "";
  let emotes: Emotes[] = [];
  let last = 0;
  for (const match of e.content.matchAll(EMOTE)) {
    content += e.content.slice(last, match.index);
    emotes.push({
      emoteID: `kick:${match[1]}`,
      images: [emotePicture(match[1])],
      index: content.length,
    });
    last = match.index + match[0].length;
  }
  content += e.content.slice(last);
  // Only emotes, as TikTok sends an emote-only comment
  if (!content.trim()) {
    content = "";
    emotes = emotes.map((emote) => ({ ...emote, index: 0 }));
  }
  const list = e.sender.identity?.badges ?? [];
  const badges = new Set(list.map((b) => b.type));
  const months = Number(
    list.find((b) => b.type === "subscriber" || b.type === "founder")?.count,
  );
  return {
    user: {
      username: e.sender.username,
      handle: e.sender.slug,
      profilePictures: [],
      follower: false,
      userId: `kick:${e.sender.id}`,
      platform: "kick",
      // Music's host check reads it
      moderator: badges.has("broadcaster") || badges.has("moderator"),
      superfan: badges.has("subscriber") || badges.has("founder"),
      ...(months > 0 && { subMonths: months }),
    },
    comment: { content, emotes, lang: "" },
  };
}

/** The event a publication is, or null for one Tokio doesn't use. */
export function fromPublication(event: string, data: any): Mapped | null {
  if (!data || typeof data !== "object") return null;
  switch (eventName(event)) {
    case "ChatMessageEvent": {
      const e: ChatMessage = data;
      if (typeof e.content !== "string" || !e.sender) return null;
      return { event: TOKIO_EVENTS.CHAT, data: toChat(e) };
    }
    case "SubscriptionEvent": {
      const e: Subscription = data;
      return {
        event: TOKIO_EVENTS.SUBSCRIBE,
        data: {
          user: named(e.username),
          tier: "",
          months: e.months || 1,
          message: "",
        },
      };
    }
    case "GiftedSubscriptionsEvent": {
      const e: GiftedSubscriptions = data;
      return {
        event: TOKIO_EVENTS.GIFT_SUB,
        data: {
          user: named(e.gifter_username),
          count: e.gifted_usernames?.length ?? 0,
          tier: "",
        },
      };
    }
    case "KicksGifted": {
      const e: KicksGifted = data;
      if (!e.sender || !e.gift) return null;
      const picture = e.sender.profile_picture;
      return {
        event: TOKIO_EVENTS.GIFT,
        data: {
          user: {
            username: e.sender.username,
            handle: e.sender.username.toLowerCase(),
            profilePictures: picture ? [picture] : [],
            follower: false,
            userId: `kick:${e.sender.id}`,
            platform: "kick",
          },
          // Each Kick its own, its price as coins (the user's call)
          gift: {
            id: `kick:${e.gift.gift_id}`,
            name: e.gift.name,
            coins: e.gift.amount,
            image: "",
            type: 0,
            comboCount: 1,
            repeatEnd: true,
          },
        },
      };
    }
    case "StreamHostEvent": {
      const e: StreamHost = data;
      return {
        event: TOKIO_EVENTS.RAID,
        data: { user: named(e.host_username), viewers: e.number_viewers ?? 0 },
      };
    }
    case "RewardRedeemedEvent": {
      const e: RewardRedeemed = data;
      return {
        event: TOKIO_EVENTS.REDEEM,
        data: {
          user: named(e.username ?? e.user?.username ?? ""),
          reward: {
            id: String(e.reward_id ?? e.reward?.id ?? ""),
            title: e.reward_title ?? e.reward?.title ?? "",
            cost: e.reward?.cost ?? 0,
          },
          input: e.user_input ?? "",
        },
      };
    }
    // Bans, deletions, pins, polls, clears, hosts leaving and the rest
    default:
      return null;
  }
}
