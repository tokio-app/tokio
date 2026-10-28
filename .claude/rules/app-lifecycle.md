---
paths:
  - "src/main/index.ts"
  - "src/main/handler/**"
  - "src/main/services/tray/**"
  - "src/main/helper/quit.ts"
  - "src/main/helper/network.ts"
  - "src/renderer/src/pages/Settings/sections/TraySection.tsx"
---

# App lifecycle

## One instance

- Only one Tokio runs per userData folder: `requestSingleInstanceLock` in `src/main/index.ts`, after `TOKIO_HOME` sets it.
- A second launch quits and brings the running one to the front, out of the tray too.
- `yarn dev` and the installed app share that folder on Windows and macOS, so quit Tokio before `yarn dev`.

## Tray and closing

- While **Settings → Tray** is on (the default, `settings.tray`), closing the main window only hides it.
- `TrayService` shows the icon once `LOAD_APP` has run and on `SET_TRAY`. Its menu is built again in the new language when it changes (`onLanguage`). `AppHandler` (`src/main/handler/app.ts`) hides the window on `close` until a quit.
- On Linux, the first time each run that closing hides it, a system notification says Tokio is still running, and clicking it shows the window: desktops without a tray host (vanilla GNOME) show no icon.

## Quitting

- Every quit (the tray's menu, Cmd+Q, an update, Playwright's `close()`) goes through `app.quit()`, whose `before-quit` lets the window close.
- Quitting waits up to 3s for work still running (`track`/`settle`, `src/main/helper/quit.ts`). `Handler` tracks every handler run, and `writeFileAtomic` (`src/main/helper/fs.ts`), `updateFile`, the store's save queue and `Logger` track their writes.
- The first `will-quit` with work pending is held (`src/main/index.ts`), and the app quits again once it settles. `before-quit` isn't used for this because on Cmd+Q it comes before the windows send their last saves on `pagehide`.
- An update settles before it installs (see `.claude/rules/updates.md`).

## Windows

- The main window plays every sound, so it has `backgroundThrottling: false` like the music windows: Chromium never treats it as a background page, minimized or in the tray.
- A page whose renderer process dies for any reason but a clean exit is reloaded (`reloadWhenGone`, `src/main/helper/network.ts`): the main window's and the music windows' views.
- Playwright keeps pages visible, so it can't show how a hidden window behaves (see `.claude/rules/testing.md`).
