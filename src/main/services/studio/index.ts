import {
  StudioElement,
  StudioElementOf,
  StudioItem,
  StudioOverlay,
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
  generateEmoteChatSample,
  generateTikTokEventSample,
  reactsToEvents,
  sentPicture,
  studioEventVariables,
} from "@/common/util";
import { language } from "@/helper/i18n";
import { GiftStreaks } from "@/helper/streaks";
import { eventUser, matchesTrigger, streakOf } from "@/helper/triggers";
import { Service } from "../shared";

// What an element that reacted shows until its next event: the event's values
// and its viewer
export type StudioKept = {
  trigger: AlertTrigger;
  values: TokioEventMap[AppEvents];
  picture: string;
  name: string;
};

type Kept = StudioKept & { overlay: string };

/**
 * A text element's text: the live numbers, and the event's values when it
 * reacts (its trigger's variables read "" before its first event).
 */
export function studioText(
  element: StudioElementOf<"text">,
  numbers: StudioNumbers,
  values: TokioEventMap[AppEvents] | null,
) {
  return fillStudioText(element.text, {
    numbers,
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

/**
 * Plays Overlay Studio's elements that react to live events: it matches their
 * triggers, keeps each one's last event for its page, and tells onReact.
 */
export class StudioService extends Service {
  // Each viewer's streak of a gift, see GiftStreaks
  private _streaks = new GiftStreaks();
  // Likes toward each Like element's or group's next react, by its id
  private _likes = new Map<string, number>();
  // Each element's last event, by element id, until Tokio quits. A hidden
  // layer's elements react too, so the layer shows the latest when shown
  private _kept = new Map<string, Kept>();
  private _onReact?: (overlay: string, react: StudioReact) => void;

  // One listener, init.ts, which sends it to the overlay's page
  public onReact(listener: (overlay: string, react: StudioReact) => void) {
    this._onReact = listener;
  }

  /**
   * Reacts every element and group whose trigger the event sets off. A group
   * keeps nothing, as it has no values to show. numbers is read only when a
   * text element reacts.
   */
  public handle<K extends AppEvents>(
    type: K,
    payload: TokioEventMap[K],
    overlays: readonly StudioOverlay[],
    numbers: () => StudioNumbers,
  ) {
    // Once per event, whichever elements it sets off
    const { added, total, values } = streakOf(this._streaks, type, payload);
    let read: StudioNumbers | undefined;
    const now = () => (read ??= numbers());

    for (const overlay of overlays) {
      for (const item of itemsOf(overlay)) {
        if (!reactsToEvents(item)) continue;
        if (!matchesTrigger(item.trigger, type, payload, added, total)) {
          continue;
        }
        if (!this._passes(item, payload)) continue;
        if (item.kind === "group") {
          this._onReact?.(overlay.id, { element: item.id });
          continue;
        }
        const kept: StudioKept = {
          trigger: item.trigger.type,
          values,
          ...viewerOf(payload),
        };
        this._kept.set(item.id, { ...kept, overlay: overlay.id });
        this._onReact?.(overlay.id, this._react(item, kept, now));
      }
    }
  }

  /**
   * What an element shows from its last event, none before its first or
   * once its trigger changed.
   */
  public kept(element: StudioElement): StudioKept | null {
    const kept = this._kept.get(element.id);
    return kept && kept.trigger === element.trigger.type ? kept : null;
  }

  /**
   * Every element and group of the overlay that reacts, once, with a sample
   * of its trigger's event. Nothing is kept, so a reload shows the real last
   * event.
   */
  public test(overlay: StudioOverlay, numbers: StudioNumbers): StudioReact[] {
    // One sample per trigger, so the elements one event sets off show the
    // same viewer, as a real event does: a follow alert's picture and text
    const samples = new Map<AlertTrigger, TokioEventMap[AppEvents]>();
    return itemsOf(overlay)
      .filter(reactsToEvents)
      .map((item) => {
        if (item.kind === "group") return { element: item.id };
        const { type } = item.trigger;
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
        return this._react(item, sample, () => numbers);
      });
  }

  /** Forgets what a removed overlay's elements kept. */
  public forget(overlay: string) {
    for (const [id, kept] of this._kept) {
      if (kept.overlay !== overlay) continue;
      this._kept.delete(id);
      this._likes.delete(id);
    }
  }

  /**
   * Forgets the gift streaks, as their ends may be missed, and the likes
   * counted toward each Like element. What the elements kept stays.
   */
  public clear() {
    this._streaks.clear();
    this._likes.clear();
  }

  // Whether a matching element reacts: on Like, once the likes from every
  // viewer pass another likes_every (the rest count toward the next), at
  // most once per event
  private _passes(
    element: Pick<StudioElement, "id" | "trigger" | "likes_every">,
    payload: TokioEventMap[AppEvents],
  ) {
    if (
      element.trigger.type !== TOKIO_EVENTS.LIKE ||
      typeof payload !== "object" ||
      payload === null ||
      !("likeCount" in payload)
    ) {
      return true;
    }
    const likes =
      (this._likes.get(element.id) ?? 0) + Math.max(0, payload.likeCount);
    this._likes.set(element.id, likes % element.likes_every);
    return likes >= element.likes_every;
  }

  private _react(
    element: StudioElement,
    { values, picture, name }: StudioKept,
    numbers: () => StudioNumbers,
  ): StudioReact {
    const { id } = element;
    if (element.kind === "text") {
      return { element: id, text: studioText(element, numbers(), values) };
    }
    if (element.kind === "viewer") return { element: id, picture, name };
    if (
      (element.kind === "gift" && element.gift === null) ||
      (element.kind === "emote" && element.emote === null)
    ) {
      return { element: id, picture: sentPicture(element, values) };
    }
    return { element: id };
  }
}
