// The LIVE Tokio is connected to, for the Home page: when it started, what
// viewers did in it and how much.

import type { ChatTranslation, Platform } from "./connector";

export type ActivityUser = {
  handle: string;
  // The nickname, or the handle when there's none
  name: string;
  // Empty when the platform sent no avatar
  picture: string;
  // Missing means TikTok
  platform?: Platform;
};

// Something a viewer did
export type Activity =
  | {
      type: "chat";
      user: ActivityUser;
      text: string;
      emotes: string[];
      translation?: ChatTranslation;
    }
  // `coins` is what the whole combo cost, in the sender's platform's gift
  // currency: TikTok's coins or Kick's Kicks
  | {
      type: "gift";
      user: ActivityUser;
      gift: { name: string; image: string; count: number; coins: number };
    }
  | { type: "follow" | "share" | "superfan"; user: ActivityUser }
  // text is a resub's or cheer's message, or a redeem's input
  | { type: "sub"; user: ActivityUser; months: number; text: string }
  | { type: "giftsub"; user: ActivityUser; count: number }
  | { type: "cheer"; user: ActivityUser; bits: number; text: string }
  | { type: "raid"; user: ActivityUser; viewers: number }
  | { type: "redeem"; user: ActivityUser; reward: string; text: string }
  // amount as YouTube shows it, sticker a Super Sticker's picture or ""
  | {
      type: "superchat";
      user: ActivityUser;
      amount: string;
      text: string;
      sticker: string;
    }
  // Joins in a row share one item: the first users and how many joined
  | { type: "join"; users: ActivityUser[]; count: number };

// `id` is unique across LIVEs
export type ActivityItem = Activity & { id: number };

// Counted since Tokio connected. Each currency is its platform's alone, never
// added to another: coins TikTok's, kicks Kick's, bits Twitch's cheers.
export type LiveTotals = {
  followers: number;
  shares: number;
  gifts: number;
  coins: number;
  kicks: number;
  bits: number;
  // YouTube's Super Chats and Super Stickers, how many
  superChats: number;
  // Gifted subs: Twitch's, YouTube's gifted memberships and Kick's
  giftSubs: number;
};

// One platform's part of the LIVE
export type PlatformLive = {
  totals: LiveTotals;
  // Each minute's highest viewer count on it, from the LIVE's first minute:
  // 0 before its first count and after it left
  viewers: number[];
};

export type LiveSession = {
  // When Tokio connected, null while it isn't
  startedAt: number | null;
  totals: LiveTotals;
  // Newest first. Kept when the LIVE ends, until the next one starts.
  activity: ActivityItem[];
  // Each minute's highest viewer count since startedAt, the last one still
  // counting. Kept like the feed.
  viewers: number[];
  // Each platform's own numbers, for the platforms that sent any in this
  // LIVE. totals and viewers count them all.
  platforms: Partial<Record<Platform, PlatformLive>>;
  // YouTube's Super Chats in US dollars, at the day's exchange rates; null
  // while they haven't loaded
  usd: number | null;
};

// A viewer who sent gifts, keyed by their user id (see UserData). Name,
// handle and picture are their latest gift's.
export type Gifter = {
  userId: string;
  username: string;
  handle: string;
  // TikTok's link, which can expire. Empty when TikTok sent none.
  picture: string;
  // In their platform's currency (PLATFORM_CURRENCY): TikTok's coins, Kick's
  // Kicks, Twitch's Bits or YouTube's Super Chats in US dollars
  coins: number;
  gifts: number;
  // Subs they gifted (Twitch, YouTube's memberships, Kick)
  giftSubs: number;
  // When their last gift came, in ms since the epoch
  giftedAt: number;
  // Missing means TikTok
  platform?: Platform;
};

// One platform's part of a LIVE in the history: its money in its currency
// (PLATFORM_CURRENCY), its gifts and its gifted subs
export type HistoryTotals = { amount: number; gifts: number; giftSubs: number };

// A LIVE the profile kept, from the connect to the disconnect like Home's
// session
export type LiveSummary = {
  // The @username Tokio connected to, without the @
  username: string;
  startedAt: number;
  // While it goes on, when it was last saved
  endedAt: number;
  // Counted since Tokio connected: TikTok's coins, as Tokio kept them before
  // other platforms came, and every platform's gifts
  coins: number;
  gifts: number;
  // Each platform's part; a LIVE saved without it was TikTok's alone
  platforms: Partial<Record<Platform, HistoryTotals>>;
};

// A clock minute of a LIVE in which gifts came
export type GiftMinute = {
  // Counted from the minute the LIVE started in
  minute: number;
  // What each viewer sent in it, by user id: the amount in their platform's
  // currency (PLATFORM_CURRENCY), gifts and gifted subs. What came without
  // an id goes under its platform's: "" for TikTok, then "kick:", "twitch:"
  // and "youtube:". Older files have two numbers, read as no gifted subs.
  gifters: Record<string, [amount: number, gifts: number, giftSubs: number]>;
};

// A LIVE with every viewer who sent gifts in it, the most first, and
// the minutes its gifts came in, so dates that cut it take only those
export type LiveRecord = LiveSummary & {
  gifters: Gifter[];
  minutes: GiftMinute[];
};

// A gifter found by a search, with their place among their platform's
// gifters (1, the most)
export type RankedGifter = Gifter & { rank: number };

// For Gift stats: the finished LIVEs, newest first, and all time's top
// gifters
export type LiveHistory = { lives: LiveSummary[]; gifters: Gifter[] };
