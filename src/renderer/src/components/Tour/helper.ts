import type { MessageKey } from "@/common/i18n";

type TourStep = {
  // The piece of the window the step is about: its data-tour attribute
  target?: string;
  title: MessageKey;
  text: MessageKey;
};

// The sidebar's icons by their page, then Home's switches and connect box.
// App.test.tsx fails when a piece is missing.
export const TOUR_STEPS: readonly TourStep[] = [
  { title: "components.tour.welcomeTitle", text: "components.tour.welcome" },
  {
    target: "/overlays",
    title: "nav.overlays",
    text: "components.tour.overlays",
  },
  { target: "/tts", title: "nav.tts", text: "components.tour.tts" },
  { target: "/alerts", title: "nav.alerts", text: "components.tour.alerts" },
  { target: "/music", title: "nav.music", text: "components.tour.music" },
  { target: "/games", title: "nav.games", text: "components.tour.games" },
  { target: "/tools", title: "nav.tools", text: "components.tour.tools" },
  {
    target: "/settings",
    title: "nav.settings",
    text: "components.tour.settings",
  },
  {
    target: "features",
    title: "home.features.title",
    text: "components.tour.features",
  },
  {
    target: "connect",
    title: "components.tour.connectTitle",
    text: "components.tour.connect",
  },
];

// Around the piece, and between the cut-out and the card
const PAD = 10;
const GAP = 12;

type Box = { top: number; left: number; width: number; height: number };

export type TourPlace = {
  // The lit cut-out, 0×0 at the window's center when there's no piece
  hole: Box;
  // Where Modal puts the card
  card: { top: number; left: number; translate: string };
};

/**
 * The cut-out around a piece of the window, and the card on its right. The
 * card hangs down from a piece near the top of the window and rises above one
 * near the bottom, so it stays in the window without being measured. Without
 * a piece both sit at the window's center.
 */
export function placeTour(
  piece: Box | undefined,
  width: number,
  height: number,
): TourPlace {
  if (!piece) {
    return {
      hole: { top: height / 2, left: width / 2, width: 0, height: 0 },
      card: { top: height / 2, left: width / 2, translate: "-50% -50%" },
    };
  }

  const hole = {
    top: piece.top - PAD,
    left: piece.left - PAD,
    width: piece.width + 2 * PAD,
    height: piece.height + 2 * PAD,
  };
  const middle = hole.top + hole.height / 2;
  // How far down the window the piece is, as a share of the card's height
  const share = Math.round(Math.min(Math.max(middle / height, 0), 1) * 100);
  return {
    hole,
    card: {
      top: middle,
      // shortcut: doesn't check the window's right edge, as every piece is in
      // its left half (the widest card ends near 1106 of the 1200px minimum);
      // put the card on the piece's left if one ever sits on the right.
      left: hole.left + hole.width + GAP,
      translate: `0 ${-share}%`,
    },
  };
}
