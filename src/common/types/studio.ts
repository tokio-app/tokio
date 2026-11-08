import type {
  StudioAlign,
  StudioAnimation,
  StudioCrop,
  StudioEntrance,
  StudioShape,
  StudioSource,
  StudioWhen,
} from "../schemas/studio";

// What every resolved element has. Its box is in px of the canvas, and z goes
// back to front in its layer: 0 is the back.
type StudioElementViewBase = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  // Degrees clockwise, around its center
  rotation: number;
  // Mirrored left to right, and top to bottom, before it turns
  flip_x: boolean;
  flip_y: boolean;
  z: number;
  opacity: number;
  when: StudioWhen;
  seconds: number;
  entrance: StudioEntrance;
  animation: StudioAnimation;
};

// A picture's part it keeps, null for all of it, and its corners' rounding,
// a % of the shorter side of what shows
type StudioPictureView = { crop: StudioCrop | null; rounding: number };

/**
 * One element as the stage draws it (studioView), everything resolved. A
 * `src: null` draws nothing on stream but keeps the element's place.
 */
export type StudioElementView = StudioElementViewBase &
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
    | ({
        kind: "media";
        src: string | null;
        video: boolean;
        // A video's part that plays, in seconds (a null end plays to its
        // end), whether it plays again from its start, and its volume, 0 to
        // 100
        start: number;
        end: number | null;
        loop: boolean;
        volume: number;
      } & StudioPictureView)
    | ({ kind: "gift"; src: string | null } & StudioPictureView)
    | ({ kind: "emote"; src: string | null } & StudioPictureView)
    // color null without a fill, border null without one; sides are a
    // polygon's, points a star's and radius a rectangle's or a bubble's
    | {
        kind: "shape";
        shape: StudioShape;
        sides: number;
        points: number;
        color: string | null;
        radius: number;
        border: { color: string; width: number } | null;
      }
    // src is "" without a picture, which shows the name's initial
    | ({ kind: "viewer"; src: string; name: string } & StudioPictureView)
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

// A group's elements, or an element on its own, as the stage draws them,
// over the layers with a lower z
export type StudioLayerView = {
  id: string;
  z: number;
  // A group's, over its elements' own; 1 for an element on its own
  opacity: number;
  elements: StudioElementView[];
};

// A studio overlay's canvas and the layers it shows, as its page draws them:
// one per group or standalone element
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

// tokio:studio:react: an element's trigger fired. The text (a text's) and
// the picture and name (a viewer's) replace what it shows.
export type StudioReact = {
  element: string;
  text?: string;
  picture?: string;
  name?: string;
};
