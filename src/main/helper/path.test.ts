import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isInside } from "./path";

const folder = resolve("tokio", "overlays");

describe("isInside", () => {
  it("accepts files and folders under the folder", () => {
    expect(isInside(folder, join(folder, "gift-jar"))).toBe(true);
    expect(isInside(folder, join(folder, "gift-jar", "index.html"))).toBe(true);
  });

  it("refuses the folder itself", () => {
    expect(isInside(folder, folder)).toBe(false);
    expect(isInside(folder, join(folder, "gift-jar", ".."))).toBe(false);
  });

  it("refuses paths that climb out of it", () => {
    expect(isInside(folder, join(folder, ".."))).toBe(false);
    expect(isInside(folder, join(folder, "..", "secret.txt"))).toBe(false);
    expect(isInside(folder, join(folder, "a", "..", "..", "x"))).toBe(false);
  });

  it("refuses a sibling that starts with the folder's name", () => {
    expect(isInside(folder, join(`${folder}-old`, "index.html"))).toBe(false);
  });

  it("accepts names that only start with two dots", () => {
    expect(isInside(folder, join(folder, "..hidden"))).toBe(true);
  });

  it.runIf(process.platform === "win32")("refuses another drive", () => {
    expect(isInside("C:\\tokio\\overlays", "D:\\tokio\\overlays\\x")).toBe(
      false,
    );
  });
});
