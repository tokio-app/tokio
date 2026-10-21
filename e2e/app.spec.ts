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
];

test.beforeAll(async () => {
  home = await mkdtemp(join(tmpdir(), "tokio-e2e-"));
  app = await electron.launch({ args, env: { ...env, TOKIO_HOME: home } });
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
  const evalBlocked = await page.evaluate(() => {
    try {
      // oxlint-disable-next-line no-eval -- the CSP must block it
      eval("1");
      return false;
    } catch {
      return true;
    }
  });

  expect(policy).toBe(CSP.prod);
  expect(evalBlocked).toBe(true);
});

test("opens every page from the sidebar", async () => {
  const pages = [
    ["Overlays", "Overlay Gallery"],
    ["TTS", "Voice"],
    ["Alerts", "Alerts"],
    ["Music", "Controls"],
    ["Tools", "Test Overlays"],
    ["About", "Online services"],
    ["Settings", "Live Profiles"],
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
  await page.getByTitle("Create New Profile").click();
  await page.getByPlaceholder("e.g. Chill Stream").fill("E2E Stream");
  await page.getByRole("button", { name: "Create Profile" }).click();

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
    .getByRole("link", { name: "Settings" })
    .click();
  await page
    .locator("section", {
      has: page.getByRole("heading", { name: "Imported Overlays" }),
    })
    .getByRole("button", { name: "Import" })
    .click();
  await expect(page.getByText("Overlay imported.")).toBeVisible();

  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Overlays" })
    .click();
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

test("leaves a second launch on the same folder to the running app", async () => {
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
});

test("quits when the title bar closes it", async () => {
  const closed = app.waitForEvent("close");

  await page
    .getByRole("banner")
    .first()
    .getByTitle("Close", { exact: true })
    .click();

  await closed;
});
