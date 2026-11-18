import {
  GOAL_TRIGGER,
  StudioElement,
  StudioElementOf,
  StudioItem,
  StudioOverlay,
  Trigger,
} from "@/common/schemas";
import {
  AlertTrigger,
  AppEvents,
  EMOTE_TRIGGER,
  StudioNumbers,
  StudioReact,
  TOKIO_EVENTS,
  TokioEventMap,
} from "@/common/types";
import {
  fillStudioText,
  formatError,
  generateEmoteChatSample,
  generateTikTokEventSample,
  goalValue,
  reactsToEvents,
  sentPicture,
  studioEventVariables,
  triggersOf,
} from "@/common/util";
import { language } from "@/helper/i18n";
import { GiftStreaks } from "@/helper/streaks";
import { eventUser, matchesTrigger, streakOf } from "@/helper/triggers";
import Logger from "@/logger";
import { Service } from "../shared";

// What an element that reacted shows until its next event: the event's values
// and its viewer, and the type of the trigger it matched
export type StudioKept = {
  trigger: AlertTrigger;
  values: TokioEventMap[AppEvents];
  picture: string;
  name: string;
};

// A Test's sample, until its element's seconds and exit are over
type Tested = { kept: StudioKept; until: number };

// What a react does when it plays, with the numbers its text reads
type Play = (numbers: () => StudioNumbers) => void;

// A react waiting for its item's delay. A match meanwhile changes what it
// plays, never when.
type Waiting = {
  timer: ReturnType<typeof setTimeout>;
  play: Play;
  numbers: () => StudioNumbers;
};

// The overlay's own map in one of the service's, made when missing
function mapOf<T>(maps: Map<string, Map<string, T>>, overlay: string) {
  let map = maps.get(overlay);
  if (!map) maps.set(overlay, (map = new Map()));
  return map;
}

/**
 * A text element's text: the live numbers, its overlay's counters, and the
 * event's values when it reacts (its triggers' variables read "" before its
 * first event).
 */
export function studioText(
  element: StudioElementOf<"text">,
  numbers: StudioNumbers,
  counters: Record<string, number>,
  values: TokioEventMap[AppEvents] | null,
) {
  return fillStudioText(element.text, {
    numbers,
    counters,
    values: reactsToEvents(element) ? values : null,
    variables: studioEventVariables(element),
    language: language(),
  });
}

// Every group and element of the overlay, a group just before its elements,
// so the stage gets its reacts in the order the overlay holds them
const itemsOf = (overlay: StudioOverlay): StudioItem[] =>
  overlay.items.flatMap((item) =>
    item.kind === "group" ? [item, ...item.elements] : [item],
  );

// The viewer an event came from, as a viewer element shows them
const viewerOf = (payload: TokioEventMap[AppEvents]) => {
  const user = eventUser(payload);
  return {
    picture: user?.profilePictures[0] ?? "",
    name: user ? user.username || user.handle : "",
  };
};

// A Like event's likes, null for any other event
const likesOf = (payload: TokioEventMap[AppEvents]) =>
  typeof payload === "object" && payload !== null && "likeCount" in payload
    ? Math.max(0, payload.likeCount)
    : null;

/**
 * Plays Overlay Studio's elements that react to live events: it matches their
 * triggers, keeps each one's last event for its page, counts the overlays'
 * counters, watches their goals, and tells onReact.
 */
export class StudioService extends Service {
  // Each viewer's streak of a gift, see GiftStreaks
  private _streaks = new GiftStreaks();
  // The maps below go by overlay id, then element or group id (or counter
  // name): a duplicated overlay holds its source's element ids.
  // Likes toward each Like element's or group's next react
  private _likes = new Map<string, Map<string, number>>();
  // Each element's last event, until Tokio quits. A hidden layer's elements
  // react too, so the layer shows the latest when shown
  private _kept = new Map<string, Map<string, StudioKept>>();
  // Each element's Test sample while it shows: views come again on every
  // numbers push, and would show its last event at once
  private _tests = new Map<string, Map<string, Tested>>();
  // Each item's react waiting for its delay
  private _waiting = new Map<string, Map<string, Waiting>>();
  // Each counter's count this LIVE, by name
  private _counts = new Map<string, Map<string, number>>();
  // The goals reached this LIVE, by item, number and goal
  private _reached = new Map<string, Map<string, true>>();
  private _onReact?: (overlay: string, react: StudioReact) => void;

  // One listener, init.ts, which sends it to the overlay's page
  public onReact(listener: (overlay: string, react: StudioReact) => void) {
    this._onReact = listener;
  }

  /**
   * Counts the event in every counter its trigger matches, and reacts every
   * element and group one of whose triggers it sets off, after its delay. A
   * group keeps nothing, as it has no values to show. numbers is read only
   * when a text element reacts.
   */
  public handle<K extends AppEvents>(
    type: K,
    payload: TokioEventMap[K],
    overlays: readonly StudioOverlay[],
    numbers: () => StudioNumbers,
  ) {
    // Once per event, whichever elements it sets off
    const { added, total, values } = streakOf(this._streaks, type, payload);
    this._count(type, payload, overlays, added, total);
    // Read once for the texts it reacts now; one that waited reads its own
    let read: StudioNumbers | undefined;
    let later = false;
    const now = () => (later ? numbers() : (read ??= numbers()));

    for (const overlay of overlays) {
      for (const item of itemsOf(overlay)) {
        if (!reactsToEvents(item)) continue;
        // Goals never match an event
        const trigger = triggersOf(item).find(
          (t): t is Trigger =>
            t.type !== GOAL_TRIGGER &&
            matchesTrigger(t, type, payload, added, total),
        );
        if (!trigger) continue;
        if (!this._passes(overlay.id, item, trigger, payload)) continue;
        if (item.kind === "group") {
          const react = { element: item.id };
          this._schedule(overlay.id, item, now, false, () =>
            this._onReact?.(overlay.id, react),
          );
          continue;
        }
        const kept: StudioKept = {
          trigger: trigger.type,
          values,
          ...viewerOf(payload),
        };
        this._schedule(overlay.id, item, now, true, (read) => {
          this._tests.get(overlay.id)?.delete(item.id);
          mapOf(this._kept, overlay.id).set(item.id, kept);
          this._onReact?.(overlay.id, this._react(overlay, item, kept, read));
        });
      }
    }
    later = true;
  }

  /**
   * Reacts each item with a goal trigger whose number is at or past its
   * goal, once per LIVE, after its delay. It shows the item's last event
   * again, so a text's {username} doesn't empty. numbers are the LIVE's.
   */
  public goals(overlays: readonly StudioOverlay[], numbers: StudioNumbers) {
    for (const overlay of overlays) {
      const counts = this.counts(overlay);
      for (const item of itemsOf(overlay)) {
        if (!reactsToEvents(item)) continue;
        for (const trigger of triggersOf(item)) {
          if (trigger.type !== GOAL_TRIGGER) continue;
          const { number, goal } = trigger;
          if (goalValue(number, numbers, counts) < goal) continue;
          // A changed goal can be reached again
          const key = JSON.stringify([item.id, number, goal]);
          const reached = mapOf(this._reached, overlay.id);
          if (reached.has(key)) continue;
          reached.set(key, true);
          this._schedule(
            overlay.id,
            item,
            () => numbers,
            false,
            (read) =>
              this._onReact?.(
                overlay.id,
                item.kind === "group"
                  ? { element: item.id }
                  : this._react(
                      overlay,
                      item,
                      this.kept(overlay.id, item),
                      read,
                    ),
              ),
          );
        }
      }
    }
  }

  /**
   * What an element shows from its last event, or from a Test while it
   * shows, none before its first or once the trigger type it matched is no
   * longer one of its triggers.
   */
  public kept(overlay: string, element: StudioElement): StudioKept | null {
    const types = triggersOf(element).map((t) => t.type);
    const tests = this._tests.get(overlay);
    const tested = tests?.get(element.id);
    if (tested) {
      const { kept, until } = tested;
      if (performance.now() < until && types.includes(kept.trigger)) {
        return kept;
      }
      tests!.delete(element.id);
    }
    const kept = this._kept.get(overlay)?.get(element.id);
    return kept && types.includes(kept.trigger) ? kept : null;
  }

  /**
   * Reacts every element and group of the overlay that reacts, once, after
   * its delay, with a sample of its first trigger's event (a goal's sends
   * none). Each element keeps its sample for its seconds and a second for
   * its exit (EXIT_MS, in the stage) from when it plays, unless a real event
   * comes first, then shows its real last event again.
   */
  public test(overlay: StudioOverlay, numbers: () => StudioNumbers) {
    // One sample per trigger, so the elements one event sets off show the
    // same viewer, as a real event does: a follow alert's picture and text
    const samples = new Map<AlertTrigger, TokioEventMap[AppEvents]>();
    for (const item of itemsOf(overlay)) {
      if (!reactsToEvents(item)) continue;
      const { trigger } = item;
      if (item.kind === "group" || trigger.type === GOAL_TRIGGER) {
        const react = { element: item.id };
        this._schedule(overlay.id, item, numbers, false, () =>
          this._onReact?.(overlay.id, react),
        );
        continue;
      }
      const { type } = trigger;
      let values = samples.get(type);
      if (!values) {
        // Emote triggers match chats with an emote
        values =
          type === EMOTE_TRIGGER
            ? generateEmoteChatSample()
            : generateTikTokEventSample(type).data;
        samples.set(type, values);
      }
      const sample: StudioKept = {
        trigger: type,
        values,
        ...viewerOf(values),
      };
      this._schedule(overlay.id, item, numbers, true, (read) => {
        mapOf(this._tests, overlay.id).set(item.id, {
          kept: sample,
          until: performance.now() + (item.seconds + 1) * 1000,
        });
        this._onReact?.(overlay.id, this._react(overlay, item, sample, read));
      });
    }
  }

  /** The overlay's counters this LIVE, by name, 0 while not LIVE. */
  public counts(overlay: StudioOverlay): Record<string, number> {
    const counts = this._counts.get(overlay.id);
    return Object.fromEntries(
      overlay.counters.map((c) => [c.name, counts?.get(c.name) ?? 0]),
    );
  }

  /**
   * A new LIVE: the counters start from 0 and every goal can be reached
   * again.
   */
  public startLive() {
    this._counts.clear();
    this._reached.clear();
  }

  /**
   * Forgets a removed overlay: what its elements kept, Test's samples, its
   * like counts, counters and goals, and the reacts waiting.
   */
  public forget(overlay: string) {
    this._tests.delete(overlay);
    this._kept.delete(overlay);
    this._likes.delete(overlay);
    this._counts.delete(overlay);
    this._reached.delete(overlay);
    for (const { timer } of this._waiting.get(overlay)?.values() ?? []) {
      clearTimeout(timer);
    }
    this._waiting.delete(overlay);
  }

  /**
   * The LIVE ended: forgets the gift streaks, as their ends may be missed,
   * the likes counted toward each Like element, the counters, the goals
   * reached and the reacts waiting. What the elements kept stays.
   */
  public clear() {
    this._streaks.clear();
    this._likes.clear();
    this._counts.clear();
    this._reached.clear();
    for (const waiting of this._waiting.values()) {
      for (const { timer } of waiting.values()) clearTimeout(timer);
    }
    this._waiting.clear();
  }

  // Plays a react after the item's delay, at once without one. One already
  // waiting keeps its time (a busy chat would hold it back for good) and
  // takes this play if it `replaces`: one that keeps an event does, so the
  // newest shows. The numbers are read when it plays.
  private _schedule(
    overlay: string,
    item: StudioItem,
    numbers: () => StudioNumbers,
    replaces: boolean,
    play: Play,
  ) {
    const waiting = mapOf(this._waiting, overlay);
    const wait = waiting.get(item.id);
    if (wait) {
      if (replaces) Object.assign(wait, { play, numbers });
      return;
    }
    if (item.delay === 0) return play(numbers);
    const entry: Waiting = {
      play,
      numbers,
      timer: setTimeout(() => {
        waiting.delete(item.id);
        try {
          entry.play(entry.numbers);
        } catch (error) {
          Logger.error(
            `<Studio> Unable to react ${item.id} -- ${formatError(error)}`,
            this._logFile,
            error,
          );
        }
      }, item.delay * 1000),
    };
    waiting.set(item.id, entry);
  }

  // Adds the event to each counter whose trigger it matches: a gift its
  // gifts (without every_gift only a streak's end matches, where added is
  // just the last increment), a Like its likes, any other event 1
  private _count(
    type: AppEvents,
    payload: TokioEventMap[AppEvents],
    overlays: readonly StudioOverlay[],
    added: number,
    total: number,
  ) {
    for (const overlay of overlays) {
      for (const { name, trigger } of overlay.counters) {
        if (!matchesTrigger(trigger, type, payload, added, total)) continue;
        const counts = mapOf(this._counts, overlay.id);
        const adds =
          trigger.type === TOKIO_EVENTS.GIFT
            ? trigger.every_gift
              ? added
              : total
            : trigger.type === TOKIO_EVENTS.LIKE
              ? (likesOf(payload) ?? 0)
              : 1;
        counts.set(name, (counts.get(name) ?? 0) + adds);
      }
    }
  }

  // Whether a matching item reacts: when the trigger it matched is a Like,
  // once the likes from every viewer pass another likes_every (the rest
  // count toward the next), at most once per event
  private _passes(
    overlay: string,
    { id, likes_every }: Pick<StudioElement, "id" | "likes_every">,
    trigger: Trigger,
    payload: TokioEventMap[AppEvents],
  ) {
    const likes = likesOf(payload);
    if (trigger.type !== TOKIO_EVENTS.LIKE || likes === null) return true;
    const counts = mapOf(this._likes, overlay);
    const sum = (counts.get(id) ?? 0) + likes;
    counts.set(id, sum % likes_every);
    return sum >= likes_every;
  }

  private _react(
    overlay: StudioOverlay,
    element: StudioElement,
    kept: StudioKept | null,
    numbers: () => StudioNumbers,
  ): StudioReact {
    const { id } = element;
    const values = kept?.values ?? null;
    if (element.kind === "text") {
      const counters = this.counts(overlay);
      const text = studioText(element, numbers(), counters, values);
      return { element: id, text };
    }
    if (element.kind === "viewer") {
      return {
        element: id,
        picture: kept?.picture ?? "",
        name: kept?.name ?? "",
      };
    }
    if (
      (element.kind === "gift" && element.gift === null) ||
      (element.kind === "emote" && element.emote === null)
    ) {
      return { element: id, picture: sentPicture(element, values) };
    }
    return { element: id };
  }
}
