import Logger from "@/logger";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { hasPending, settle, track } from "./quit";

// A promise the test settles by hand
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("quit helpers", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("holds work until it settles, resolved or rejected", async () => {
    const saved = deferred();
    const failed = deferred();

    expect(track(saved.promise)).toBe(saved.promise);
    track(failed.promise).catch(() => {});
    expect(hasPending()).toBe(true);

    saved.resolve();
    failed.reject(new Error("disk full"));
    await settle(1000);

    expect(hasPending()).toBe(false);
  });

  it("waits for work started while it waits", async () => {
    const first = deferred();
    const second = deferred();
    track(first.promise);
    let settled = false;

    const done = settle(1000).then(() => (settled = true));
    track(second.promise);
    first.resolve();
    await first.promise;
    await new Promise((resolve) => setTimeout(resolve));
    expect(settled).toBe(false);

    second.resolve();
    await done;
    expect(hasPending()).toBe(false);
  });

  it("gives up after the time it's given", async () => {
    vi.useFakeTimers();
    const stuck = deferred();
    track(stuck.promise);
    let settled = false;

    const done = settle(3000).then(() => (settled = true));
    await vi.advanceTimersByTimeAsync(2999);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(hasPending()).toBe(true);
    stuck.resolve();
  });

  it("waits for the log lines still being written", async () => {
    const dir = await mkdtemp(join(tmpdir(), "tokio-test-"));
    const file = join(dir, "system.log");

    Logger.info("quitting", file);
    await settle(1000);

    expect(await readFile(file, "utf-8")).toMatch(/quitting\n$/);
    await rm(dir, { recursive: true, force: true });
  });

  it("resolves at once with nothing pending", async () => {
    vi.useFakeTimers();

    await settle(3000);

    expect(vi.getTimerCount()).toBe(0);
  });
});
