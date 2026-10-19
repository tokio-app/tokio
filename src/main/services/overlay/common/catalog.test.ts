import { CatalogOverlay } from "@/common/schemas";
import { strToU8, zipSync } from "fflate";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  downloadOverlay,
  extractZip,
  parseCatalog,
  RELEASES_PREFIX,
} from "./catalog";

const ZIP = zipSync({ "index.html": strToU8("<p></p>") });

const entry = (changes: Partial<CatalogOverlay> = {}): CatalogOverlay => ({
  id: "gift-jar",
  name: "Gift Jar",
  version: "1.0.1",
  description: "Gifts drop into a jar.",
  config: true,
  url: `${RELEASES_PREFIX}v0.1.1/gift-jar.zip`,
  size: ZIP.length,
  sha256: createHash("sha256").update(ZIP).digest("hex"),
  preview: `${RELEASES_PREFIX}v0.1.1/gift-jar.png`,
  ...changes,
});

describe("parseCatalog", () => {
  it("reads the overlays, without the fields Tokio doesn't use", () => {
    const catalog = {
      schema: 1,
      release: "0.1.1",
      overlays: [{ ...entry(), release: "0.1.1", file: "gift-jar.zip" }],
    };

    expect(parseCatalog(catalog)).toEqual({ overlays: [entry()], dropped: [] });
  });

  it("drops entries it can't read or that aren't in the overlays' releases", () => {
    const { overlays, dropped } = parseCatalog({
      schema: 1,
      overlays: [
        entry(),
        entry({ id: "../evil" }),
        entry({ id: "elsewhere", url: "https://example.com/elsewhere.zip" }),
        entry({ id: "climber", url: `${RELEASES_PREFIX}../../../x/a.zip` }),
        { name: "No id" },
      ],
    });

    expect(overlays.map((o) => o.id)).toEqual(["gift-jar"]);
    expect(dropped).toEqual(["../evil", "elsewhere", "climber", "#5"]);
  });

  it("drops previews from anywhere else", () => {
    const { overlays } = parseCatalog({
      schema: 1,
      overlays: [entry({ preview: "https://example.com/gift-jar.png" })],
    });

    expect(overlays[0].preview).toBeNull();
  });

  it("refuses another format", () => {
    expect(() => parseCatalog({ schema: 2, overlays: [] })).toThrow();
    expect(() => parseCatalog("<html>")).toThrow();
  });
});

describe("downloadOverlay", () => {
  it("returns the zip when it matches the catalog", async () => {
    const fetchMock = vi.fn(async () => new Response(ZIP));
    vi.stubGlobal("fetch", fetchMock);

    expect(await downloadOverlay(entry())).toEqual(ZIP);
    expect(fetchMock).toHaveBeenCalledWith(entry().url, expect.anything());
  });

  it("refuses a zip that doesn't match the catalog", async () => {
    const other = zipSync({ "index.html": strToU8("<p>other</p>") });
    vi.stubGlobal("fetch", async () => new Response(other));

    await expect(downloadOverlay(entry())).rejects.toThrow("doesn't match");
    await expect(
      downloadOverlay(entry({ size: other.length })),
    ).rejects.toThrow("doesn't match");
  });

  it("fails when GitHub doesn't send it", async () => {
    vi.stubGlobal("fetch", async () => new Response(null, { status: 404 }));

    await expect(downloadOverlay(entry())).rejects.toThrow("404");
  });

  it("only downloads from the overlays' releases", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      downloadOverlay(entry({ url: "https://example.com/gift-jar.zip" })),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("extractZip", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "tokio-test-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("writes the files and their folders", async () => {
    const folder = join(root, "overlay");
    const zip = zipSync({
      "index.html": strToU8("<p></p>"),
      "assets/": new Uint8Array(),
      "assets/app.js": strToU8("go()"),
    });

    await extractZip(zip, folder);

    expect((await readdir(folder)).sort()).toEqual(["assets", "index.html"]);
    expect(await readFile(join(folder, "assets", "app.js"), "utf-8")).toBe(
      "go()",
    );
  });

  it("refuses files that would land outside the folder", async () => {
    const folder = join(root, "overlay");

    for (const name of ["../evil.js", "/evil.js", "a\\..\\..\\evil.js"]) {
      const zip = zipSync({
        "index.html": strToU8("<p></p>"),
        [name]: strToU8("evil()"),
      });
      await expect(extractZip(zip, folder)).rejects.toThrow("outside");
    }
    expect(await readdir(root)).toEqual([]);
  });
});
