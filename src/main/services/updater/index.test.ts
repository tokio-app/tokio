import { UpdateStatus } from "@/common/types";
import { REPOSITORY_URL } from "@/common/util";
import { track } from "@/helper/quit";
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHECK_INTERVAL_MS,
  STARTUP_DELAY_MS,
  Updater,
  UpdaterService,
} from "./index";

type CheckResult = Awaited<ReturnType<Updater["checkForUpdates"]>>;

// Stands in for electron-updater's autoUpdater.
class FakeUpdater extends EventEmitter implements Updater {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  // What the real one sets for an -alpha version
  allowPrerelease = true;
  allowDowngrade = false;
  forceDevUpdateConfig = false;
  logger: Updater["logger"] = null;
  active = true;
  checkForUpdates = vi.fn<() => Promise<CheckResult>>(async () => {
    this.emit("checking-for-update");
    this.emit("update-not-available", { version: "0.1.0" });
    return { updateInfo: { version: "0.1.0" } };
  });
  quitAndInstall = vi.fn();
  isUpdaterActive() {
    return this.active;
  }
}

describe("UpdaterService", () => {
  let updater: FakeUpdater;
  let statuses: UpdateStatus[];

  beforeEach(() => {
    updater = new FakeUpdater();
    statuses = [];
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const create = async (
    platform: NodeJS.Platform = "win32",
    callbacks: Parameters<UpdaterService["initialize"]>[0] = {},
  ) => {
    const service = new UpdaterService(updater, platform);
    await service.initialize({
      onStatus: (s) => statuses.push(s),
      ...callbacks,
    });
    return service;
  };

  it("follows GitHub's latest release, not prereleases", async () => {
    // The opposite of what the service sets, so each check can fail
    updater.allowDowngrade = true;
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;

    await create();

    expect(updater.allowPrerelease).toBe(false);
    expect(updater.allowDowngrade).toBe(false);
    expect(updater.autoDownload).toBe(true);
    expect(updater.autoInstallOnAppQuit).toBe(true);
    expect(updater.logger).not.toBeNull();
  });

  it("reports the status of a download until it's ready", async () => {
    const onUpdate = vi.fn();
    const service = await create("win32", { onUpdate });

    updater.emit("checking-for-update");
    updater.emit("update-available", { version: "0.2.0" });
    updater.emit("download-progress", { percent: 12.3 });
    updater.emit("download-progress", { percent: 13.9 });
    updater.emit("download-progress", { percent: 57 });
    updater.emit("update-downloaded", { version: "0.2.0" });

    expect(statuses).toEqual([
      { state: "checking" },
      {
        state: "available",
        version: "0.2.0",
        manual: false,
        url: `${REPOSITORY_URL}/releases/tag/v0.2.0`,
      },
      { state: "downloading", version: "0.2.0", percent: 10 },
      { state: "downloading", version: "0.2.0", percent: 55 },
      { state: "ready", version: "0.2.0" },
    ]);
    expect(onUpdate).toHaveBeenCalledOnce();
    expect(onUpdate).toHaveBeenCalledWith({ state: "ready", version: "0.2.0" });
    expect(service.getStatus()).toEqual({ state: "ready", version: "0.2.0" });
  });

  it("points macOS at the release page instead of downloading", async () => {
    const onUpdate = vi.fn();
    const service = await create("darwin", { onUpdate });

    updater.emit("update-available", { version: "0.2.0" });

    const status = {
      state: "available",
      version: "0.2.0",
      manual: true,
      url: `${REPOSITORY_URL}/releases/tag/v0.2.0`,
    };
    expect(updater.autoDownload).toBe(false);
    expect(onUpdate).toHaveBeenCalledWith(status);
    expect(service.install()).toEqual({
      success: true,
      data: { url: status.url },
    });
    expect(updater.quitAndInstall).not.toHaveBeenCalled();
  });

  it("is unsupported when the updater is inactive", async () => {
    updater.active = false;
    const service = await create();

    expect(service.getStatus()).toEqual({ state: "unsupported" });
    expect(await service.check()).toMatchObject({ success: false });
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it("shares one request between concurrent checks", async () => {
    const service = await create();

    const [a, b] = await Promise.all([service.check(), service.check()]);

    expect(a).toEqual({ success: true });
    expect(b).toEqual({ success: true });
    expect(updater.checkForUpdates).toHaveBeenCalledOnce();
    expect(service.getStatus()).toMatchObject({ state: "none" });
  });

  it("returns a failed check and keeps the last status", async () => {
    const service = await create();
    await service.check();
    const before = service.getStatus();
    updater.checkForUpdates.mockImplementationOnce(async () => {
      updater.emit("checking-for-update");
      throw new Error("offline");
    });

    const res = await service.check();

    expect(res).toEqual({
      success: false,
      error: expect.stringContaining("offline"),
    });
    expect(service.getStatus()).toEqual(before);
  });

  it("goes back to available when the download fails", async () => {
    const onDownloadFailed = vi.fn();
    const service = await create("win32", { onDownloadFailed });
    const error = new Error("reset");
    updater.checkForUpdates.mockImplementationOnce(async () => {
      updater.emit("update-available", { version: "0.2.0" });
      return {
        updateInfo: { version: "0.2.0" },
        downloadPromise: Promise.reject(error),
      };
    });

    await service.check();
    await vi.waitFor(() => expect(onDownloadFailed).toHaveBeenCalled());

    expect(onDownloadFailed).toHaveBeenCalledWith(error);
    expect(service.getStatus()).toMatchObject({
      state: "available",
      version: "0.2.0",
      manual: false,
    });
  });

  it("doesn't check again once an update is ready", async () => {
    const service = await create();
    updater.emit("update-downloaded", { version: "0.2.0" });

    expect(await service.check()).toEqual({ success: true });
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it("checks after startup and then on an interval while auto is on", async () => {
    vi.useFakeTimers();
    const service = await create();

    service.setAuto(true);
    expect(updater.checkForUpdates).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(STARTUP_DELAY_MS);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS - STARTUP_DELAY_MS);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);

    service.setAuto(false);
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS * 2);
    expect(updater.checkForUpdates).toHaveBeenCalledTimes(2);
  });

  it("doesn't check on its own when auto is off or after dispose", async () => {
    vi.useFakeTimers();
    const service = await create();

    service.setAuto(false);
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);
    service.setAuto(true);
    service.dispose();
    await vi.advanceTimersByTimeAsync(CHECK_INTERVAL_MS);

    expect(updater.checkForUpdates).not.toHaveBeenCalled();
  });

  it("installs only a downloaded update", async () => {
    const service = await create();

    expect(service.install()).toMatchObject({ success: false });
    expect(updater.quitAndInstall).not.toHaveBeenCalled();

    updater.emit("update-downloaded", { version: "0.2.0" });

    expect(service.install()).toEqual({ success: true });
    await vi.waitFor(() =>
      expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true),
    );
  });

  // The installer starts first, and the app quits after it.
  it("waits for the saves still running before it installs, once", async () => {
    const service = await create();
    updater.emit("update-downloaded", { version: "0.2.0" });
    let finish!: () => void;
    void track(new Promise<void>((resolve) => (finish = resolve)));

    expect(service.install()).toEqual({ success: true });
    expect(service.install()).toEqual({ success: true });
    await new Promise((resolve) => setTimeout(resolve));
    expect(updater.quitAndInstall).not.toHaveBeenCalled();

    finish();
    await vi.waitFor(() =>
      expect(updater.quitAndInstall).toHaveBeenCalledWith(true, true),
    );
    expect(updater.quitAndInstall).toHaveBeenCalledOnce();
  });
});
