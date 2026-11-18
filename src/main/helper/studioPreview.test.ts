import { StudioElementSchema, StudioOverlay } from "@/common/schemas";
import {
  app,
  BrowserWindow,
  cancelableEvent,
  fakeImage,
  session,
  windows as allWindows,
} from "@test/electron";
import { createHandler } from "@test/handler";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PREVIEW_TIMEOUT_MS, previewStudioOverlay } from "./studioPreview";

const ID = "6f1d2c1e-4b5a-4c3d-9e8f-0a1b2c3d4e5f";

const overlay = (size: StudioOverlay["size"] = "portrait"): StudioOverlay => ({
  id: ID,
  name: "",
  size,
  rulers: false,
  guides: { x: [], y: [], locked: false },
  items: [
    StudioElementSchema.parse({
      id: "t",
      kind: "text",
      text: "Hi {likes}",
      x: 0,
      y: 0,
      width: 10,
      height: 10,
    }),
  ],
});

const services = () =>
  createHandler({
    overlayService: {
      getGifts: async () => [],
      getCustomGifts: async () => [],
      getOverlays: () => [],
    },
    serverService: { getPort: () => 37891 },
  }).handler;

type Page = InstanceType<typeof BrowserWindow>["webContents"];

// The preview windows: createHandler makes the app's own
const isPreview = (win: InstanceType<typeof BrowserWindow>) =>
  win.options.webPreferences?.partition === "studio-preview";
const windows = () => allWindows().filter(isPreview);

// Sets up each preview window's page before it loads
const onPage = (setup: (page: Page) => void) => {
  app.on(
    "browser-window-created",
    (_: unknown, win: InstanceType<typeof BrowserWindow>) => {
      if (isPreview(win)) setup(win.webContents);
    },
  );
};

describe("previewStudioOverlay", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("draws the overlay's sample view in a hidden window, at the scale", async () => {
    onPage((page) => {
      page.executeJavaScript.mockResolvedValue(2);
      // A display at 2x
      page.capturePage.mockResolvedValue(
        fakeImage({ width: 1080, height: 1920 }),
      );
    });

    const shot = await previewStudioOverlay(services(), overlay(), 0.5);

    expect(shot).toEqual({
      png: Buffer.from("png 540x960"),
      width: 540,
      height: 960,
      failed: 2,
    });
    const [win] = windows();
    expect(win.options).toMatchObject({
      show: false,
      width: 540,
      height: 960,
      useContentSize: true,
      frame: false,
      skipTaskbar: true,
      focusable: false,
      enableLargerThanScreen: true,
      webPreferences: {
        partition: "studio-preview",
        sandbox: true,
        backgroundThrottling: false,
      },
    });
    expect(win.options.webPreferences).not.toHaveProperty("preload");
    expect(win.loadURL).toHaveBeenCalledWith(
      `http://127.0.0.1:37891/studio/${ID}/?preview`,
    );
    // The first wakes the hidden page's raster; the second is kept
    const canvas = { x: 0, y: 0, width: 540, height: 960 };
    expect(win.webContents.capturePage.mock.calls).toEqual([
      [canvas],
      [canvas],
    ]);
    const [[code]] = win.webContents.executeJavaScript.mock.calls;
    const view: unknown = JSON.parse(
      code.replace(/^TokioPreview\(/, "").replace(/\)$/, ""),
    );
    expect(view).toMatchObject({
      width: 1080,
      height: 1920,
      layers: [{ elements: [{ id: "t", text: "Hi 12.8K" }] }],
    });
    expect(win.isDestroyed()).toBe(true);
  });

  it("takes a landscape canvas at its own size", async () => {
    const shot = await previewStudioOverlay(
      services(),
      overlay("landscape"),
      1,
    );

    expect(shot).toMatchObject({ width: 1920, height: 1080, failed: 0 });
    expect(shot.png).toEqual(Buffer.from("png 1920x1080"));
  });

  it("draws a canvas taller than the screen in a window of its shape", async () => {
    const shot = await previewStudioOverlay(services(), overlay(), 1);

    // The fake work area is 1040 px tall: a window that size, as wide as
    // the canvas's shape makes it, then the picture at the size asked
    const [win] = windows();
    expect(win.options).toMatchObject({ width: 585, height: 1040 });
    expect(win.webContents.capturePage).toHaveBeenLastCalledWith({
      x: 0,
      y: 0,
      width: 585,
      height: 1040,
    });
    expect(shot).toMatchObject({ width: 1080, height: 1920 });
    expect(shot.png).toEqual(Buffer.from("png 1080x1920"));
  });

  it("denies permissions, new windows, navigation and sound", async () => {
    let page: Page | undefined;
    onPage((p) => (page = p));

    await previewStudioOverlay(services(), overlay(), 0.5);

    const partition = session.fromPartition("studio-preview");
    const [[request]] = partition.setPermissionRequestHandler.mock.calls;
    const callback = vi.fn();
    request(null, "media", callback);
    expect(callback).toHaveBeenCalledWith(false);
    const [[check]] = partition.setPermissionCheckHandler.mock.calls;
    expect(check(null, "media")).toBe(false);

    const [[open]] = page!.setWindowOpenHandler.mock.calls;
    expect(open({ url: "https://example.com" })).toEqual({ action: "deny" });
    const navigation = cancelableEvent({});
    page!.emit("will-navigate", navigation);
    expect(navigation.defaultPrevented).toBe(true);
    expect(page!.setAudioMuted).toHaveBeenCalledWith(true);
  });

  it("destroys the window when the page fails", async () => {
    onPage((page) =>
      page.executeJavaScript.mockRejectedValue(new Error("no TokioPreview")),
    );

    await expect(
      previewStudioOverlay(services(), overlay(), 0.5),
    ).rejects.toThrow("no TokioPreview");
    expect(windows()[0].isDestroyed()).toBe(true);
  });

  it("gives up and destroys the window when the page never draws", async () => {
    vi.useFakeTimers();
    onPage((page) =>
      page.executeJavaScript.mockReturnValue(new Promise(() => {})),
    );

    const shot = previewStudioOverlay(services(), overlay(), 0.5);
    const failed = expect(shot).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(PREVIEW_TIMEOUT_MS);

    await failed;
    expect(windows()[0].isDestroyed()).toBe(true);
  });

  it("runs one preview at a time", async () => {
    const draws: ((failed: number) => void)[] = [];
    onPage((page) =>
      page.executeJavaScript.mockReturnValue(
        new Promise((resolve) => draws.push(resolve)),
      ),
    );

    const first = previewStudioOverlay(services(), overlay(), 0.5);
    const second = previewStudioOverlay(services(), overlay(), 0.5);
    await vi.waitFor(() => expect(draws).toHaveLength(1));
    // The second waits for the first's window to go
    expect(windows()).toHaveLength(1);

    draws[0](0);
    await first;
    expect(windows()[0].isDestroyed()).toBe(true);
    await vi.waitFor(() => expect(draws).toHaveLength(2));
    draws[1](1);

    await expect(second).resolves.toMatchObject({ failed: 1 });
    expect(windows()).toHaveLength(2);
    expect(windows()[1].isDestroyed()).toBe(true);
  });
});
