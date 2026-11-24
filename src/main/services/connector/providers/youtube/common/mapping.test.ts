import { TOKIO_EVENTS } from "@/common/types";
import { describe, expect, it } from "vitest";
import { fromAction, type ChatAction } from "./mapping";

// Shaped like youtube.com's chat actions, with made-up viewers
const add = (renderer: string, item: unknown): ChatAction => ({
  addChatItemAction: { item: { [renderer]: item } },
});

const photo = {
  thumbnails: [
    { url: "https://yt.example/a/s32.jpg", width: 32, height: 32 },
    { url: "https://yt.example/a/s64.jpg", width: 64, height: 64 },
  ],
};
const author = {
  authorName: { simpleText: "@viewer32" },
  authorPhoto: photo,
  authorExternalChannelId: "UCviewer32",
};
const viewer = {
  username: "viewer32",
  handle: "viewer32",
  profilePictures: ["https://yt.example/a/s64.jpg"],
  follower: false,
  moderator: false,
  superfan: false,
  userId: "youtube:UCviewer32",
  platform: "youtube",
};

const icon = (iconType: string) => ({
  liveChatAuthorBadgeRenderer: { icon: { iconType }, tooltip: iconType },
});
const member = {
  liveChatAuthorBadgeRenderer: {
    customThumbnail: { thumbnails: [{ url: "https://yt.example/badge" }] },
    tooltip: "Member (2 months)",
  },
};

const custom = (id: string) => ({
  emoji: {
    emojiId: id,
    isCustomEmoji: true,
    image: {
      thumbnails: [
        { url: `https://yt.example/${id}/24`, width: 24 },
        { url: `https://yt.example/${id}/48`, width: 48 },
      ],
    },
  },
});

describe("fromAction", () => {
  it("maps a chat message and its viewer", () => {
    const action = add("liveChatTextMessageRenderer", {
      ...author,
      message: { runs: [{ text: "Hi chat " }, { emoji: { emojiId: "👋" } }] },
    });

    expect(fromAction(action)).toEqual({
      event: TOKIO_EVENTS.CHAT,
      data: {
        user: viewer,
        comment: { content: "Hi chat 👋", emotes: [], lang: "" },
      },
    });
  });

  it("flags the owner and moderators, and members as superfans", () => {
    const badged = (authorBadges: unknown[]) =>
      fromAction(
        add("liveChatTextMessageRenderer", {
          ...author,
          authorBadges,
          message: { runs: [{ text: "hey" }] },
        }),
      )?.data.user;

    expect(badged([icon("OWNER")])).toMatchObject({ moderator: true });
    expect(badged([icon("MODERATOR"), member])).toMatchObject({
      moderator: true,
      superfan: true,
    });
    expect(badged([icon("VERIFIED")])).toMatchObject({
      moderator: false,
      superfan: false,
    });
  });

  it("reads a member's months off their badge's tooltip", () => {
    const months = (tooltip: string) =>
      fromAction(
        add("liveChatTextMessageRenderer", {
          ...author,
          authorBadges: [
            icon("MODERATOR"),
            {
              liveChatAuthorBadgeRenderer: {
                ...member.liveChatAuthorBadgeRenderer,
                tooltip,
              },
            },
          ],
          message: { runs: [{ text: "hey" }] },
        }),
      )?.data.user.subMonths;

    expect(months("Member (2 months)")).toBe(2);
    expect(months("Member (1 month)")).toBe(1);
    expect(months("Member (1 year)")).toBe(12);
    expect(months("Member (3 years)")).toBe(36);
    expect(months("New member")).toBeUndefined();
  });

  it("leaves custom emoji out of the text, each at its place", () => {
    const action = add("liveChatTextMessageRenderer", {
      ...author,
      message: { runs: [{ text: "gg " }, custom("UCx/cat"), { text: " wp" }] },
    });

    expect(fromAction(action)?.data).toMatchObject({
      comment: {
        content: "gg  wp",
        emotes: [
          {
            emoteID: "youtube:UCx/cat",
            images: ["https://yt.example/UCx/cat/48"],
            index: 3,
          },
        ],
      },
    });
  });

  it("sends a message of custom emoji only with no text, as TikTok's", () => {
    const action = add("liveChatTextMessageRenderer", {
      ...author,
      message: { runs: [custom("a"), { text: " " }, custom("b")] },
    });

    const data = fromAction(action)?.data;
    expect(data && "comment" in data && data.comment).toMatchObject({
      content: "",
      emotes: [
        { emoteID: "youtube:a", index: 0 },
        { emoteID: "youtube:b", index: 0 },
      ],
    });
  });

  it("maps a Super Chat with its amount and message", () => {
    const action = add("liveChatPaidMessageRenderer", {
      ...author,
      purchaseAmountText: { simpleText: "$4.99" },
      message: { runs: [{ text: "Love the " }, { text: "stream" }] },
    });

    expect(fromAction(action)).toEqual({
      event: TOKIO_EVENTS.SUPER_CHAT,
      data: {
        user: viewer,
        amount: "$4.99",
        message: "Love the stream",
        sticker: "",
      },
    });
    // A Super Chat without a message
    expect(
      fromAction(
        add("liveChatPaidMessageRenderer", {
          ...author,
          purchaseAmountText: { simpleText: "MX$100.00" },
        }),
      )?.data,
    ).toMatchObject({ amount: "MX$100.00", message: "" });
  });

  it("maps a Super Sticker with its largest picture", () => {
    const action = add("liveChatPaidStickerRenderer", {
      ...author,
      purchaseAmountText: { simpleText: "$2.00" },
      sticker: {
        thumbnails: [
          { url: "//yt.example/sticker=s40", width: 40 },
          { url: "//yt.example/sticker=s80", width: 80 },
        ],
      },
    });

    expect(fromAction(action)).toEqual({
      event: TOKIO_EVENTS.SUPER_CHAT,
      data: {
        user: viewer,
        amount: "$2.00",
        message: "",
        sticker: "https://yt.example/sticker=s80",
      },
    });
  });

  it("maps a new member and a milestone with its months", () => {
    expect(fromAction(add("liveChatMembershipItemRenderer", author))).toEqual({
      event: TOKIO_EVENTS.SUBSCRIBE,
      data: { user: viewer, tier: "", months: 1, message: "" },
    });

    const milestone = add("liveChatMembershipItemRenderer", {
      ...author,
      headerPrimaryText: {
        runs: [{ text: "Member for " }, { text: "6" }, { text: " months" }],
      },
      message: { runs: [{ text: "Half a year!" }] },
    });
    expect(fromAction(milestone)?.data).toMatchObject({
      months: 6,
      message: "Half a year!",
    });
    // The same header as one plain text
    const plain = add("liveChatMembershipItemRenderer", {
      ...author,
      headerPrimaryText: { simpleText: "Member for 13 months" },
    });
    expect(fromAction(plain)?.data).toMatchObject({ months: 13 });
  });

  it("maps gifted memberships with their count, once", () => {
    const purchase = (runs: { text: string }[]) =>
      add("liveChatSponsorshipsGiftPurchaseAnnouncementRenderer", {
        authorExternalChannelId: "UCviewer32",
        header: {
          liveChatSponsorshipsHeaderRenderer: {
            authorName: author.authorName,
            authorPhoto: photo,
            primaryText: { runs },
          },
        },
      });

    expect(
      fromAction(
        purchase([
          { text: "Sent " },
          { text: "20" },
          { text: " " },
          { text: "Channel" },
          { text: " gift memberships" },
        ]),
      ),
    ).toEqual({
      event: TOKIO_EVENTS.GIFT_SUB,
      data: { user: viewer, count: 20, tier: "" },
    });
    expect(
      fromAction(purchase([{ text: "Sent 1,000 Channel gift memberships" }]))
        ?.data,
    ).toMatchObject({ count: 1000 });
    expect(
      fromAction(purchase([{ text: "Sent a Channel gift membership" }]))?.data,
    ).toMatchObject({ count: 1 });
    // Each recipient's, already counted by the purchase
    expect(
      fromAction(
        add("liveChatSponsorshipsGiftRedemptionAnnouncementRenderer", author),
      ),
    ).toBeNull();
  });

  it("maps a YouTube Gift, named by its picture", () => {
    const action = add("giftMessageViewModel", {
      text: { content: "sent Vice City heart" },
      authorName: { content: "@viewer32 " },
      authorAvatar: {
        avatarViewModel: { image: { sources: photo.thumbnails } },
      },
      giftImage: {
        sources: [
          {
            url: "//www.gstatic.com/youtube/img/pdg/gift/assets/vicecity_heart_v2.png=w480-h480",
            width: 480,
          },
          {
            url: "//www.gstatic.com/youtube/img/pdg/gift/assets/vicecity_heart_v2.png=w640-h640",
            width: 640,
          },
        ],
      },
    });

    expect(fromAction(action)).toEqual({
      event: TOKIO_EVENTS.GIFT,
      data: {
        user: {
          username: "viewer32",
          handle: "viewer32",
          profilePictures: ["https://yt.example/a/s64.jpg"],
          follower: false,
          userId: "youtube:@viewer32",
          platform: "youtube",
        },
        gift: {
          id: "youtube:vicecity_heart_v2",
          name: "Vice City heart",
          image:
            "https://www.gstatic.com/youtube/img/pdg/gift/assets/vicecity_heart_v2.png=w640-h640",
          coins: 0,
          type: 0,
          comboCount: 1,
          repeatEnd: true,
        },
      },
    });
  });

  it("ignores everything else", () => {
    const ignored: ChatAction[] = [
      add("liveChatPlaceholderItemRenderer", { id: "1" }),
      add("liveChatViewerEngagementMessageRenderer", { id: "2" }),
      { addChatItemAction: {} },
      { updateLiveChatPollAction: {} },
      { addBannerToLiveChatCommand: {} },
      { addLiveChatTickerItemAction: { item: {} } },
      { removeChatItemAction: { targetItemId: "1" } },
      { removeChatItemByAuthorAction: {} },
      { liveChatReportModerationStateCommand: {} },
      { updateOrAddInteractivityWidgetAction: {} },
      {
        replayChatItemAction: {
          actions: [add("liveChatTextMessageRenderer", author)],
        },
      },
    ];

    for (const action of ignored) expect(fromAction(action)).toBeNull();
  });
});
