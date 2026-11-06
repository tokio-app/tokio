import { studioOverlay } from "@test/fixtures";
import { describe, expect, it } from "vitest";
import { newOverlayName, sizeText } from "./helper";

const name = (n: number) => `Overlay ${n}`;

describe("newOverlayName", () => {
  it("starts at 1", () => {
    expect(newOverlayName([], name)).toBe("Overlay 1");
  });

  it("takes the first number no overlay's name uses", () => {
    const overlays = [
      studioOverlay("Overlay 1"),
      studioOverlay("Overlay 3"),
      studioOverlay("Main scene"),
    ];

    expect(newOverlayName(overlays, name)).toBe("Overlay 2");
  });

  it("counts a name typed with spaces around it as taken", () => {
    expect(newOverlayName([studioOverlay(" Overlay 1 ")], name)).toBe(
      "Overlay 2",
    );
  });
});

describe("sizeText", () => {
  it("writes the canvas's width by its height", () => {
    expect(sizeText("portrait")).toBe("1080 × 1920");
    expect(sizeText("landscape")).toBe("1920 × 1080");
  });
});
