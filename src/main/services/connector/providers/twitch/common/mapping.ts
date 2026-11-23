// Twitch's EventSub events, mapped to Tokio's. Only the fields read here are
// typed; Twitch's reference lists the rest.
import {
  ChatEvent,
  Emotes,
  TOKIO_EVENTS,
  TokioEventMap,
  UserData,
} from "@/common/types";

type Fragment = {
  type: "text" | "cheermote" | "emote" | "mention";
  text: string;
  emote?: { id: string } | null;
};
type Message = { text: string; fragments: Fragment[] };
// A subscriber's or founder's info is their months subscribed
type Badge = { set_id: string; info?: string };

export type ChatMessageEvent = {
  chatter_user_id: string;
  chatter_user_login: string;
  chatter_user_name: string;
  message: Message;
  badges: Badge[];
  // Set in a Shared Chat: the channel the message was sent in
  source_broadcaster_user_id?: string | null;
};

export type ChatNotificationEvent = {
  chatter_user_id: string;
  chatter_user_login: string;
  chatter_user_name: string;
  chatter_is_anonymous: boolean;
  badges: Badge[];
  message?: Message | null;
  notice_type: string;
  sub?: { sub_tier: string; is_prime: boolean } | null;
  resub?: {
    cumulative_months: number;
    sub_tier: string;
    is_prime: boolean;
  } | null;
  sub_gift?: { sub_tier: string; community_gift_id?: string | null } | null;
  community_sub_gift?: { total: number; sub_tier: string } | null;
  raid?: {
    user_id: string;
    user_login: string;
    user_name: string;
    viewer_count: number;
    profile_image_url: string;
  } | null;
};

type Viewer = {
  user_id?: string | null;
  user_login?: string | null;
  user_name?: string | null;
};

export type FollowEvent = Viewer;

export type BitsUseEvent = Viewer & {
  bits: number;
  type: string;
  message?: Message | null;
};

export type RedemptionEvent = Viewer & {
  user_input: string;
  reward: { id: string; title: string; cost: number };
};

// The events mapped here, each with its payload
type Mappable =
  | TOKIO_EVENTS.FOLLOW
  | TOKIO_EVENTS.SUBSCRIBE
  | TOKIO_EVENTS.GIFT_SUB
  | TOKIO_EVENTS.CHEER
  | TOKIO_EVENTS.RAID
  | TOKIO_EVENTS.REDEEM;
export type Mapped = {
  [K in Mappable]: { event: K; data: TokioEventMap[K] };
}[Mappable];

const emotePicture = (id: string) =>
  `https://static-cdn.jtvnw.net/emoticons/v2/${id}/default/dark/2.0`;

function twitchUser(
  id: string | null | undefined,
  login: string | null | undefined,
  name: string | null | undefined,
): UserData {
  // Anonymous gifts and cheers: a viewer with no account to name
  if (!id) {
    return {
      username: "Anonymous",
      handle: "",
      profilePictures: [],
      follower: false,
      platform: "twitch",
    };
  }
  return {
    username: name || login || "",
    handle: login ?? "",
    profilePictures: [],
    // Twitch doesn't say who follows
    follower: false,
    userId: `twitch:${id}`,
    platform: "twitch",
  };
}

// What a viewer wrote, without emote codes and cheermotes, so TTS never
// reads "Kappa" or "Cheer100"
const textOf = (message?: Message | null) =>
  (message?.fragments ?? [])
    .filter((f) => f.type === "text" || f.type === "mention")
    .map((f) => f.text)
    .join("")
    .trim();

export function toChat(
  e: ChatMessageEvent,
  broadcasterId: string,
): ChatEvent | null {
  // Other channels' viewers in a Shared Chat
  if (
    e.source_broadcaster_user_id &&
    e.source_broadcaster_user_id !== broadcasterId
  ) {
    return null;
  }
  // TikTok's shape: content without the emotes, each at its place in it
  let content = "";
  let emotes: Emotes[] = [];
  for (const f of e.message.fragments) {
    if (f.type === "emote" && f.emote) {
      const id = f.emote.id;
      emotes.push({
        emoteID: `twitch:${id}`,
        images: [emotePicture(id)],
        index: content.length,
      });
    } else if (f.type === "text" || f.type === "mention") {
      content += f.text;
    }
  }
  // Only emotes and cheermotes, as TikTok sends an emote-only comment
  if (!content.trim()) {
    content = "";
    emotes = emotes.map((emote) => ({ ...emote, index: 0 }));
  }
  const badges = new Set(e.badges.map((b) => b.set_id));
  const months = Number(
    e.badges.find((b) => b.set_id === "subscriber" || b.set_id === "founder")
      ?.info,
  );
  return {
    user: {
      ...twitchUser(
        e.chatter_user_id,
        e.chatter_user_login,
        e.chatter_user_name,
      ),
      // Music's host check reads it
      moderator: badges.has("broadcaster") || badges.has("moderator"),
      superfan: badges.has("subscriber") || badges.has("founder"),
      ...(months > 0 && { subMonths: months }),
    },
    comment: { content, emotes, lang: "" },
  };
}

export function fromNotification(e: ChatNotificationEvent): Mapped | null {
  const user = e.chatter_is_anonymous
    ? twitchUser(null, null, null)
    : twitchUser(e.chatter_user_id, e.chatter_user_login, e.chatter_user_name);
  switch (e.notice_type) {
    case "sub":
      if (!e.sub) return null;
      return {
        event: TOKIO_EVENTS.SUBSCRIBE,
        data: {
          user,
          tier: e.sub.is_prime ? "prime" : e.sub.sub_tier,
          months: 1,
          message: "",
        },
      };
    case "resub":
      if (!e.resub) return null;
      return {
        event: TOKIO_EVENTS.SUBSCRIBE,
        data: {
          user,
          tier: e.resub.is_prime ? "prime" : e.resub.sub_tier,
          months: e.resub.cumulative_months,
          message: textOf(e.message),
        },
      };
    case "community_sub_gift":
      if (!e.community_sub_gift) return null;
      return {
        event: TOKIO_EVENTS.GIFT_SUB,
        data: {
          user,
          count: e.community_sub_gift.total,
          tier: e.community_sub_gift.sub_tier,
        },
      };
    case "sub_gift":
      // One of a community gift, which its own notice already counted
      if (!e.sub_gift || e.sub_gift.community_gift_id) return null;
      return {
        event: TOKIO_EVENTS.GIFT_SUB,
        data: { user, count: 1, tier: e.sub_gift.sub_tier },
      };
    case "raid": {
      const raid = e.raid;
      if (!raid) return null;
      const raider = twitchUser(raid.user_id, raid.user_login, raid.user_name);
      if (raid.profile_image_url) {
        raider.profilePictures = [raid.profile_image_url];
      }
      return {
        event: TOKIO_EVENTS.RAID,
        data: { user: raider, viewers: raid.viewer_count },
      };
    }
    // Shared Chat's copies, upgrades, announcements and the rest
    default:
      return null;
  }
}

export const fromFollow = (e: FollowEvent): Mapped => ({
  event: TOKIO_EVENTS.FOLLOW,
  data: { user: twitchUser(e.user_id, e.user_login, e.user_name) },
});

// Cheers and Power-ups alike. Chat's cheer field isn't read, which would
// count the same Bits twice.
export const fromBits = (e: BitsUseEvent): Mapped => ({
  event: TOKIO_EVENTS.CHEER,
  data: {
    user: twitchUser(e.user_id, e.user_login, e.user_name),
    bits: e.bits,
    message: textOf(e.message),
  },
});

export const fromRedemption = (e: RedemptionEvent): Mapped => ({
  event: TOKIO_EVENTS.REDEEM,
  data: {
    user: twitchUser(e.user_id, e.user_login, e.user_name),
    reward: { id: e.reward.id, title: e.reward.title, cost: e.reward.cost },
    input: e.user_input ?? "",
  },
});
