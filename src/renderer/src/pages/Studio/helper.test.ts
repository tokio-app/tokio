import { STUDIO_NAME_MAX_LENGTH } from "@/common/schemas";
import { studioOverlay } from "@test/fixtures";
import { describe, expect, it } from "vitest";
import { copyName, newOverlayName, sizeText } from "./helper";

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

describe("copyName", () => {
  const copy = (name: string, n: number) =>
    n === 1 ? `${name} copy` : `${name} copy ${n}`;

  it("adds copy, then the first free number", () => {
    expect(copyName([studioOverlay("Main")], " Main ", copy)).toBe("Main copy");
    const overlays = [
      studioOverlay("Main"),
      studioOverlay("Main copy"),
      studioOverlay("Main copy 3"),
    ];
    expect(copyName(overlays, "Main", copy)).toBe("Main copy 2");
  });

  it("shortens the source's name to fit, never the suffix", () => {
    const long = `${"a".repeat(50)} ${"b".repeat(9)}`;

    expect(copyName([], long, copy)).toBe(`${"a".repeat(50)} bbbb copy`);
    expect(copyName([], long, copy)).toHaveLength(STUDIO_NAME_MAX_LENGTH);
    // A cut that ends on a space drops it
    expect(copyName([], `${"a".repeat(54)} bcdef`, copy)).toBe(
      `${"a".repeat(54)} copy`,
    );
    expect(
      copyName([studioOverlay(`${"a".repeat(55)} copy`)], "a".repeat(60), copy),
    ).toBe(`${"a".repeat(53)} copy 2`);
  });

  it("keeps an emoji whole when it cuts", () => {
    const name = copyName([], `${"a".repeat(54)}🎉`, copy);

    expect(name).toBe(`${"a".repeat(54)} copy`);
  });
});

describe("sizeText", () => {
  it("writes the canvas's width by its height", () => {
    expect(sizeText("portrait")).toBe("1080 × 1920");
    expect(sizeText("landscape")).toBe("1920 × 1080");
  });
});
