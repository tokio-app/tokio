import { StudioLayer, StudioOverlay } from "@/common/schemas";
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
  ALERT_MESSAGE_VARIABLES,
  fillStudioText,
  generateTikTokEventSample,
} from "@/common/util";
import { language } from "@/helper/i18n";
import { GiftStreaks } from "@/helper/streaks";
import { eventUser, matchesTrigger, streakOf } from "@/helper/triggers";
import { Service } from "../shared";

// What a layer that reacted shows until its next event: the event's values
// and its viewer
export type StudioKept = {
  trigger: AlertTrigger;
  values: TokioEventMap[AppEvents];
  picture: string;
  name: string;
};

type Kept = StudioKept & { overlay: string };

/**
 * A text layer's text: the live numbers, and the event's values when it
 * reacts (its trigger's variables read "" before its first event).
 */
export function studioText(
  layer: Extract<StudioLayer, { kind: "text" }>,
  numbers: StudioNumbers,
  values: TokioEventMap[AppEvents] | null,
) {
  const reacts = layer.when !== "always";
  return fillStudioText(layer.text, {
    numbers,
    values: reacts ? values : null,
    variables: reacts ? ALERT_MESSAGE_VARIABLES[layer.trigger.type] : [],
    language: language(),
  });
}

// The viewer an event came from, as a viewer layer shows them
const viewerOf = (payload: TokioEventMap[AppEvents]) => {
  const user = eventUser(payload);
  return {
    picture: user?.profilePictures[0] ?? "",
    name: user ? user.username || user.handle : "",
  };
};

/**
 * Plays Overlay Studio's layers that react to live events: it matches their
 * triggers, keeps each one's last event for its page, and tells onReact.
 */
export class StudioService extends Service {
  // Each viewer's streak of a gift, see GiftStreaks
  private _streaks = new GiftStreaks();
  // Likes toward each Like layer's next react, by layer id
  private _likes = new Map<string, number>();
  // Each layer's last event, by layer id, until Tokio quits
  private _kept = new Map<string, Kept>();
  private _onReact?: (overlay: string, react: StudioReact) => void;

  // One listener, init.ts, which sends it to the overlay's page
  public onReact(listener: (overlay: string, react: StudioReact) => void) {
    this._onReact = listener;
  }

  /**
   * Reacts every layer whose trigger the event sets off. numbers is read
   * only when a text layer reacts.
   */
  public handle<K extends AppEvents>(
    type: K,
    payload: TokioEventMap[K],
    overlays: readonly StudioOverlay[],
    numbers: () => StudioNumbers,
  ) {
    // Once per event, whichever layers it sets off
    const { added, total, values } = streakOf(this._streaks, type, payload);
    let read: StudioNumbers | undefined;
    const now = () => (read ??= numbers());

    for (const overlay of overlays) {
      for (const layer of overlay.layers) {
        if (layer.when === "always") continue;
        if (!matchesTrigger(layer.trigger, type, payload, added, total)) {
          continue;
        }
        if (!this._passes(layer, payload)) continue;
        const kept: StudioKept = {
          trigger: layer.trigger.type,
          values,
          ...viewerOf(payload),
        };
        this._kept.set(layer.id, { ...kept, overlay: overlay.id });
        this._onReact?.(overlay.id, this._react(layer, kept, now));
      }
    }
  }

  /**
   * What a layer shows from its last event, none before its first or once
   * its trigger changed.
   */
  public kept(layer: StudioLayer): StudioKept | null {
    const kept = this._kept.get(layer.id);
    return kept && kept.trigger === layer.trigger.type ? kept : null;
  }

  /**
   * Every layer of the overlay that reacts, once, with a sample of its
   * trigger's event. Nothing is kept, so a reload shows the real last event.
   */
  public test(overlay: StudioOverlay, numbers: StudioNumbers): StudioReact[] {
    return overlay.layers
      .filter((layer) => layer.when !== "always")
      .map((layer) => {
        const { type } = layer.trigger;
        // Emote triggers match chats
        const event = type === EMOTE_TRIGGER ? TOKIO_EVENTS.CHAT : type;
        const values = generateTikTokEventSample(event).data;
        const sample: StudioKept = {
          trigger: type,
          values,
          ...viewerOf(values),
        };
        return this._react(layer, sample, () => numbers);
      });
  }

  /** Forgets what a removed overlay's layers kept. */
  public forget(overlay: string) {
    for (const [id, kept] of this._kept) {
      if (kept.overlay !== overlay) continue;
      this._kept.delete(id);
      this._likes.delete(id);
    }
  }

  /**
   * Forgets the gift streaks, as their ends may be missed, and the likes
   * counted toward each Like layer. What the layers kept stays.
   */
  public clear() {
    this._streaks.clear();
    this._likes.clear();
  }

  // Whether a matching layer reacts: on Like, once the likes from every
  // viewer pass another likes_every (the rest count toward the next), at
  // most once per event
  private _passes(layer: StudioLayer, payload: TokioEventMap[AppEvents]) {
    if (
      layer.trigger.type !== TOKIO_EVENTS.LIKE ||
      typeof payload !== "object" ||
      payload === null ||
      !("likeCount" in payload)
    ) {
      return true;
    }
    const likes =
      (this._likes.get(layer.id) ?? 0) + Math.max(0, payload.likeCount);
    this._likes.set(layer.id, likes % layer.likes_every);
    return likes >= layer.likes_every;
  }

  private _react(
    layer: StudioLayer,
    { values, picture, name }: StudioKept,
    numbers: () => StudioNumbers,
  ): StudioReact {
    if (layer.kind === "text") {
      return { layer: layer.id, text: studioText(layer, numbers(), values) };
    }
    if (layer.kind === "viewer") return { layer: layer.id, picture, name };
    return { layer: layer.id };
  }
}
