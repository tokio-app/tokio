// The LIVE Tokio is connected to, for the Home page: when it started, what
// viewers did in it and how much.

export type ActivityUser = {
  handle: string;
  // The nickname, or the handle when there's none
  name: string;
  // Empty when TikTok sent no avatar
  picture: string;
};

// Something a viewer did
export type Activity =
  | { type: "chat"; user: ActivityUser; text: string; emotes: string[] }
  // `coins` is what the whole combo cost
  | {
      type: "gift";
      user: ActivityUser;
      gift: { name: string; image: string; count: number; coins: number };
    }
  | { type: "follow" | "share" | "superfan"; user: ActivityUser }
  // Joins in a row share one item: the first users and how many joined
  | { type: "join"; users: ActivityUser[]; count: number };

// `id` is unique across LIVEs
export type ActivityItem = Activity & { id: number };

// Counted since Tokio connected
export type LiveTotals = {
  followers: number;
  shares: number;
  gifts: number;
  coins: number;
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
};

// A viewer who sent gifts, keyed by TikTok's user id. Name, handle and
// picture are their latest gift's.
export type Gifter = {
  userId: string;
  username: string;
  handle: string;
  // TikTok's link, which can expire. Empty when TikTok sent none.
  picture: string;
  coins: number;
  gifts: number;
  // When their last gift came, in ms since the epoch
  giftedAt: number;
};

// A LIVE the profile kept, from the connect to the disconnect like Home's
// session
export type LiveSummary = {
  // The @username Tokio connected to, without the @
  username: string;
  startedAt: number;
  // While it goes on, when it was last saved
  endedAt: number;
  // Counted since Tokio connected
  coins: number;
  gifts: number;
};

// A clock minute of a LIVE in which gifts came
export type GiftMinute = {
  // Counted from the minute the LIVE started in
  minute: number;
  // What each gifter sent in it, by user id ("" for gifts without one)
  gifters: Record<string, [coins: number, gifts: number]>;
};

// A LIVE with every viewer who sent gifts in it, the most coins first, and
// the minutes its gifts came in, so dates that cut it take only those
export type LiveRecord = LiveSummary & {
  gifters: Gifter[];
  minutes: GiftMinute[];
};

// A gifter found by a search, with their place among all of them (1, the
// most coins)
export type RankedGifter = Gifter & { rank: number };

// For Coin stats: the finished LIVEs, newest first, and all time's top
// gifters
export type LiveHistory = { lives: LiveSummary[]; gifters: Gifter[] };
