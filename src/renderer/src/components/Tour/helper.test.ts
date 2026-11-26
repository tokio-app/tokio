import { describe, expect, it } from "vitest";
import { placeTour } from "./helper";

// A sidebar icon, 20px square, at the given top
const icon = (top: number) => ({ top, left: 14, width: 20, height: 20 });

describe("placeTour", () => {
  it("centers the card, with no cut-out, without a piece", () => {
    expect(placeTour(undefined, 1200, 800)).toEqual({
      hole: { top: 400, left: 600, width: 0, height: 0 },
      card: { top: 400, left: 600, translate: "-50% -50%" },
    });
  });

  it("lights the piece with room around it, and puts the card on its right", () => {
    const { hole, card } = placeTour(icon(100), 1200, 800);

    expect(hole).toEqual({ top: 90, left: 4, width: 40, height: 40 });
    expect(card.left).toBe(56);
    // Level with the piece's middle
    expect(card.top).toBe(110);
  });

  it("hangs the card down from a piece near the top of the window", () => {
    // 110 / 800 of the way down
    expect(placeTour(icon(100), 1200, 800).card.translate).toBe("0 -14%");
  });

  it("raises the card above a piece near the bottom of the window", () => {
    // 750 / 800 of the way down
    expect(placeTour(icon(740), 1200, 800).card.translate).toBe("0 -94%");
  });

  it("keeps the card in the window when the piece's middle is outside it", () => {
    expect(placeTour(icon(900), 1200, 800).card.translate).toBe("0 -100%");
    expect(placeTour(icon(-100), 1200, 800).card.translate).toBe("0 0%");
  });
});
