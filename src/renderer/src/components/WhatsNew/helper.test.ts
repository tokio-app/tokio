import { describe, expect, it } from "vitest";
import { notesKey, pagesOf } from "./helper";

const texts = {
  "components.whatsNew.title": "What's new",
  "releases.0.1.0-beta.1": "Notes",
  "releases.0.1.3-beta.10": "Notes",
  "releases.0.1.3": "Notes",
};

describe("notesKey", () => {
  it("finds the notes of the version Tokio was updated to", () => {
    expect(notesKey("0.1.2", "0.1.3", texts)).toBe("releases.0.1.3");
    // From before Tokio kept its version
    expect(notesKey("", "0.1.3", texts)).toBe("releases.0.1.3");
  });

  it("orders versions as semver does", () => {
    // A release comes after its own prereleases
    expect(notesKey("0.1.3-beta.10", "0.1.3", texts)).toBe("releases.0.1.3");
    expect(notesKey("0.1.3", "0.1.3-beta.10", texts)).toBeUndefined();
    // Numbers compare as numbers
    expect(notesKey("0.1.3-beta.2", "0.1.3-beta.10", texts)).toBe(
      "releases.0.1.3-beta.10",
    );
    expect(notesKey("0.1.10-alpha.1", "0.1.3", texts)).toBeUndefined();
    expect(notesKey("0.1.0-alpha.8", "0.1.0-beta.1", texts)).toBe(
      "releases.0.1.0-beta.1",
    );
  });

  it("finds nothing for a release without notes, or after a downgrade", () => {
    expect(notesKey("0.1.3", "0.1.4", texts)).toBeUndefined();
    expect(notesKey("0.1.4", "0.1.3", texts)).toBeUndefined();
  });
});

describe("pagesOf", () => {
  const notes = (count: number) =>
    Array.from({ length: count }, (_, i) => `Note ${i + 1}`);
  const sizes = (count: number) =>
    pagesOf(notes(count)).map((page) => page.length);

  it("puts at least three notes on a page, as evenly as they go", () => {
    expect(sizes(1)).toEqual([1]);
    expect(sizes(5)).toEqual([5]);
    expect(sizes(6)).toEqual([3, 3]);
    expect(sizes(7)).toEqual([4, 3]);
    expect(sizes(10)).toEqual([4, 3, 3]);
  });

  it("keeps the notes in order", () => {
    expect(pagesOf(notes(10)).flat()).toEqual(notes(10));
  });
});
