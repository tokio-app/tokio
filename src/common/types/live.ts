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
};
