import { YAMLManagerService } from "@/services/yaml";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findOverlays, processHTML } from "./index";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: vi.fn(actual.rename),
    writeFile: vi.fn(actual.writeFile),
  };
});

describe("findOverlays", () => {
  let folder: string;

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "tokio-test-"));
  });

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  const overlay = async (id: string, files: Record<string, string>) => {
    await mkdir(join(folder, id));
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(folder, id, name), content);
    }
  };

  const info = (name: string, config = false) =>
    `name: ${name}\nversion: 1.0.0\nconfig: ${config}\n`;

  // Imported overlays are named by a UUID, official ones by their catalog id.
  const imported = "8f14e45f-ceea-4672-9a8e-1b2c3d4e5f60";

  it("lists the overlays that still load", async () => {
    await overlay("b-clock", {
      "info.yaml": info("Clock"),
      "index.html": "<h1>clock</h1>",
    });
    await overlay(imported, {
      "info.yml": info("Chat"),
      "index.html": "<p>chat</p>",
    });
    // An install in progress
    await overlay(".install-1", {
      "info.yaml": info("Clock"),
      "index.html": "<h1>clock</h1>",
    });
    await overlay("no-html", { "info.yaml": info("Broken") });
    await overlay("bad-info", {
      "info.yaml": "name: [",
      "index.html": "<p></p>",
    });
    await overlay("missing-config", {
      "info.yaml": info("Configurable", true),
      "index.html": "<p></p>",
    });
    await writeFile(join(folder, "stray.txt"), "not an overlay");

    expect(await findOverlays(folder, new YAMLManagerService())).toEqual([
      {
        id: imported,
        name: "Chat",
        version: "1.0.0",
        config: false,
        external: true,
      },
      {
        id: "b-clock",
        name: "Clock",
        version: "1.0.0",
        config: false,
        external: false,
      },
    ]);
  });

  it("finds nothing in a missing folder", async () => {
    expect(
      await findOverlays(join(folder, "missing"), new YAMLManagerService()),
    ).toEqual([]);
  });
});

describe("processHTML", () => {
  let dir: string;
  const html = () => readFile(join(dir, "index.html"), "utf-8");
  const written =
    '<script id="tokio-setup"> window.__OVERLAY_ID__ = "a"; </script>';

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tokio-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("writes the ID into the setup block", async () => {
    await writeFile(
      join(dir, "index.html"),
      '<script id="tokio-setup"></script>',
    );

    expect(
      await processHTML("a", '<script id="tokio-setup"></script>', dir),
    ).toEqual({ success: true });
    expect(await html()).toBe(written);
  });

  it("leaves an HTML that already has its settings alone", async () => {
    await writeFile(join(dir, "index.html"), written);
    vi.mocked(writeFile).mockClear();

    expect(await processHTML("a", written, dir)).toEqual({ success: true });
    expect(writeFile).not.toHaveBeenCalled();
  });

  it("keeps the old HTML whole when the new one can't be written", async () => {
    const old = '<script id="tokio-setup"></script>';
    await writeFile(join(dir, "index.html"), old);
    vi.mocked(rename).mockRejectedValueOnce(
      Object.assign(new Error("ENOSPC: no space left"), { code: "ENOSPC" }),
    );

    expect(await processHTML("a", old, dir)).toEqual({ success: false });
    expect(await html()).toBe(old);
    expect(await readdir(dir)).toEqual(["index.html"]);
  });
});
