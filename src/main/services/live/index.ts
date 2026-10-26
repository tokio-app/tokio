import { ActivityFeed } from "@/common/schemas";
import {
  Activity,
  ActivityItem,
  ActivityUser,
  LiveSession,
  LiveTotals,
  TOKIO_EVENTS,
  TokioEventMap,
  UserData,
} from "@/common/types";
import { defaultStoreData } from "@/common/util";
import { GiftStreaks } from "@/helper/streaks";
import { Service } from "../shared";

// The feed keeps this many of the latest events
export const ACTIVITY_LIMIT = 100;

// A join item names this many viewers and counts the rest
const JOIN_NAMES = 2;
// A join item counts up to this many viewers, which bounds the handles kept
export const JOIN_LIMIT = 1000;

// The live events the Home page shows or counts
export const ACTIVITY_EVENTS = [
  TOKIO_EVENTS.CHAT,
  TOKIO_EVENTS.GIFT,
  TOKIO_EVENTS.FOLLOW,
  TOKIO_EVENTS.SHARE,
  TOKIO_EVENTS.SUPER_FAN,
  TOKIO_EVENTS.MEMBER_JOIN,
] as const;

type ActivityEvent = (typeof ACTIVITY_EVENTS)[number];

// What each event does to the session, true when it changes it
type Recorders = {
  [K in ActivityEvent]: (data: TokioEventMap[K]) => boolean;
};

const noTotals = (): LiveTotals => ({
  followers: 0,
  shares: 0,
  gifts: 0,
  coins: 0,
});

const activityUser = ({
  handle,
  username,
  profilePictures,
}: UserData): ActivityUser => ({
  handle,
  name: username || handle,
  picture: profilePictures[0] ?? "",
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

  private readonly _recorders: Recorders = {
    [TOKIO_EVENTS.CHAT]: ({ user, comment }) =>
      this._add({
        type: "chat",
        user: activityUser(user),
        text: comment.content,
        emotes: comment.emotes.flatMap((emote) => emote.images.slice(0, 1)),
      }),
    [TOKIO_EVENTS.GIFT]: (event) => {
      // The totals count gifts as they come, the feed once per combo, like
      // gift alerts
      const { added, total } = this._streaks.add(event);
      const { user, gift } = event;
      const unit = Math.max(0, gift.coins);
      this._totals.gifts += added;
      this._totals.coins += unit * added;
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
      this._totals.followers++;
      this._add({ type: "follow", user: activityUser(user) });
      return true;
    },
    [TOKIO_EVENTS.SHARE]: ({ user }) => {
      this._totals.shares++;
      this._add({ type: "share", user: activityUser(user) });
      return true;
    },
    [TOKIO_EVENTS.SUPER_FAN]: ({ user }) =>
      this._add({ type: "superfan", user: activityUser(user) }),
    [TOKIO_EVENTS.MEMBER_JOIN]: ({ user }) => this._join(activityUser(user)),
  };

  /** Starts a LIVE, clearing the last one's totals and feed. */
  public start(now = Date.now()) {
    this._startedAt = now;
    this._totals = noTotals();
    this._activity = [];
    this._streaks.clear();
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

  /** A copy, so later events don't change what was sent. */
  public getSession(): LiveSession {
    return {
      startedAt: this._startedAt,
      totals: { ...this._totals },
      activity: [...this._activity],
    };
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
