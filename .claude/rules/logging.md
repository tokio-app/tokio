---
paths:
  - "src/main/logger/**"
  - "src/main/helper/feedback.ts"
  - "src/main/helper/network.ts"
  - "src/main/services/path/**"
  - "src/renderer/src/pages/Settings/sections/LogsSection.tsx"
---

# Logs

- Each area writes its own file in `logs/` (`Files.logs`). Lines read the way VS Code and electron-log write theirs: local time, a lowercase level, the message (`2026-11-11 12:56:39.655 [error] <Music> …`). The levels are error, warn, info and debug (the user's call).
- Log only what's needed (the user's call): failures, and the few changes that frame them, like the run header, a LIVE connecting, the hosts file changing, an update installing, or a store or LIVE recovered. Routine traffic goes to `Logger.debug`: overlays connecting, update checks, Minecraft's statuses, the server starting and stopping.
- `report()` logs a warning only with a `cause`. One without is what the user did, which the page shows, or what a service already logged. An `AppFailure` at error level logs one line, since `formatError` carries the cause chain; anything else thrown keeps its stack.
- `startApp` writes a run header to every file (`Logger.run`): Tokio's version, installed or dev, the OS, Electron, the language and the time zone. `yarn dev` and the installed app share the folder, and the times are local.
- A log over 5 MB moves to `<name>.old.log` before its next line, inside the file's write chain, so each area keeps two files at most. The header is each run's first write, which is what moves a big log left from the last run at startup.
- **Settings → Logs → Detailed logs** (`settings.logs.debug`, off by default) turns the `debug` lines on, at startup and on `SET_LOGS`. Turning it on asks first (the user's call). It adds the connector library's own lines and one per LIVE event (`ConnectorProvider.emit`): the sender's handle and a gift's name and count, never a chat's text, and nothing for Room Users.
- `logPageErrors` logs the error-level console messages of Tokio's own pages, the main window and the music window's title bar, from the top frame only: overlay previews are iframes, and the players are YouTube's and Spotify's sites. Each line repeats at most every 30 s. React 19 reports caught errors with `console.error` in production too, so the router's error page lands there.
- **Export** (`EXPORT_LOGS`) zips every log and backup (`Logger.zip`, after the writes still running) into a file the user picks. It's the app's only way to the logs (the user's call: no open-folder button).
