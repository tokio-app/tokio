import { CatalogOverlay } from "@/common/schemas";
import { OverlayApp } from "@/common/types";
import { describe, expect, it } from "vitest";
import { catalogState, countUpdates } from "./catalog";

const entry = (id: string): CatalogOverlay => ({
  id,
  name: id,
  version: "1.0.1",
  description: "",
  config: true,
  url: `https://github.com/tokio-app/overlays/releases/download/v0.1.1/${id}.zip`,
  size: 1,
  sha256: "0".repeat(64),
  preview: null,
});

const overlay = (
  id: string,
  version: string,
  external = false,
): OverlayApp => ({
  id,
  name: id,
  version,
  external,
  config: true,
  path: id,
});

describe("catalogState", () => {
  it("offers to install an overlay that isn't installed", () => {
    expect(catalogState(entry("gift-jar"), [])).toBe("install");
  });

  it("doesn't count an imported overlay with the same id", () => {
    const imported = overlay("gift-jar", "1.0.1", true);
    expect(catalogState(entry("gift-jar"), [imported])).toBe("install");
  });

  it("offers an update for any other installed version", () => {
    const current = [overlay("gift-jar", "1.0.1")];
    const older = [overlay("gift-jar", "1.0.0")];
    expect(catalogState(entry("gift-jar"), current)).toBe("installed");
    expect(catalogState(entry("gift-jar"), older)).toBe("update");
  });
});

describe("countUpdates", () => {
  it("counts the installed official overlays with a new version", () => {
    const catalog = [entry("gift-jar"), entry("top-likes"), entry("jar-two")];
    const overlays = [
      overlay("gift-jar", "1.0.0"),
      overlay("top-likes", "1.0.1"),
      overlay("jar-two", "0.9.0", true),
    ];

    expect(countUpdates(catalog, overlays)).toBe(1);
    expect(countUpdates([], overlays)).toBe(0);
  });
});
