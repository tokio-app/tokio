---
name: drive-app
description: "Launch the built Tokio app with Playwright to see a change working, take screenshots, or show LIVE-only UI without a LIVE. Use to check UI or startup changes in the real app, beyond what the tests cover."
argument-hint: "[what to check]"
---

# Drive the app

`scripts/drive.mjs` starts the built app the way `e2e/app.spec.ts` does and runs a steps file against it. The app's data goes to a new temporary folder (`TOKIO_HOME`), deleted afterwards, so `~/.tokio` is never touched. The script copies `~/.tokio/extra/gifts.json` into it so the gift pickers have TikTok's list.

1. Build after changing app code: `yarn build:music:ui && npx electron-vite build`.
2. Write a steps file outside the repo (in the scratchpad when there is one):

   ```js
   export default async ({ app, page, home, push, toggle, windowWith }) => {
     await page.getByRole("heading", { name: "Dashboard" }).waitFor();
     await page.screenshot({ path: "<scratchpad>/home.png" });
   };
   ```

3. Run it from the repository root: `node .claude/skills/drive-app/scripts/drive.mjs <steps.mjs>`. With `--home <dir>` it uses that data folder and keeps it, to look at what the app saved or to start the next run from there. One Tokio runs per data folder, so runs on the same `--home` go one after the other: a second one quits at once. With `--exe <app>` it starts a packaged build instead, made with `yarn build:unpack`: `dist/win-unpacked/tokio.exe`, or `dist/linux-unpacked/tokio` on Linux. With `--scale 2` it renders at twice the device scale, for sharp screenshots on any display.
4. It refuses to start while port 37891 is in use. Ask the user to quit Tokio or stop `yarn dev`; don't stop them yourself.
5. Look at the screenshots, and at what the script printed: renderer errors come out as `[page]` and `[console]` lines, and it exits with 1 when a step throws.

`scripts/screenshots.mjs` is a steps file that retakes the README's screenshots into `.github/screenshots/` (the whole window, 1200×800) and the website docs' into `../tokio-web/src/assets/screenshots/` (crops of what each docs section describes), with made-up viewers: `node .claude/skills/drive-app/scripts/drive.mjs --scale 2 .claude/skills/drive-app/scripts/screenshots.mjs`. It needs the network for the official overlays. A docs crop is named after its file, which the docs reference; a new one needs a line in the docs page that shows it.

## Helpers

- `page` is the main window. `windowWith("splash.html")` finds a window by the page it loaded.
- `push(channel, data)` sends what main would push, on an `APP_EVENTS_RESPONSE` channel (`src/common/types/events/res.ts`). It shows LIVE-only UI without a LIVE:

  ```js
  await push("app:home:res:connect", {
    success: true,
    stats: { views: 1200, viewers: 85, likes: 3400 },
  });
  await push("app:home:res:session", { data: session }); // a LiveSession, src/common/types/live.ts
  ```

  A `void` response still takes `undefined`.

- `toggle(locator)` clicks a `Toggle`. Its input has no size, so Playwright's `check()` fails even with `force`.
- `app.evaluate` runs code in main, which is how the e2e answers native dialogs: `app.evaluate(({ dialog }, folder) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] }); }, folder)`.
- `home` is the data folder. The app's files are in `<home>/.tokio/` (`settings/tokio.json`, `profiles/`, `extra/`).

## Notes

- `RECIPES.md` has the checks that need more than clicks: fake live events in main, counting what main sends, test media, minimized windows and overlay pages.
- Query by role and visible text, as the tests do (`.claude/rules/testing.md`).
- To watch an overlay page (an alert's `/alerts/<id>/`, the timer's), turn the server on first: `toggle` **Enable Server** in Settings, then click the confirm dialog's **Enable Server**. Open the page in `app.evaluate` with `new BrowserWindow({ webPreferences: { partition: "obs", backgroundThrottling: false } })`: the app's own session cancels WebSockets, so the page couldn't connect there. Then find it with `windowWith("alerts/")`.
- A real connector check needs a username that's LIVE right now: ask the user for one.

## Done when

You've looked at the screenshots or the output, and told the user what the app showed.
