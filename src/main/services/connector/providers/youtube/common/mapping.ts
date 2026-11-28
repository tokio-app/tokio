// YouTube's LIVE chat actions, mapped to Tokio's events. Only the fields
// read here are typed, as youtube.com's own chat sends them.
import {
  ChatEvent,
  Emotes,
  TOKIO_EVENTS,
  TokioEventMap,
  UserData,
} from "@/common/types";
import { emoteOnly } from "../../../common";

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
  giftImageA11yLabel?: string;
};
// The card a Gift shows over the chat, which names its sender's channel
type GiftWidget = {
  content?: {
    giftAttributionItemViewModel?: { authorName?: { content?: string } };
    elementRenderer?: {
      compatibilityOptions?: { liveChatAuthorExternalChannelId?: string };
    };
  };
};

export type ChatAction = {
  addChatItemAction?: { item?: Record<string, unknown> };
  updateOrAddInteractivityWidgetAction?: {
    widgetRenderer?: { interactivityWidgetRenderer?: GiftWidget };
  };
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

// The member badge's tooltip says its milestone, "Member (2 months)" or
// "Member (1 year)", in English (hl=en); "New member" says none: 0
function memberMonths(badges: Badge["liveChatAuthorBadgeRenderer"][]) {
  for (const badge of badges) {
    if (!badge?.customThumbnail) continue;
    const [, count, unit] =
      badge.tooltip?.match(/\((\d+) (month|year)s?\)/) ?? [];
    if (count) return Number(count) * (unit === "year" ? 12 : 1);
  }
  return 0;
}

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
  const months = memberMonths(badges);
  if (months > 0) user.subMonths = months;
  const picture = largest(author.authorPhoto?.thumbnails);
  if (picture) user.profilePictures = [picture];
  if (author.authorExternalChannelId) {
    user.userId = `youtube:${author.authorExternalChannelId}`;
  }
  return user;
}

function toChat(e: TextMessage): ChatEvent {
  // TikTok's shape: content without the custom emoji, each at its place in it
  let content = "";
  const emotes: Emotes[] = [];
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
  return {
    user: youtubeUser(e),
    comment: { ...emoteOnly(content, emotes), lang: "" },
  };
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

// The first number in a text, "1,000" included, or 1 when it has none
const firstNumber = (text?: Text) => {
  const digits = textOf(text).match(/\d[\d,]*/)?.[0];
  return digits ? Number(digits.replace(/,/g, "")) : 1;
};

// A milestone's header says "Member for 6 months"; a new member has none
const fromMembership = (e: Membership): Mapped => ({
  event: TOKIO_EVENTS.SUBSCRIBE,
  data: {
    user: youtubeUser(e),
    tier: "",
    months: firstNumber(e.headerPrimaryText),
    message: textOf(e.message).trim(),
  },
});

// "Sent 20 Channel gift memberships", "Sent a Channel gift membership": the
// count comes right after "Sent", since the channel's name can hold digits
function fromGiftPurchase(e: GiftPurchase): Mapped {
  const header = e.header?.liveChatSponsorshipsHeaderRenderer ?? {};
  const digits = textOf(header.primaryText).match(/^Sent (\d[\d,]*) /)?.[1];
  return {
    event: TOKIO_EVENTS.GIFT_SUB,
    data: {
      user: youtubeUser({
        ...header,
        authorExternalChannelId: e.authorExternalChannelId,
      }),
      count: digits ? Number(digits.replace(/,/g, "")) : 1,
      tier: "",
    },
  };
}

// A Gift's handle, "@name " in its chat item, "@name" in its card
const handleOf = (name?: string) => (name ?? "").trim().replace(/^@/, "");

// "comboed x3 Yes for 6 Jewels": the count, then the name.
// shortcut: a combo counts its own count, though no LIVE has shown yet
// whether YouTube also sends each of its gifts as a "sent Yes"; on a LIVE
// with combos, check that a "comboed x3" doesn't follow three of those, or
// they'd count twice
const COMBO = /^comboed x(\d[\d,]*) (.+) for [\d,]+ Jewels?$/i;

// A YouTube Gift, bought with Jewels: one ("sent Star"), or a combo of the
// same one. YouTube doesn't say what a single Gift costs, so it counts no
// coins. Its author has no channel id, so the handle is the id until the
// provider knows it.
function fromGiftMessage(e: GiftMessage): Mapped {
  const handle = handleOf(e.authorName?.content);
  const picture = largest(e.authorAvatar?.avatarViewModel?.image?.sources);
  const image = https(largest(e.giftImage?.sources));
  // ".../gift/assets/vicecity_heart_v2.png=w640-h640" is vicecity_heart_v2
  const file = image.split("/").pop()?.split(/[.=]/)[0] ?? "";
  const text = (e.text?.content ?? "").trim();
  const [, digits = "", comboName] = text.match(COMBO) ?? [];
  // A combo it can't read is one gift
  const comboCount = Number(digits.replace(/,/g, "")) || 1;
  // "@handle sent a gift, Yes", a combo's too
  const name = (
    e.giftImageA11yLabel?.split(" sent a gift, ")[1] ??
    comboName ??
    text.replace(/^sent /i, "")
  ).trim();
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
        name,
        image,
        coins: 0,
        type: 0,
        comboCount,
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

// A Gift's card, which comes in the same poll before its chat item: its
// sender's handle and viewer id, or null for any other action. It's never a
// gift itself: a card can come again for the same Gift.
export function fromWidget(
  action: ChatAction,
): { handle: string; userId: string } | null {
  const content =
    action.updateOrAddInteractivityWidgetAction?.widgetRenderer
      ?.interactivityWidgetRenderer?.content;
  const handle = handleOf(
    content?.giftAttributionItemViewModel?.authorName?.content,
  );
  const channel =
    content?.elementRenderer?.compatibilityOptions
      ?.liveChatAuthorExternalChannelId;
  return handle && channel ? { handle, userId: `youtube:${channel}` } : null;
}
