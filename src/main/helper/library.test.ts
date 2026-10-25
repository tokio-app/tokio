import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { importFile } from "./library";

describe("importFile", () => {
  let dir: string;
  let library: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tokio-test-"));
    // PathManagerService makes the libraries' folders
    library = join(dir, "library");
    await mkdir(library);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("copies the file, named by its content, and names the entry after it", async () => {
    const src = join(dir, "Creeper.PNG");
    await writeFile(src, "creeper");

    const { data, entry } = await importFile(src, library, ["png"], 100);

    expect(entry.name).toBe("Creeper");
    expect(entry.file).toMatch(/^[0-9a-f]{32}\.png$/);
    expect(new TextDecoder().decode(data)).toBe("creeper");
    expect(await readFile(join(library, entry.file), "utf8")).toBe("creeper");
  });

  it("reuses the file for the same content", async () => {
    await writeFile(join(dir, "a.png"), "same");
    await writeFile(join(dir, "b.png"), "same");

    const a = await importFile(join(dir, "a.png"), library, ["png"], 100);
    const b = await importFile(join(dir, "b.png"), library, ["png"], 100);

    expect(b.entry.file).toBe(a.entry.file);
    expect(await readdir(library)).toEqual([a.entry.file]);
  });

  it("refuses other extensions and bigger files", async () => {
    await writeFile(join(dir, "clip.mp4"), "clip");
    await writeFile(join(dir, "big.png"), "x".repeat(101));

    await expect(
      importFile(join(dir, "clip.mp4"), library, ["png"], 100),
    ).rejects.toThrow("Unsupported format: mp4");
    await expect(
      importFile(join(dir, "big.png"), library, ["png"], 100),
    ).rejects.toThrow("over 100 bytes");
    expect(await readdir(library)).toEqual([]);
  });
});
