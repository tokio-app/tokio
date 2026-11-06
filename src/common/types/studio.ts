import type {
  StudioAlign,
  StudioAnimation,
  StudioEntrance,
  StudioSource,
  StudioWhen,
} from "../schemas/studio";

// What every resolved layer has. Its box is in px of the canvas, and z goes
// back to front: 0 is the back.
type StudioLayerViewBase = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  z: number;
  opacity: number;
  when: StudioWhen;
  seconds: number;
  entrance: StudioEntrance;
  animation: StudioAnimation;
};

/**
 * One layer as the stage draws it (studioView), everything resolved. A
 * `src: null` draws nothing on stream but keeps the layer's place.
 */
export type StudioLayerView = StudioLayerViewBase &
  (
    | {
        kind: "text";
        // Filled: live numbers and the trigger's values
        text: string;
        font: string;
        size: number;
        color: string;
        align: StudioAlign;
        bold: boolean;
        halo: boolean;
      }
    | { kind: "media"; src: string | null; video: boolean }
    | { kind: "gift"; src: string | null }
    | { kind: "emote"; src: string | null }
    | { kind: "shape"; color: string; radius: number }
    // src is "" without a picture, which shows the name's initial
    | { kind: "viewer"; src: string; name: string }
    | {
        kind: "overlay";
        source: StudioSource | null;
        // Where the stream frames it, null when it can't load (an installed
        // overlay that isn't served, no source)
        src: string | null;
        // A name for it, for the editor
        label: string;
      }
  );

// A studio overlay's canvas and layers, as its page draws them
export type StudioView = {
  width: number;
  height: number;
  layers: StudioLayerView[];
};

// The live numbers a text can show, 0 while not LIVE
export type StudioNumbers = {
  likes: number;
  viewers: number;
  followers: number;
  shares: number;
  coins: number;
};

// The studio page's messages, private to it like tokio:timer: they're not
// part of TokioPayload
export const STUDIO_MESSAGE = "tokio:studio";
export const STUDIO_REACT_MESSAGE = "tokio:studio:react";

// tokio:studio: the overlay to draw, null when it was removed
export type StudioMessage = { view: StudioView | null };

// tokio:studio:react: a layer's trigger fired. The text (a text layer's) and
// the picture and name (a viewer's) replace what it shows.
export type StudioReact = {
  layer: string;
  text?: string;
  picture?: string;
  name?: string;
};
