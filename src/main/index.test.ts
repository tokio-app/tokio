import { APP_EVENTS_RESPONSE, FEEDBACK_CODES } from "@/common/types";
import type { AppHandlerVariables } from "@/types";
import { app, net, protocol, windows } from "@test/electron";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const services: Record<string, any> = {};
  // A service class that keeps its instance in `services`
  const service = (name: string) =>
    class {
      initialize = vi.fn();
      dispose = vi.fn();
      constructor() {
        services[name] = this;
      }
    };
  return { services, service, deps: null as AppHandlerVariables | null };
});

vi.mock("@electron-toolkit/utils", () => ({
  electronApp: { setAppUserModelId: vi.fn() },
  is: { dev: false },
  optimizer: { watchWindowShortcuts: vi.fn() },
}));
vi.mock("@/services/alerts", () => ({
  AlertsService: mocks.service("alerts"),
}));
vi.mock("@/services/tts", () => ({ TTSService: mocks.service("tts") }));
vi.mock("@/services/music", () => ({ MusicService: mocks.service("music") }));
vi.mock("@/services/server", () => ({
  ServerService: mocks.service("server"),
}));
vi.mock("@/services/overlay", () => ({
  OverlayService: mocks.service("overlay"),
}));
vi.mock("@/services/url", () => ({ URLManagerService: mocks.service("url") }));
vi.mock("@/services/json", () => ({
  JSONManagerService: mocks.service("json"),
}));
vi.mock("@/services/path", () => ({
  PathManagerService: mocks.service("path"),
}));
vi.mock("@/services/connector", () => ({
  TikTokConnectorService: mocks.service("connector"),
}));
vi.mock("@/services/store", () => ({
  StoreManagerService: mocks.service("store"),
}));
vi.mock("@/services/yaml", () => ({
  YAMLManagerService: mocks.service("yaml"),
}));
vi.mock("@/services/licenses", () => ({
  LicensesService: mocks.service("licenses"),
}));
vi.mock("@/services/updater", () => ({
  UpdaterService: mocks.service("updater"),
}));
vi.mock("./handler", () => ({
  default: class {
    init = vi.fn(async () => {});
    constructor(deps: AppHandlerVariables) {
      mocks.deps = deps;
    }
  },
}));
vi.mock("./events", () => ({ default: { getEvents: () => [] } }));

// What the entry point adds to the process, kept apart from the runner's
let fatal: {
  exception?: NodeJS.UncaughtExceptionListener;
  rejection?: NodeJS.UnhandledRejectionListener;
} = {};

// Runs the entry point as Electron does
async function load() {
  vi.resetModules();
  const exceptions = process.listeners("uncaughtExceptionMonitor");
  const rejections = process.listeners("unhandledRejection");
  await import("./index");
  fatal = {
    exception: process
      .listeners("uncaughtExceptionMonitor")
      .find((listener) => !exceptions.includes(listener)),
    rejection: process
      .listeners("unhandledRejection")
      .find((listener) => !rejections.includes(listener)),
  };
}

// Runs the entry point until the app is ready and its windows are open
async function start() {
  await load();
  await vi.waitFor(() => expect(windows()).toHaveLength(2));
  const [splash, win] = windows();
  return { splash, win };
}

describe("main process entry", () => {
  afterEach(() => {
    if (fatal.exception)
      process.off("uncaughtExceptionMonitor", fatal.exception);
    if (fatal.rejection) process.off("unhandledRejection", fatal.rejection);
    fatal = {};
    vi.unstubAllEnvs();
  });

  it("registers local-resource with CORS and fetch before the app is ready", async () => {
    await start();

    expect(protocol.registerSchemesAsPrivileged).toHaveBeenCalledWith([
      {
        scheme: "local-resource",
        privileges: { corsEnabled: true, supportFetchAPI: true },
      },
    ]);
    expect(
      protocol.registerSchemesAsPrivileged.mock.invocationCallOrder[0],
    ).toBeLessThan(app.whenReady.mock.invocationCallOrder[0]);
  });

  it("opens the splash and the main window with the preload", async () => {
    const { splash, win } = await start();

    expect(splash.options).toMatchObject({
      width: 600,
      height: 400,
      show: false,
    });
    expect(win.options).toMatchObject({
      width: 1200,
      height: 800,
      show: false,
      webPreferences: {
        sandbox: false,
        preload: expect.stringMatching(/preload[\\/]index\.mjs$/),
      },
    });
    expect(splash.loadFile).toHaveBeenCalledWith(
      expect.stringMatching(/renderer[\\/]splash\.html$/),
    );
    expect(win.loadFile).toHaveBeenCalledWith(
      expect.stringMatching(/renderer[\\/]index\.html$/),
    );
    expect(mocks.deps).toMatchObject({ app, win, splash });
  });

  describe("overlay previews", () => {
    let folder: string;

    beforeEach(async () => {
      folder = await mkdtemp(join(tmpdir(), "tokio-test-"));
      await mkdir(join(folder, "overlays", "gift-jar"), { recursive: true });
      await writeFile(join(folder, "overlays", "gift-jar", "main.js"), "");
      await writeFile(join(folder, "secret.txt"), "");
    });

    afterEach(async () => {
      await rm(folder, { recursive: true, force: true });
    });

    const request = (file: string) =>
      new Request(
        pathToFileURL(file).href.replace(/^file:/, "local-resource:"),
      );

    it("serves files from the overlays folder with CORS", async () => {
      await start();
      mocks.services.path.folders = {
        overlaysFolder: join(folder, "overlays"),
      };
      net.fetch.mockResolvedValue(new Response("export {}"));
      const [scheme, handle] = protocol.handle.mock.calls[0];
      const file = join(folder, "overlays", "gift-jar", "main.js");

      const res = await handle(request(file));

      expect(scheme).toBe("local-resource");
      expect(net.fetch).toHaveBeenCalledWith(pathToFileURL(file).href);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("*");
      expect(await res.text()).toBe("export {}");
    });

    it("refuses anything outside it", async () => {
      await start();
      mocks.services.path.folders = {
        overlaysFolder: join(folder, "overlays"),
      };
      const [, handle] = protocol.handle.mock.calls[0];

      const res = await handle(request(join(folder, "secret.txt")));

      expect(res.status).toBe(404);
      expect(net.fetch).not.toHaveBeenCalled();
    });
  });

  it("sends notices to the main window until it closes", async () => {
    const { win } = await start();
    const notifier = mocks.deps!.notifier;

    notifier.info("system", FEEDBACK_CODES.UPDATE_READY, "Update ready.");
    win.close();
    notifier.info("system", FEEDBACK_CODES.UPDATE_READY, "Too late.");

    expect(win.webContents.send.mock.calls).toEqual([
      [
        APP_EVENTS_RESPONSE.NOTIFY,
        expect.objectContaining({ message: "Update ready." }),
      ],
    ]);
  });

  it("quits when every window is closed", async () => {
    await start();

    app.emit("window-all-closed");

    expect(app.quit).toHaveBeenCalledOnce();
  });

  it("stops the TTS engines and the updater when quitting", async () => {
    await start();

    app.emit("will-quit");

    expect(mocks.services.tts.dispose).toHaveBeenCalledOnce();
    expect(mocks.services.updater.dispose).toHaveBeenCalledOnce();
  });

  it("logs uncaught exceptions and unhandled rejections", async () => {
    await start();
    // The entry point got its own copy of the logger
    const { default: Logger } = await import("@/logger");
    const error = vi.spyOn(Logger, "error");

    fatal.exception?.(new Error("boom"), "uncaughtException");
    fatal.rejection?.(new Error("boom"), Promise.resolve());

    expect(error).toHaveBeenCalledWith(
      "<System> Uncaught exception -- boom",
      undefined,
      expect.any(Error),
    );
    expect(error).toHaveBeenCalledWith(
      "<System> Unhandled rejection -- boom",
      undefined,
      expect.any(Error),
    );
  });

  it("keeps its data in TOKIO_HOME when it's set", async () => {
    vi.stubEnv("TOKIO_HOME", "/tmp/tokio-e2e");
    await start();

    expect(app.setPath).toHaveBeenCalledWith("home", "/tmp/tokio-e2e");
    expect(app.setPath).toHaveBeenCalledWith("userData", "/tmp/tokio-e2e");
  });

  it("takes the lock on its data folder once TOKIO_HOME has set it", async () => {
    vi.stubEnv("TOKIO_HOME", "/tmp/tokio-e2e");
    await start();

    expect(
      app.requestSingleInstanceLock.mock.invocationCallOrder[0],
    ).toBeGreaterThan(app.setPath.mock.invocationCallOrder.at(-1)!);
  });

  it("quits without opening a window when another Tokio has the lock", async () => {
    app.requestSingleInstanceLock.mockReturnValue(false);

    await load();
    // Past the point where the app is ready
    await new Promise((resolve) => setTimeout(resolve));

    expect(app.quit).toHaveBeenCalledOnce();
    expect(protocol.handle).not.toHaveBeenCalled();
    expect(windows()).toEqual([]);
  });

  it("uses the usual folders otherwise", async () => {
    vi.stubEnv("TOKIO_HOME", "");
    await start();

    expect(app.setPath).not.toHaveBeenCalled();
  });
});
