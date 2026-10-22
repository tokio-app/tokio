import {
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
import { renameWithRetry, writeFileAtomic } from "./fs";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: vi.fn(actual.rename) };
});

const failure = (code: string) =>
  Object.assign(new Error(`${code}: rename`), { code });

describe("fs helpers", () => {
  let folder: string;

  beforeEach(async () => {
    folder = await mkdtemp(join(tmpdir(), "tokio-test-"));
  });

  afterEach(async () => {
    vi.useRealTimers();
    vi.mocked(rename).mockClear();
    await rm(folder, { recursive: true, force: true });
  });

  describe("writeFileAtomic", () => {
    it("replaces the file, leaving nothing else", async () => {
      const file = join(folder, "index.html");
      await writeFile(file, "old");

      await writeFileAtomic(file, "new");

      expect(await readFile(file, "utf-8")).toBe("new");
      expect(await readdir(folder)).toEqual(["index.html"]);
    });

    it("keeps the old file whole when it can't be replaced", async () => {
      const file = join(folder, "index.html");
      await writeFile(file, "old");
      vi.mocked(rename).mockRejectedValueOnce(failure("ENOSPC"));

      await expect(writeFileAtomic(file, "new")).rejects.toThrow("ENOSPC");

      expect(await readFile(file, "utf-8")).toBe("old");
      expect(await readdir(folder)).toEqual(["index.html"]);
    });
  });

  describe("renameWithRetry", () => {
    it.each(["EPERM", "EBUSY", "EACCES"])(
      "tries again while the file is held (%s)",
      async (code) => {
        vi.useFakeTimers();
        const from = join(folder, "a");
        await writeFile(from, "data");
        vi.mocked(rename)
          .mockRejectedValueOnce(failure(code))
          .mockRejectedValueOnce(failure(code));

        const renamed = renameWithRetry(from, join(folder, "b"));
        await vi.runAllTimersAsync();
        await renamed;

        expect(rename).toHaveBeenCalledTimes(3);
        expect(await readdir(folder)).toEqual(["b"]);
      },
    );

    it("gives up after about a second", async () => {
      vi.useFakeTimers();
      for (let i = 0; i < 6; i++) {
        vi.mocked(rename).mockRejectedValueOnce(failure("EBUSY"));
      }
      const start = Date.now();

      const renamed = renameWithRetry(join(folder, "a"), join(folder, "b"));
      const failed = expect(renamed).rejects.toThrow("EBUSY");
      await vi.runAllTimersAsync();
      await failed;

      expect(Date.now() - start).toBe(1000);
      expect(rename).toHaveBeenCalledTimes(6);
    });

    it("throws any other error at once", async () => {
      await expect(
        renameWithRetry(join(folder, "missing"), join(folder, "b")),
      ).rejects.toMatchObject({ code: "ENOENT" });

      expect(rename).toHaveBeenCalledOnce();
    });
  });
});
