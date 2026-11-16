import Logger from "@/logger";
import { ipcMain } from "@test/electron";
import {
  DEFAULT_LISTS,
  type ElectronBlockerOptions,
  type ListStorage,
} from "@tokioapp/adblock";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AdBlocker } from "./adblock";

const mocks = vi.hoisted(() => {
  // The real one downloads its lists as it's made
  class FakeBlocker {
    ready = Promise.resolve();
    engine = { stats: {} as Record<string, unknown> };
    update = vi.fn(async () => false);
    dispose = vi.fn();
    constructor(readonly options: ElectronBlockerOptions) {
      made.push(this);
    }
  }
  const made: FakeBlocker[] = [];
  const updateLists =
    vi.fn<(options: { lists: { id: string }[] }) => Promise<boolean>>();
  return { FakeBlocker, made, updateLists };
});

vi.mock("@tokioapp/adblock", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tokioapp/adblock")>()),
  ElectronBlocker: mocks.FakeBlocker,
  updateLists: mocks.updateLists,
}));

describe("AdBlocker", () => {
  let folder: string;
  let adBlocker: AdBlocker;
  const made = () => mocks.made.at(-1)!;

  beforeEach(async () => {
    mocks.made.length = 0;
    mocks.updateLists.mockReset().mockResolvedValue(false);
    folder = await mkdtemp(join(tmpdir(), "tokio-adblock-"));
    adBlocker = new AdBlocker(() => "music.log");
    adBlocker.folder = folder;
  });

  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  it("makes one blocker, with uBlock's defaults but the malware list and Peter Lowe's", () => {
    const blocker = adBlocker.get();

    expect(adBlocker.get()).toBe(blocker);
    expect(mocks.made).toHaveLength(1);
    expect(made().options.ipcMain).toBe(ipcMain);
    expect(made().options.lists?.map((list) => list.id)).toEqual(
      DEFAULT_LISTS.map((list) => list.id).filter(
        (id) => id !== "urlhaus-1" && id !== "plowe-0",
      ),
    );
  });

  it("saves the lists in adblock/ in the extra folder", async () => {
    adBlocker.get();
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion
    const storage = made().options.storage as ListStorage;

    await storage.write("easylist", {
      text: "||ads.example^",
      url: "https://lists.example/easylist.txt",
      fetchedAt: 0,
    });

    expect(await readdir(join(folder, "adblock"))).toEqual(
      expect.arrayContaining(["easylist.txt", "easylist.json"]),
    );
  });

  it("logs each failure once", () => {
    const warn = vi.spyOn(Logger, "warn");
    adBlocker.get();
    const { onError } = made().options;

    onError?.(new Error("Couldn't download easylist"));
    onError?.(new Error("Couldn't download easylist"));
    onError?.(new Error("Couldn't download easyprivacy"));

    expect(warn.mock.calls).toEqual([
      ["<Music> Ad blocker: Couldn't download easylist", "music.log"],
      ["<Music> Ad blocker: Couldn't download easyprivacy", "music.log"],
    ]);
  });

  it("is ready once a list is in effect", async () => {
    const blocker = adBlocker.get();
    made().engine.stats = { "ublock-filters": {} };

    await expect(adBlocker.ready()).resolves.toBe(blocker);
    expect(made().update).not.toHaveBeenCalled();
  });

  it("tries the lists again when none loaded", async () => {
    const blocker = adBlocker.get();
    made().update.mockImplementation(async () => {
      made().engine.stats = { easylist: {} };
      return true;
    });

    await expect(adBlocker.ready()).resolves.toBe(blocker);
    expect(made().update).toHaveBeenCalledOnce();
  });

  it("fails when no list is saved and none downloads", async () => {
    adBlocker.get();

    await expect(adBlocker.ready()).rejects.toThrow(
      "No filter list could be loaded",
    );
  });

  it("frees the blocker, and makes a new one next time", () => {
    const first = adBlocker.get();
    const fake = made();

    adBlocker.dispose();
    adBlocker.dispose();

    expect(fake.dispose).toHaveBeenCalledOnce();
    expect(adBlocker.get()).not.toBe(first);
  });

  it("updates the saved lists without building a blocker", () => {
    adBlocker.update();
    adBlocker.update();

    expect(mocks.made).toHaveLength(0);
    expect(mocks.updateLists).toHaveBeenCalledOnce();
    expect(
      mocks.updateLists.mock.calls[0]?.[0].lists.map((list) => list.id),
    ).toEqual(
      DEFAULT_LISTS.map((list) => list.id).filter(
        (id) => id !== "urlhaus-1" && id !== "plowe-0",
      ),
    );
  });

  it("builds after an update still running, and leaves a blocker in use to update itself", async () => {
    let finish = () => {};
    mocks.updateLists.mockReturnValue(
      new Promise<boolean>((resolve) => {
        finish = () => resolve(true);
      }),
    );
    adBlocker.update();
    const ready = adBlocker.ready();
    await Promise.resolve();
    expect(mocks.made).toHaveLength(0);

    finish();

    await expect(ready).rejects.toThrow("No filter list could be loaded");
    expect(mocks.made).toHaveLength(1);
    adBlocker.update();
    expect(mocks.updateLists).toHaveBeenCalledOnce();
  });

  it("builds nothing when its connect ended during an update", async () => {
    let finish = () => {};
    mocks.updateLists.mockReturnValue(
      new Promise<boolean>((resolve) => {
        finish = () => resolve(true);
      }),
    );
    let wanted = true;
    adBlocker.update();
    const ready = adBlocker.ready(() => wanted);

    wanted = false;
    finish();

    await expect(ready).rejects.toThrow();
    expect(mocks.made).toHaveLength(0);
  });

  it("downloads no list again when its connect ended", async () => {
    adBlocker.get();
    const wanted = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);

    await expect(adBlocker.ready(wanted)).rejects.toThrow();
    expect(made().update).not.toHaveBeenCalled();
  });

  it("checks the saved lists at most once an hour", async () => {
    let now = 0;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const checked = () => new Promise((resolve) => setTimeout(resolve));

    adBlocker.update();
    await checked();
    now += 59 * 60_000;
    adBlocker.update();
    await checked();

    expect(mocks.updateLists).toHaveBeenCalledOnce();

    now += 2 * 60_000;
    adBlocker.update();

    expect(mocks.updateLists).toHaveBeenCalledTimes(2);
  });
});
