import { ProfileSchema, StoreZodSchema } from "@/common/schemas";
import { defaultProfile } from "@/common/util";
import { defaultStoreData } from "@/common/util/constants/store";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { JSONManagerService } from "./index";

describe("JSONManagerService", () => {
  let dir: string;
  const json = new JSONManagerService();

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "tokio-test-"));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // As Windows PowerShell 5.1 saves a hand-edited file
  const withBOM = (data: unknown) => `\uFEFF${JSON.stringify(data, null, 2)}`;

  it("reads a store saved with a BOM", () => {
    const content = withBOM(defaultStoreData);

    expect(json.parseFile("tokio.json", content, StoreZodSchema)).toEqual(
      defaultStoreData,
    );
  });

  it("loads a profile saved with a BOM", async () => {
    const file = join(dir, "default.json");
    await writeFile(file, withBOM(defaultProfile));

    expect(await json.loadFile(file, ProfileSchema)).toEqual(defaultProfile);
  });
});
