import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CSP } from "../src/main/config/csp";

// The app runs once for the whole file, in a temporary home folder, and the
// tests follow a user through it in order.
test.describe.configure({ mode: "serial" });

const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const overlayFixture = resolve("test/fixtures/overlay");

let app: ElectronApplication;
let home: string;
let page: Page;

// A window of the app, by the page it loaded
async function windowWith(file: string) {
  const find = () => app.windows().find((w) => w.url().includes(`/${file}`));
  await expect.poll(() => find() !== undefined).toBe(true);
  return find()!;
}

const data = (...path: string[]) => join(home, ".tokio", ...path);

// Set in VS Code's terminal, it would start Electron as plain Node
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    (entry): entry is [string, string] =>
      entry[0] !== "ELECTRON_RUN_AS_NODE" && entry[1] !== undefined,
  ),
);
const args = [
  ".",
  // GitHub's Ubuntu runners don't allow Chromium's sandbox
  ...(process.env.CI && process.platform === "linux" ? ["--no-sandbox"] : []),
  // Chromium's own test camera, so camera elements stream on any machine
  "--use-fake-device-for-media-stream",
];

// English whatever the machine's language, as the tests read the English
const launch = () =>
  electron.launch({
    args,
    env: { ...env, TOKIO_HOME: home, TOKIO_LANG: "en" },
  });

test.beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "tokio-e2e-"));
  app = await launch();
});

test.afterAll(async () => {
  await app?.close().catch(() => {});
  await rm(home, { recursive: true, force: true });
});

test.afterEach(async () => {
  const info = test.info();
  if (info.status !== info.expectedStatus && page && !page.isClosed()) {
    await info.attach("screenshot", {
      body: await page.screenshot(),
      contentType: "image/png",
    });
  }
});

test("shows the splash, then the app, with its data in the home folder", async () => {
  const splash = await windowWith("splash.html");
  await expect(splash.getByText("Starting up...")).toBeVisible();
  await expect(splash.getByText(`v${version}`)).toBeVisible();

  page = await windowWith("index.html");

  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect.poll(() => splash.isClosed()).toBe(true);
  expect(existsSync(data("settings", "tokio.json"))).toBe(true);
  expect(existsSync(data("profiles", "default.json"))).toBe(true);

  // A new store opens the tour, which would cover the window for the tests
  // after this one
  const tour = page.getByRole("dialog", { name: "Welcome to Tokio" });
  await expect(tour).toBeVisible();
  await tour.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("keeps Node out of the page", async () => {
  const globals = await page.evaluate(() => ({
    api: "api" in globalThis,
    electron: "electron" in globalThis,
    require: "require" in globalThis,
    process: "process" in globalThis,
  }));

  expect(globals).toEqual({
    api: true,
    electron: false,
    require: false,
    process: false,
  });
});

test("sets the production CSP on the page loaded from disk", async () => {
  const policy = await page
    .locator('meta[http-equiv="Content-Security-Policy"]')
    .getAttribute("content");
  // An inline script, which the policy refuses. Not eval: what Playwright
  // evaluates goes through DevTools, which skips the policy's eval check.
  const inlineRan = await page.evaluate(() => {
    const script = document.createElement("script");
    script.textContent = "window.inlineRan = true";
    document.head.append(script);
    return "inlineRan" in window;
  });

  expect(policy).toBe(CSP.prod);
  expect(inlineRan).toBe(false);
});

test("opens every page from the sidebar", async () => {
  const pages = [
    ["Overlays", "Overlay gallery"],
    ["TTS", "Voice"],
    ["Alerts", "Alerts"],
    ["Music", "Controls"],
    ["Games", "Actions"],
    ["Tools", "Tools"],
    ["About", "Online services"],
    ["Settings", "Live profiles"],
    ["Home", "Dashboard"],
  ];
  const sidebar = page.getByRole("navigation");

  for (const [link, heading] of pages) {
    await sidebar.getByRole("link", { name: link, exact: true }).click();
    await expect(
      page.getByRole("heading", { name: heading, exact: true }),
    ).toBeVisible();
  }
});

test("creates a profile and saves it", async () => {
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Settings" })
    .click();
  await page.getByTitle("Create a profile").click();
  await page.getByPlaceholder("e.g. Chill Stream").fill("E2E Stream");
  await page.getByRole("button", { name: "Create profile" }).click();

  await expect(page.getByText('Profile "E2E Stream" created.')).toBeVisible();
  const names = await Promise.all(
    (await readdir(data("profiles"))).map(
      async (file) =>
        JSON.parse(await readFile(data("profiles", file), "utf8")).name,
    ),
  );
  expect(names).toContain("E2E Stream");
});

test("imports an overlay and runs its preview from disk", async () => {
  // The folder picker is native, answer it from main
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [folder],
    });
  }, overlayFixture);

  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Overlays" })
    .click();
  await page.getByRole("button", { name: "Import overlay" }).click();
  await expect(page.getByText("Overlay imported.")).toBeVisible();

  const preview = page.locator('iframe[name^="TOKIO_APP-"]');
  const id = (await preview.getAttribute("name"))!.replace("TOKIO_APP-", "");

  // The overlay's module script ran, so local-resource: allowed it
  await expect(
    page.frameLocator('iframe[name^="TOKIO_APP-"]').locator("#status"),
  ).toHaveText(`Ready ${id}`);
});

test("serves the overlay once the server is on", async () => {
  const id = (await page
    .locator('iframe[name^="TOKIO_APP-"]')
    .getAttribute("name"))!.replace("TOKIO_APP-", "");

  // Through IPC: the Settings switch first asks for the administrator to
  // add the overlay address
  await page.evaluate(() =>
    Reflect.get(globalThis, "api").emit("app:settings:set:server", {
      enabled: true,
    }),
  );

  await expect
    .poll(async () => {
      const res = await fetch(`http://127.0.0.1:37891/${id}/`).catch(
        () => null,
      );
      return res?.ok ? await res.text() : "";
    })
    .toContain(`window.__OVERLAY_ID__ = "${id}"`);
});

test("serves a new Overlay Studio overlay", async () => {
  const id = crypto.randomUUID();

  // The server is on since the test above
  await page.evaluate(
    (id) =>
      Reflect.get(globalThis, "api").emit("app:studio:add", {
        id,
        name: "Overlay 1",
      }),
    id,
  );

  await expect
    .poll(async () => {
      const res = await fetch(`http://127.0.0.1:37891/studio/${id}/`).catch(
        () => null,
      );
      return res?.ok ? await res.text() : "";
    })
    .toContain("TokioStage.createStage");
});

// The src main gives the overlay's first camera element, over its socket
function cameraSrc(id: string) {
  return new Promise<string>((done, fail) => {
    const socket = new WebSocket(
      `ws://127.0.0.1:37891/?id=${encodeURIComponent(`studio:${id}`)}`,
    );
    const timeout = setTimeout(() => {
      socket.close();
      fail(new Error("No camera element in the overlay's view"));
    }, 15_000);
    socket.onmessage = (event) => {
      const { type, data } = JSON.parse(String(event.data));
      if (type !== "tokio:studio" || !data.view) return;
      const camera = data.view.layers
        .flatMap((layer: { elements: { kind: string }[] }) => layer.elements)
        .find((e: { kind: string; src?: string }) => e.kind === "camera");
      if (!camera?.src) return;
      clearTimeout(timeout);
      socket.close();
      done(camera.src);
    };
  });
}

// Reads the stream's type, its first message, then its MP4 boxes (a
// big-endian size, then the type) until the first fragment's media came
function firstFragment(url: string) {
  return new Promise<{ type: string; boxes: string[] }>((done, fail) => {
    const socket = new WebSocket(url);
    socket.binaryType = "arraybuffer";
    let type = "";
    const boxes: string[] = [];
    socket.onmessage = ({ data }: MessageEvent<ArrayBuffer | string>) => {
      if (typeof data === "string") {
        type = data;
        return;
      }
      const bytes = Buffer.from(data);
      for (let at = 0; at < bytes.length; at += bytes.readUInt32BE(at)) {
        boxes.push(bytes.toString("latin1", at + 4, at + 8));
      }
      if (!boxes.includes("mdat")) return;
      socket.onclose = null;
      socket.close();
      done({ type, boxes });
    };
    socket.onclose = () =>
      fail(new Error("The stream ended before a fragment"));
  });
}

// The code the server closes a stream with
function closeCode(url: string) {
  return new Promise<number>((done) => {
    new WebSocket(url).onclose = ({ code }) => done(code);
  });
}

test("streams a camera element's frames to its overlay", async () => {
  const id = crypto.randomUUID();
  // A save is refused until main holds the overlay
  await page.evaluate(
    (id) =>
      new Promise<void>((done) => {
        const api = Reflect.get(globalThis, "api");
        const off = api.on(
          "app:studio:res:list",
          (res: { data?: { id: string }[] }) => {
            if (!res.data?.some((o) => o.id === id)) return;
            off();
            done();
          },
        );
        api.emit("app:studio:add", { id, name: "Camera" });
      }),
    id,
  );
  await page.evaluate((id) => {
    Reflect.get(globalThis, "api").emit("app:studio:save", {
      overlay: {
        id,
        name: "Camera",
        size: "landscape",
        rulers: false,
        guides: { x: [], y: [], locked: false },
        items: [
          {
            kind: "camera",
            id: crypto.randomUUID(),
            x: 0,
            y: 0,
            width: 1920,
            height: 1080,
          },
        ],
      },
    });
  }, id);

  const src = await cameraSrc(id);
  // The default camera, behind this run's key
  expect(src).toMatch(
    /^\/studio\/camera\/[^/?]+\?device=&label=&quality=720p$/,
  );

  // Tokio's window captures and encodes Chromium's test camera once a page
  // asks, with whatever encoder the machine has
  const first = await firstFragment(`ws://127.0.0.1:37891${src}`);
  expect(first.type).toMatch(/^video\/mp4; codecs="avc1\.[0-9a-f]{6}"$/);
  expect(first.boxes).toEqual(["ftyp", "moov", "moof", "mdat"]);
  // Another run's key gets nothing
  const wrong = src.replace(/camera\/[^/?]+/, `camera/${crypto.randomUUID()}`);
  expect(await closeCode(`ws://127.0.0.1:37891${wrong}`)).toBe(1008);
});

// Whether each of the app's windows is on screen
const shown = () =>
  app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => w.isVisible()),
  );

const closeButton = () =>
  page.getByRole("banner").first().getByTitle("Close", { exact: true });

test("hides in the tray when the title bar closes it", async () => {
  await closeButton().click();

  // Still running, with its window hidden
  await expect.poll(shown).toEqual([false]);
});

test("leaves a second launch on the same folder to the running app, which shows its window", async () => {
  const exe = await app.evaluate(() => process.execPath);
  const second = spawn(exe, args, {
    env: { ...env, TOKIO_HOME: home },
    stdio: "ignore",
  });

  try {
    await expect.poll(() => second.exitCode, { timeout: 10_000 }).toBe(0);
  } finally {
    second.kill();
  }
  await expect.poll(shown).toEqual([true]);
});

test("quits when the title bar closes it with the tray off, keeping a change made just before", async () => {
  const savedSettings = async () =>
    JSON.parse(await readFile(data("settings", "tokio.json"), "utf8")).settings;
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Settings" })
    .click();
  await page
    .getByRole("checkbox", {
      name: "Keep Tokio running in the tray when you close it",
    })
    .uncheck();
  await expect
    .poll(async () => (await savedSettings()).tray)
    .toEqual({ enabled: false });

  // The TTS settings of the active profile, as saved
  const savedBanned = async () => {
    const file = data("profiles", (await savedSettings()).activeProfile.file);
    return JSON.parse(await readFile(file, "utf8")).tts.protection.banned;
  };
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "TTS", exact: true })
    .click();
  const banned = page.getByPlaceholder("word1, word2, word3...");
  const close = closeButton();
  // Saved as usual first, once the profile has loaded (a change made before
  // is undone by the load)
  await expect(async () => {
    await banned.fill("first");
    expect(await savedBanned()).toEqual(["first"]);
  }).toPass({ timeout: 10_000 });
  await expect(close).toBeVisible();
  const closed = app.waitForEvent("close");

  // Closed before the 300ms autosave
  await banned.fill("second");
  await close.click();
  await closed;

  expect(await savedBanned()).toEqual(["second"]);
});

test("switches the app to the language picked in Settings, and back to the system's", async () => {
  // The test before quit it
  app = await launch();
  page = await windowWith("index.html");
  const savedLanguage = async () =>
    JSON.parse(await readFile(data("settings", "tokio.json"), "utf8")).settings
      .language;
  const sidebar = page.getByRole("navigation");
  await sidebar.getByRole("link", { name: "Settings", exact: true }).click();

  await page.getByRole("combobox", { name: "Language" }).click();
  await page.getByRole("option", { name: "Español" }).click();

  await expect(
    sidebar.getByRole("link", { name: "Configuración", exact: true }),
  ).toBeAttached();
  await expect(sidebar.getByRole("link", { name: "Inicio" })).toBeAttached();
  await expect(
    page.getByRole("heading", { name: "Idioma", exact: true }),
  ).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "es-419");
  await expect.poll(savedLanguage).toBe("es-419");

  await page.getByRole("combobox", { name: "Idioma" }).click();
  await page.getByRole("option", { name: "Idioma del sistema" }).click();

  await expect(
    sidebar.getByRole("link", { name: "Settings", exact: true }),
  ).toBeAttached();
  await expect(
    page.getByRole("heading", { name: "Language", exact: true }),
  ).toBeVisible();
  await expect.poll(savedLanguage).toBe("system");
});
