import {
  access,
  mkdtemp,
  readFile,
  rm,
  truncate,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PathManagerService } from "./index";

describe("PathManagerService", () => {
  let home: string;

  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), "tokio-test-"));
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("creates every folder and log file under the app folder", async () => {
    const service = new PathManagerService();
    const callback = vi.fn();

    await service.initialize(home, ".tokio", callback);

    expect(service.folders.appFolder).toBe(join(home, ".tokio"));
    for (const path of [
      ...Object.values(service.folders),
      ...Object.values(service.files.logs),
    ]) {
      await expect(access(path)).resolves.toBeUndefined();
    }
    expect(service.folders.soundsFolder).toBe(join(home, ".tokio", "sounds"));
    expect(service.folders.mediaFolder).toBe(join(home, ".tokio", "media"));
    expect(callback).toHaveBeenCalledWith({
      files: service.files,
      folders: service.folders,
    });
  });

  it("keeps existing logs", async () => {
    const service = new PathManagerService();
    await service.initialize(home, ".tokio");
    await writeFile(service.files.logs.system, "old entry\n");

    await new PathManagerService().initialize(home, ".tokio");

    expect(await readFile(service.files.logs.system, "utf-8")).toBe(
      "old entry\n",
    );
  });

  it("moves a log over 5 MB to its backup and starts a new one", async () => {
    const service = new PathManagerService();
    await service.initialize(home, ".tokio");
    const log = service.files.logs.system;
    const backup = log.replace(/\.log$/, ".old.log");
    await writeFile(backup, "older backup\n");
    await writeFile(log, "old entry\n");
    await truncate(log, 5 * 1024 * 1024 + 1);

    await new PathManagerService().initialize(home, ".tokio");

    expect(await readFile(log, "utf-8")).toBe("");
    expect(await readFile(backup, "utf-8")).toMatch(/^old entry\n/);
  });
});
