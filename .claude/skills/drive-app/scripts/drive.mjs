// Launches the built app for a one-off check, the way e2e/app.spec.ts does,
// and runs a steps file against it. See ../SKILL.md.
//
//   node .claude/skills/drive-app/scripts/drive.mjs <steps.mjs> [--home <dir>] [--exe <app>]
//
// With --exe it starts a packaged build instead (yarn build:unpack), such as
// dist/win-unpacked/tokio.exe.
import { _electron as electron } from "@playwright/test";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
} from "node:fs";
import { connect } from "node:net";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

const PORT = 37891;
const repo = resolve(import.meta.dirname, "../../../..");

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: { home: { type: "string" }, exe: { type: "string" } },
});
if (positionals.length !== 1) {
  console.error(
    "Usage: node .claude/skills/drive-app/scripts/drive.mjs <steps.mjs> [--home <dir>] [--exe <app>]",
  );
  process.exit(2);
}

const { default: steps } = await import(
  pathToFileURL(resolve(positionals[0])).href
);
if (typeof steps !== "function") {
  console.error(`${positionals[0]} must export a default function.`);
  process.exit(2);
}

const exe = values.exe && resolve(values.exe);
if (!existsSync(exe || join(repo, "out", "main", "index.js"))) {
  console.error(
    exe
      ? `No app at ${exe}: package it first with yarn build:unpack`
      : "Build the app first: yarn build:music:ui && npx electron-vite build",
  );
  process.exit(1);
}

// With another Tokio on the port, LOAD_APP turns the saved server setting off
const portTaken = await new Promise((done) => {
  const socket = connect(PORT, "127.0.0.1")
    .once("connect", () => {
      socket.destroy();
      done(true);
    })
    .once("error", () => done(false));
});
if (portTaken) {
  console.error(
    `Port ${PORT} is in use (by Tokio or yarn dev): close it and try again.`,
  );
  process.exit(1);
}

// A new data folder unless one is given, so ~/.tokio is never touched
const home = values.home
  ? resolve(values.home)
  : mkdtempSync(join(tmpdir(), "tokio-drive-"));

// Without a saved gift list, startup waits for TikTok's and the gift pickers
// stay empty offline, so copy the one saved in ~/.tokio
const savedGifts = join(homedir(), ".tokio", "extra", "gifts.json");
const gifts = join(home, ".tokio", "extra", "gifts.json");
if (existsSync(savedGifts) && !existsSync(gifts)) {
  mkdirSync(join(home, ".tokio", "extra"), { recursive: true });
  copyFileSync(savedGifts, gifts);
}

// Set in VS Code's terminal, it would start Electron as plain Node
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key, value]) => key !== "ELECTRON_RUN_AS_NODE" && value !== undefined,
  ),
);

let app;
let failed = false;
try {
  app = await electron.launch({
    ...(exe ? { executablePath: exe } : { args: ["."], cwd: repo }),
    env: { ...env, TOKIO_HOME: home },
  });

  const report = (window) => {
    window.on("pageerror", (error) => console.error(`[page] ${error.message}`));
    window.on("console", (message) => {
      if (message.type() === "error") {
        console.error(`[console] ${message.text()}`);
      }
    });
  };
  app.windows().forEach(report);
  app.on("window", report);

  // A window of the app, by the page it loaded (index.html, splash.html)
  const windowWith = async (file, timeout = 30_000) => {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      const found = app.windows().find((w) => w.url().includes(`/${file}`));
      if (found) return found;
      await new Promise((wait) => setTimeout(wait, 200));
    }
    throw new Error(`No window loaded ${file} in ${timeout / 1000}s.`);
  };

  // Sends what main would push to the main window, on an APP_EVENTS_RESPONSE
  // channel such as "app:home:res:connect"
  const push = (channel, data) =>
    app.evaluate(
      ({ BrowserWindow }, [ch, payload]) =>
        BrowserWindow.getAllWindows()
          .find((w) => w.webContents.getURL().includes("index.html"))
          ?.webContents.send(ch, payload),
      [channel, data],
    );

  // Toggle inputs have no size, so Playwright's check() can't click them
  const toggle = (locator) => locator.evaluate((el) => el.click());

  const page = await windowWith("index.html");
  await steps({ app, page, home, push, toggle, windowWith });
} catch (error) {
  failed = true;
  console.error(error);
} finally {
  await app?.close().catch(() => {});
  if (values.home) {
    console.log(`The app's data is in ${home}`);
  } else {
    rmSync(home, { recursive: true, force: true, maxRetries: 5 });
  }
}
process.exit(failed ? 1 : 0);
