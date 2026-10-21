import Logger from "@/logger";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { JSONManagerService } from "../json";
import { YAMLManagerService } from "../yaml";
import { BaseFileManagerService, ProviderService } from "./index";

class FakeProvider {
  key = "";
  setKey(key: string) {
    this.key = key;
  }
}

describe("ProviderService", () => {
  it("starts a provider when asked, with an empty key", () => {
    const service = new ProviderService<FakeProvider>();
    const a = new FakeProvider();
    a.key = "stale";

    service.addProvider("a", a, true);
    service.addProvider("b", new FakeProvider());

    expect(a.key).toBe("");
    expect(service.providerNames()).toEqual(["a", "b"]);
  });

  it("switches provider and forwards the key", () => {
    const service = new ProviderService<FakeProvider>();
    const a = new FakeProvider();
    const b = new FakeProvider();
    service.addProvider("a", a, true);
    service.addProvider("b", b);

    service.setProvider("b", "secret");
    expect(b.key).toBe("secret");

    service.setKey("next");
    expect(b.key).toBe("next");
    expect(a.key).toBe("");
  });

  it("ignores unknown providers", () => {
    const service = new ProviderService<FakeProvider>();
    const a = new FakeProvider();
    service.addProvider("a", a, true);

    service.setProvider("missing", "secret");
    service.setKey("next");

    expect(a.key).toBe("next");
  });

  it("setKey only reaches the active provider", () => {
    const service = new ProviderService<FakeProvider>();
    const a = new FakeProvider();
    const b = new FakeProvider();
    service.addProvider("a", a, true);
    service.addProvider("b", b);

    service.setKey("secret");

    expect(a.key).toBe("secret");
    expect(b.key).toBe("");
  });
});

const Schema = z.object({
  name: z.string(),
  tags: z.array(z.string()),
  // Optional so an update can carry part of it, like settings updates do.
  nested: z.object({ a: z.number().optional(), b: z.number().optional() }),
});
type Data = z.infer<typeof Schema>;

const sample: Data = {
  name: "tokio",
  tags: ["x", "y"],
  nested: { a: 1, b: 2 },
};

describe.each([
  { type: "json", create: () => new JSONManagerService(), malformed: "{ nope" },
  {
    type: "yaml",
    create: () => new YAMLManagerService(),
    malformed: "a: [1, 2",
  },
])("BaseFileManagerService ($type)", ({ type, create, malformed }) => {
  let dir: string;
  let service: BaseFileManagerService;
  let file: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tokio-test-"));
    service = create();
    file = join(dir, `data.${type}`);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("saves and loads a file", async () => {
    expect(await service.saveFile(file, Schema, sample)).toBe(true);
    expect(await service.loadFile(file, Schema)).toEqual(sample);
  });

  it("refuses to save invalid data and leaves no file behind", async () => {
    const invalid = { ...sample, nested: { a: "1" } };

    expect(await service.saveFile<unknown>(file, Schema, invalid)).toBe(false);
    expect(await readdir(dir)).toEqual([]);
  });

  it("returns false and logs when the file can't be written", async () => {
    const error = vi.spyOn(Logger, "error");

    expect(
      await service.saveFile(join(dir, "missing", "data"), Schema, sample),
    ).toBe(false);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining(`Unable to save ${type} file`),
      undefined,
      expect.any(Error),
    );
  });

  it("returns null for a missing file without logging", async () => {
    const error = vi.spyOn(Logger, "error");

    expect(await service.loadFile(file, Schema)).toBeNull();
    expect(error).not.toHaveBeenCalled();
  });

  it("returns null and logs for malformed content", async () => {
    const error = vi.spyOn(Logger, "error");
    await writeFile(file, malformed);

    expect(await service.loadFile(file, Schema)).toBeNull();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining(`Malformed ${type.toUpperCase()}`),
      undefined,
      expect.any(Error),
    );
  });

  it("returns null and logs for content that fails the schema", async () => {
    const error = vi.spyOn(Logger, "error");
    await service.saveArbitraryFile(file, { name: 1 });

    expect(await service.loadFile(file, Schema)).toBeNull();
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("Schema validation failed"),
      undefined,
      undefined,
    );
    expect(await service.loadArbitraryFile(file)).toEqual({ name: 1 });
  });

  it("deep merges updates, replacing arrays and skipping undefined", async () => {
    await service.saveFile(file, Schema, sample);

    const res = await service.updateFile(file, Schema, {
      name: undefined,
      tags: ["z"],
      nested: { b: 3 },
    });

    const expected = { name: "tokio", tags: ["z"], nested: { a: 1, b: 3 } };
    expect(res).toEqual({ success: true, data: expected });
    expect(await service.loadFile(file, Schema)).toEqual(expected);
  });

  it("fails to update a missing file", async () => {
    expect(await service.updateFile(file, Schema, { name: "x" })).toEqual({
      success: false,
      data: null,
    });
  });

  it("does not lose concurrent updates", async () => {
    const Counts = z.object({ counts: z.record(z.string(), z.number()) });
    await service.saveFile(file, Counts, { counts: {} });

    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        service.updateFile(file, Counts, { counts: { [`k${i}`]: i } }),
      ),
    );

    const saved = await service.loadFile(file, Counts);
    expect(Object.keys(saved?.counts ?? {})).toHaveLength(10);
    expect(await readFile(file, "utf-8")).toContain("k9");
  });
});
