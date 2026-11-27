---
name: drive-app
description: "Launch the built Tokio app with Playwright to see a change working, take screenshots, or show LIVE-only UI without a LIVE. Use to check UI or startup changes in the real app, beyond what the tests cover."
argument-hint: "[what to check]"
---

# Drive the app

`scripts/drive.mjs` starts the built app the way `e2e/app.spec.ts` does and runs a steps file against it. The app's data goes to a new temporary folder (`TOKIO_HOME`), deleted afterwards, so `~/.tokio` is never touched. The script copies `~/.tokio/extra/gifts.json` into it so the gift pickers have TikTok's list.

1. Build after changing app code: `yarn build:music:ui && npx electron-vite build`. With `--mode live`, Connect connects to made-up LIVEs (`yarn dev:live`'s): build again without it when done.
2. Write a steps file outside the repo (in the scratchpad when there is one):

   ```js
   export default async ({ app, page, home, push, toggle, windowWith }) => {
     await page.getByRole("heading", { name: "Dashboard" }).waitFor();
     // A new data folder opens the first-start dialog, then the tour
     const dialog = page.getByRole("dialog");
     for (let i = 0; i < 3 && (await dialog.first().isVisible()); i++) {
       await page.keyboard.press("Escape");
       await page.waitForTimeout(300);
     }
     await page.screenshot({ path: "<scratchpad>/home.png" });
   };
   ```

   Escape skips the first-start dialog and closes the tour. Fill the dialog instead to start from a set-up profile, or leave them open to check them.

3. Run it from the repository root: `node .claude/skills/drive-app/scripts/drive.mjs <steps.mjs>`.
   - `--home <dir>` uses that data folder and keeps it, to look at what the app saved or start the next run from there. One Tokio runs per data folder, so a second run on the same `--home` quits at once.
   - `--exe <app>` starts a packaged build from `yarn build:unpack`: `dist/win-unpacked/tokio.exe`, or `dist/linux-unpacked/tokio`.
   - `--scale 2` renders at twice the device scale, for sharp screenshots.
   - `--lang <tag>` runs as if the system's language were that one (`TOKIO_LANG`, `en` by default), unless the data folder saved another.
   - `--fake-camera` makes Chromium's test camera the only camera, for Overlay Studio's camera elements.
4. It refuses to start while port 37891 is in use. Ask the user to quit Tokio or stop `yarn dev`; don't stop them yourself.
5. Look at the screenshots and the output: renderer errors print as `[page]` and `[console]` lines, and a step that throws exits with 1.

`scripts/screenshots.mjs` is a steps file that retakes the README's screenshots into `.github/screenshots/` (the whole window, 1200×800) and the website docs' into `../tokio-web/src/assets/screenshots/` (crops of what each docs section describes), with made-up viewers: `node .claude/skills/drive-app/scripts/drive.mjs --scale 2 --fake-camera .claude/skills/drive-app/scripts/screenshots.mjs`. It needs the network for the official overlays, `--fake-camera` for Overlay Studio's camera, which it waits for, and Microsoft Edge for the phone remote's page (Playwright's `msedge` channel, as a phone shows it). A docs crop is named after its file, which the docs reference; a new one needs a line in the docs page that shows it.

The website is in English and Spanish, so retake both:

- Add `--lang es-419` to the same command for the Spanish crops. They go to `../tokio-web/src/assets/screenshots/es/`, and the README stays English.
- Every UI text the script looks for goes through `tr()`: the text is found in `en.json`, and its key is read in the run's language. A text with `{params}`, or one whose keys translate differently, passes its key.
- What a streamer or viewer typed goes through `say()`, with its Spanish in `TYPED`. A new typed text that a picture shows needs a line there. The Spanish docs' alt texts name what the Spanish pictures show.

A run rewrites every picture, and most differ only by chance (made-up IDs, dates counted from today, sample photos, animation frames, a blinking caret). Keep only the changes you meant and `git checkout` the rest.

## Helpers

- `page` is the main window. `windowWith("splash.html")` finds a window by the page it loaded.
- `push(channel, data)` sends what main would push, on an `APP_EVENTS_RESPONSE` channel (`src/common/types/events/res.ts`). It shows LIVE-only UI without a LIVE:

  ```js
  // Without live: true, Home shows a connect still in progress
  await push("app:home:res:connect", {
    success: true,
    live: true,
    platforms: { tiktok: "connected" },
    stats: {
      views: 1200,
      viewers: 85,
      likes: 3400,
      platformViewers: { tiktok: 85 },
    },
  });
  await push("app:home:res:session", { data: session }); // a LiveSession, src/common/types/live.ts
  ```

  A `void` response still takes `undefined`.

- `toggle(locator)` clicks a `Toggle`. Its input has no size, so Playwright's `check()` fails even with `force`.
- `app.evaluate` runs code in main, which is how the e2e answers native dialogs: `app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, folder)`.
- `home` is the data folder; the app's files are in `<home>/.tokio/`.

## Notes

- `RECIPES.md` has the checks that need more than clicks: fake live events in main, counting what main sends, test media, minimized windows and overlays, watching an overlay page among them.
- Query by role and visible text, as the tests do (`.claude/rules/testing.md`).
- A real connector check needs a username that's LIVE right now: ask the user for one.

## Done when

You've looked at the screenshots or the output, and told the user what the app showed.
