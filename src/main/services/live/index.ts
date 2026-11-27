import { ActivityFeed } from "@/common/schemas";
import {
  Activity,
  ActivityItem,
  ActivityUser,
  LiveSession,
  LiveTotals,
  Platform,
  PlatformLive,
  TOKIO_EVENTS,
  TokioEventMap,
  UserData,
} from "@/common/types";
import {
  defaultStoreData,
  GIFT_CURRENCY,
  isPlatform,
  platformOf,
} from "@/common/util";
import { parseAmount } from "@/helper/amount";
import { GiftStreaks } from "@/helper/streaks";
import Logger from "@/logger";
import type { RatesService } from "../rates";
import { Service } from "../shared";

// The feed keeps this many of the latest events
export const ACTIVITY_LIMIT = 100;

// A join item names this many viewers and counts the rest
const JOIN_NAMES = 2;
// A join item counts up to this many viewers, which bounds the handles kept
export const JOIN_LIMIT = 1000;

const MINUTE = 60_000;
// shortcut: the chart stops at 24 h, keep coarser minutes if LIVEs run longer
export const VIEWER_MINUTES = 24 * 60;

// The live events the Home page shows or counts
export const ACTIVITY_EVENTS = [
  TOKIO_EVENTS.CHAT,
  TOKIO_EVENTS.GIFT,
  TOKIO_EVENTS.FOLLOW,
  TOKIO_EVENTS.SHARE,
  TOKIO_EVENTS.SUPER_FAN,
  TOKIO_EVENTS.MEMBER_JOIN,
  TOKIO_EVENTS.SUBSCRIBE,
  TOKIO_EVENTS.GIFT_SUB,
  TOKIO_EVENTS.CHEER,
  TOKIO_EVENTS.RAID,
  TOKIO_EVENTS.REDEEM,
  TOKIO_EVENTS.SUPER_CHAT,
  TOKIO_EVENTS.KICKS,
] as const;

type ActivityEvent = (typeof ACTIVITY_EVENTS)[number];

// What each event does to the session, true when it changes it
// Converts amounts by currency to US dollars
type Rates = Pick<RatesService, "toUsd">;

// Until setRates, only dollars convert, so nothing fetches rates
const dollarsOnly: Rates = {
  toUsd: (amounts) =>
    Object.keys(amounts).some((code) => code !== "USD")
      ? null
      : (amounts.USD ?? 0),
};

type Recorders = {
  [K in ActivityEvent]: (data: TokioEventMap[K]) => boolean;
};

const noTotals = (): LiveTotals => ({
  followers: 0,
  shares: 0,
  gifts: 0,
  coins: 0,
  jewels: 0,
  kicks: 0,
  bits: 0,
  superChats: 0,
  giftSubs: 0,
});

// Keeps a minute's highest count. Minutes without a reading repeat the last
// one, or `before` while there's none.
function keepMinute(
  values: number[],
  minute: number,
  count: number,
  before: number,
) {
  while (values.length < minute) values.push(values.at(-1) ?? before);
  values[minute] = Math.max(values[minute] ?? 0, count);
}

const activityUser = ({
  handle,
  username,
  profilePictures,
  platform,
}: UserData): ActivityUser => ({
  handle,
  name: username || handle,
  picture: profilePictures[0] ?? "",
  ...(platform && { platform }),
});

/**
 * The LIVE Tokio is connected to: when it started, the totals since then and
 * its latest events, for the Home page. Kept in memory only.
 */
export class LiveService extends Service {
  private _startedAt: number | null = null;
  private _totals = noTotals();
  // Newest first
  private _activity: ActivityItem[] = [];
  // Handles counted in the newest join item, named or not
  private _joined = new Set<string>();
  // Each viewer's streak of a gift, see GiftStreaks
  private _streaks = new GiftStreaks();
  // Never reset, so ids stay unique across LIVEs
  private _lastId = 0;
  // The kinds of events the feed keeps. Totals count all of them.
  private _feed: ActivityFeed = { ...defaultStoreData.settings.activityFeed };
  // Each minute's highest viewer count since the LIVE started
  private _viewers: number[] = [];
  // Each platform's own totals and viewers
  private _platforms: Partial<Record<Platform, PlatformLive>> = {};
  // The Super Chats' amounts by currency code, added up in dollars on read
  private _superChats: Record<string, number> = {};
  // Super Chat amounts already warned about, once each
  private _unread = new Set<string>();
  private _rates: Rates = dollarsOnly;

  private readonly _recorders: Recorders = {
    [TOKIO_EVENTS.CHAT]: ({ user, comment }) =>
      this._add({
        type: "chat",
        user: activityUser(user),
        text: comment.content,
        emotes: comment.emotes.flatMap((emote) => emote.images.slice(0, 1)),
        ...(comment.translation && { translation: comment.translation }),
      }),
    [TOKIO_EVENTS.GIFT]: (event) => {
      // The totals count gifts as they come, the feed once per combo, like
      // gift alerts
      const { added, total } = this._streaks.add(event);
      const { user, gift } = event;
      const unit = Math.max(0, gift.coins);
      // YouTube's Gifts have no price
      const currency = GIFT_CURRENCY[platformOf(user)];
      this._count(user, "gifts", added);
      if (currency) this._count(user, currency, unit * added);
      const listed =
        gift.repeatEnd &&
        this._add({
          type: "gift",
          user: activityUser(user),
          gift: {
            name: gift.name,
            image: gift.image,
            count: total,
            coins: unit * total,
          },
        });
      return added > 0 || listed;
    },
    [TOKIO_EVENTS.FOLLOW]: ({ user }) => {
      this._count(user, "followers", 1);
      this._add({ type: "follow", user: activityUser(user) });
      return true;
    },
    [TOKIO_EVENTS.SHARE]: ({ user }) => {
      this._count(user, "shares", 1);
      this._add({ type: "share", user: activityUser(user) });
      return true;
    },
    [TOKIO_EVENTS.SUPER_FAN]: ({ user }) =>
      this._add({ type: "superfan", user: activityUser(user) }),
    [TOKIO_EVENTS.MEMBER_JOIN]: ({ user }) => this._join(activityUser(user)),
    [TOKIO_EVENTS.SUBSCRIBE]: ({ user, months, message }) =>
      this._add({
        type: "sub",
        user: activityUser(user),
        months,
        text: message,
      }),
    // True even when the feed hides gifted subs, since they count
    [TOKIO_EVENTS.GIFT_SUB]: ({ user, count }) => {
      this._count(user, "giftSubs", Math.max(0, count));
      this._add({ type: "giftsub", user: activityUser(user), count });
      return true;
    },
    // True even when the feed hides cheers, since the Bits count
    [TOKIO_EVENTS.CHEER]: ({ user, bits, message }) => {
      this._count(user, "bits", Math.max(0, bits));
      this._add({
        type: "cheer",
        user: activityUser(user),
        bits,
        text: message,
      });
      return true;
    },
    // True even when the feed hides Kicks, since they count
    [TOKIO_EVENTS.KICKS]: ({ user, kicks, message }) => {
      this._count(user, "kicks", Math.max(0, kicks));
      this._add({
        type: "kicks",
        user: activityUser(user),
        kicks,
        text: message,
      });
      return true;
    },
    [TOKIO_EVENTS.RAID]: ({ user, viewers }) =>
      this._add({ type: "raid", user: activityUser(user), viewers }),
    [TOKIO_EVENTS.REDEEM]: ({ user, reward, input }) =>
      this._add({
        type: "redeem",
        user: activityUser(user),
        reward: reward.title,
        text: input,
      }),
    // Its amount is added up apart, in its currency, and read in dollars
    [TOKIO_EVENTS.SUPER_CHAT]: ({ user, amount, message, sticker }) => {
      this._count(user, "superChats", 1);
      this._addAmount(amount);
      this._add({
        type: "superchat",
        user: activityUser(user),
        amount,
        text: message,
        sticker,
      });
      return true;
    },
  };

  /** Starts a LIVE, clearing the last one's totals and feed. */
  public start(now = Date.now()) {
    this._startedAt = now;
    this._totals = noTotals();
    this._activity = [];
    this._viewers = [];
    this._platforms = {};
    this._superChats = {};
    this._streaks.clear();
  }

  /** Sets what converts the Super Chats to dollars. */
  public setRates(rates: Rates) {
    this._rates = rates;
  }

  /** Ends the LIVE. Its feed stays until the next one starts. */
  public end() {
    this._startedAt = null;
  }

  /** Sets the kinds of events the feed keeps, dropping the ones it hides. */
  public setFeed(feed: ActivityFeed) {
    this._feed = { ...feed };
    this._activity = this._activity.filter((item) => this._feed[item.type]);
  }

  /**
   * Adds a live event to the totals and the feed. False when it changes
   * nothing, like a gift update that came late.
   */
  public record<K extends ActivityEvent>(
    type: K,
    data: TokioEventMap[K],
  ): boolean {
    return this._recorders[type](data);
  }

  /**
   * Keeps the minute's highest viewer count, everyone's and each platform's.
   * True when the count starts a minute after the first one, so Home's chart
   * gets the minute that ended.
   */
  public recordViewers(
    count: number,
    platforms: Partial<Record<Platform, number>>,
    now = Date.now(),
  ): boolean {
    if (this._startedAt === null) return false;
    const viewers = this._viewers;
    // A clock set back stays in the minute it reached
    const minute = Math.max(
      0,
      viewers.length - 1,
      Math.floor((now - this._startedAt) / MINUTE),
    );
    if (minute >= VIEWER_MINUTES) return false;
    const starts = minute >= viewers.length;
    keepMinute(viewers, minute, count, count);
    // A platform without a count, not up yet or gone, has 0 viewers
    const counted = Object.keys({ ...this._platforms, ...platforms });
    for (const platform of counted.filter(isPlatform)) {
      const own = this._of(platform).viewers;
      keepMinute(own, minute, platforms[platform] ?? 0, 0);
    }
    return starts && viewers.length > 1;
  }

  /** When the LIVE started, null while not LIVE, without getSession's copy. */
  public get startedAt(): number | null {
    return this._startedAt;
  }

  /** A copy, so later events don't change what was sent. */
  public getSession(): LiveSession {
    return {
      startedAt: this._startedAt,
      totals: { ...this._totals },
      activity: [...this._activity],
      viewers: [...this._viewers],
      platforms: structuredClone(this._platforms),
      usd: this._rates.toUsd(this._superChats),
    };
  }

  // Missing means TikTok, as on users
  private _of(platform: Platform = "tiktok"): PlatformLive {
    return (this._platforms[platform] ??= { totals: noTotals(), viewers: [] });
  }

  // Counts toward the LIVE's totals and the viewer's platform's
  private _count(user: UserData, total: keyof LiveTotals, n: number) {
    this._totals[total] += n;
    this._of(user.platform).totals[total] += n;
  }

  private _addAmount(text: string) {
    const amount = parseAmount(text);
    if (amount) {
      this._superChats[amount.currency] =
        (this._superChats[amount.currency] ?? 0) + amount.value;
    } else if (!this._unread.has(text)) {
      this._unread.add(text);
      Logger.warn(
        `<Live> Couldn't read the Super Chat amount ${JSON.stringify(text)}, left out of the total`,
        this._logFile,
      );
    }
  }

  // False when the feed hides it
  private _add(activity: Activity): boolean {
    if (!this._feed[activity.type]) return false;
    this._activity.unshift({ ...activity, id: ++this._lastId });
    this._activity.splice(ACTIVITY_LIMIT);
    return true;
  }

  // Joins in a row share the newest item, so a busy LIVE doesn't fill the
  // feed with them. Hidden events between them don't count.
  private _join(user: ActivityUser): boolean {
    if (!this._feed.join) return false;
    const last = this._activity[0];
    if (last?.type !== "join" || last.count >= JOIN_LIMIT) {
      this._add({ type: "join", users: [user], count: 1 });
      this._joined = new Set([user.handle]);
      return true;
    }
    // TikTok sends the join again when a viewer comes back
    if (user.handle && this._joined.has(user.handle)) return false;
    this._joined.add(user.handle);
    this._activity[0] = {
      ...last,
      users:
        last.users.length < JOIN_NAMES ? [...last.users, user] : last.users,
      count: last.count + 1,
    };
    return true;
  }
}
