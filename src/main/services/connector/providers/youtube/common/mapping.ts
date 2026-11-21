// YouTube's LIVE chat actions, mapped to Tokio's events. Only the fields
// read here are typed, as youtube.com's own chat sends them.
import {
  ChatEvent,
  Emotes,
  TOKIO_EVENTS,
  TokioEventMap,
  UserData,
} from "@/common/types";

type Thumbnail = { url: string; width?: number; height?: number };
type Thumbnails = { thumbnails?: Thumbnail[] };
type Text = { simpleText?: string; runs?: Run[] };
type Run = {
  text?: string;
  emoji?: {
    emojiId: string;
    isCustomEmoji?: boolean;
    image?: Thumbnails;
  };
};
type Badge = {
  liveChatAuthorBadgeRenderer?: {
    icon?: { iconType?: string };
    customThumbnail?: Thumbnails;
    tooltip?: string;
  };
};

// What every chat item's author carries
type Author = {
  authorName?: { simpleText?: string };
  authorPhoto?: Thumbnails;
  authorBadges?: Badge[];
  authorExternalChannelId?: string;
};

type TextMessage = Author & { message?: Text };
type PaidMessage = Author & { purchaseAmountText?: Text; message?: Text };
type PaidSticker = Author & {
  purchaseAmountText?: Text;
  sticker?: Thumbnails;
};
type Membership = Author & { headerPrimaryText?: Text; message?: Text };
type GiftPurchase = {
  authorExternalChannelId?: string;
  header?: {
    liveChatSponsorshipsHeaderRenderer?: Author & { primaryText?: Text };
  };
};
type Sources = { sources?: Thumbnail[] };
type GiftMessage = {
  text?: { content?: string };
  authorName?: { content?: string };
  authorAvatar?: { avatarViewModel?: { image?: Sources } };
  giftImage?: Sources;
};

export type ChatAction = {
  addChatItemAction?: { item?: Record<string, unknown> };
  [action: string]: unknown;
};

// The events mapped here, each with its payload
type Mappable =
  | TOKIO_EVENTS.CHAT
  | TOKIO_EVENTS.SUPER_CHAT
  | TOKIO_EVENTS.SUBSCRIBE
  | TOKIO_EVENTS.GIFT_SUB
  | TOKIO_EVENTS.GIFT;
export type Mapped = {
  [K in Mappable]: { event: K; data: TokioEventMap[K] };
}[Mappable];

// The largest picture, by width, the last when none says
const largest = (pictures?: Thumbnail[]) =>
  pictures?.reduce<Thumbnail | undefined>(
    (best, p) => (!best || (p.width ?? 0) >= (best.width ?? 0) ? p : best),
    undefined,
  )?.url ?? "";

// YouTube's static pictures come without a scheme
const https = (url: string) => (url.startsWith("//") ? `https:${url}` : url);

const textOf = (text?: Text) =>
  text?.simpleText ??
  (text?.runs ?? [])
    .map(
      (run) =>
        run.text ??
        (run.emoji?.isCustomEmoji ? "" : (run.emoji?.emojiId ?? "")),
    )
    .join("");

function youtubeUser(author: Author): UserData {
  const handle = (author.authorName?.simpleText ?? "").trim().replace(/^@/, "");
  const badges = (author.authorBadges ?? []).map(
    (b) => b.liveChatAuthorBadgeRenderer,
  );
  const user: UserData = {
    username: handle,
    handle,
    profilePictures: [],
    // YouTube doesn't say who subscribed to the channel
    follower: false,
    // The owner too: music's host check reads it
    moderator: badges.some((b) =>
      ["OWNER", "MODERATOR"].includes(b?.icon?.iconType ?? ""),
    ),
    // Members wear the channel's own badge
    superfan: badges.some((b) => b?.customThumbnail),
    platform: "youtube",
  };
  const picture = largest(author.authorPhoto?.thumbnails);
  if (picture) user.profilePictures = [picture];
  if (author.authorExternalChannelId) {
    user.userId = `youtube:${author.authorExternalChannelId}`;
  }
  return user;
}

export function toChat(e: TextMessage): ChatEvent {
  // TikTok's shape: content without the custom emoji, each at its place in it
  let content = "";
  let emotes: Emotes[] = [];
  for (const run of e.message?.runs ?? []) {
    if (run.emoji?.isCustomEmoji) {
      emotes.push({
        emoteID: `youtube:${run.emoji.emojiId}`,
        images: [https(largest(run.emoji.image?.thumbnails))],
        index: content.length,
      });
    } else {
      content += run.text ?? run.emoji?.emojiId ?? "";
    }
  }
  // Only custom emoji, as TikTok sends an emote-only comment
  if (!content.trim()) {
    content = "";
    emotes = emotes.map((emote) => ({ ...emote, index: 0 }));
  }
  return { user: youtubeUser(e), comment: { content, emotes, lang: "" } };
}

const fromPaidMessage = (e: PaidMessage): Mapped => ({
  event: TOKIO_EVENTS.SUPER_CHAT,
  data: {
    user: youtubeUser(e),
    amount: textOf(e.purchaseAmountText),
    message: textOf(e.message).trim(),
    sticker: "",
  },
});

const fromPaidSticker = (e: PaidSticker): Mapped => ({
  event: TOKIO_EVENTS.SUPER_CHAT,
  data: {
    user: youtubeUser(e),
    amount: textOf(e.purchaseAmountText),
    message: "",
    sticker: https(largest(e.sticker?.thumbnails)),
  },
});

// A milestone's header says "Member for 6 months"; a new member has none
function fromMembership(e: Membership): Mapped {
  const months = (e.headerPrimaryText?.runs ?? [])
    .map((run) => run.text?.trim() ?? "")
    .find((text) => /^\d+$/.test(text));
  return {
    event: TOKIO_EVENTS.SUBSCRIBE,
    data: {
      user: youtubeUser(e),
      tier: "",
      months: months ? Number(months) : 1,
      message: textOf(e.message).trim(),
    },
  };
}

// "Sent 20 Channel gift memberships": the count is the first number
function fromGiftPurchase(e: GiftPurchase): Mapped {
  const header = e.header?.liveChatSponsorshipsHeaderRenderer ?? {};
  const count = (header.primaryText?.runs ?? [])
    .map((run) => run.text?.trim() ?? "")
    .find((text) => /^\d+$/.test(text));
  return {
    event: TOKIO_EVENTS.GIFT_SUB,
    data: {
      user: youtubeUser({
        ...header,
        authorExternalChannelId: e.authorExternalChannelId,
      }),
      count: count ? Number(count) : 1,
      tier: "",
    },
  };
}

// A YouTube Gift, bought with Jewels. Its author has no channel id, so the
// handle is the id.
function fromGiftMessage(e: GiftMessage): Mapped {
  const handle = (e.authorName?.content ?? "").trim().replace(/^@/, "");
  const picture = largest(e.authorAvatar?.avatarViewModel?.image?.sources);
  const image = https(largest(e.giftImage?.sources));
  // ".../gift/assets/vicecity_heart_v2.png=w640-h640" is vicecity_heart_v2
  const file = image.split("/").pop()?.split(/[.=]/)[0] ?? "";
  return {
    event: TOKIO_EVENTS.GIFT,
    data: {
      user: {
        username: handle,
        handle,
        profilePictures: picture ? [picture] : [],
        follower: false,
        userId: `youtube:@${handle}`,
        platform: "youtube",
      },
      gift: {
        id: `youtube:${file}`,
        name: (e.text?.content ?? "").trim().replace(/^sent /i, ""),
        image,
        // shortcut: YouTube doesn't send what a Gift cost, so it counts no
        // coins; give Gifts a price once the user picks how
        coins: 0,
        type: 0,
        // Each is its own message, mostly from different viewers
        comboCount: 1,
        repeatEnd: true,
      },
    },
  };
}

const RENDERERS: Record<string, (item: any) => Mapped> = {
  liveChatTextMessageRenderer: (e) => ({
    event: TOKIO_EVENTS.CHAT,
    data: toChat(e),
  }),
  liveChatPaidMessageRenderer: fromPaidMessage,
  liveChatPaidStickerRenderer: fromPaidSticker,
  liveChatMembershipItemRenderer: fromMembership,
  liveChatSponsorshipsGiftPurchaseAnnouncementRenderer: fromGiftPurchase,
  giftMessageViewModel: fromGiftMessage,
  // Dropped: each recipient of gifted memberships (the purchase counted
  // them, as Twitch's community gifts), placeholders, which never fill in
  // for a reader, and viewer engagement messages
};

// A chat action as an event, or null for the rest: polls, banners,
// tickers, removals, moderation and replays
export function fromAction(action: ChatAction): Mapped | null {
  const item = action.addChatItemAction?.item;
  if (!item) return null;
  for (const [renderer, map] of Object.entries(RENDERERS)) {
    if (item[renderer]) return map(item[renderer]);
  }
  return null;
}
