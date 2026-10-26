# AGENTS.md

## Project

Tokio is an Electron desktop app for Windows, macOS and Linux that connects to a TikTok LIVE stream and reacts to its events with text-to-speech, music requests (Spotify/YouTube), alerts (sounds, images and videos), game actions (Minecraft commands), and browser-source overlays served over a local HTTP/WebSocket server.

Stack: Electron 45, electron-vite, React 19, TypeScript, TanStack Router, Express 5 + `ws`, Zod 4, Yarn 1, Node >= 24.

## Commands

```sh
yarn dev                  # build the music window UI, then electron-vite dev (quit Tokio first)
yarn test                 # vitest (yarn test:watch to watch, --project main|renderer for one)
yarn test:coverage        # vitest with a coverage report in coverage/
yarn test:e2e             # build the app and drive it with Playwright (needs port 37891: quit Tokio first)
yarn typecheck            # tsc for node (main/preload/common) and web (renderer/music)
yarn lint                 # oxlint --type-aware, fails on any warning
yarn format               # prettier --write .
yarn build                # typecheck + music UI + electron-vite build
yarn build:win            # build + package (also build:mac, build:linux)
yarn tts:edge:check       # live check of the Edge TTS provider (needs network)
yarn release:notes [tag]  # print a release's notes (the next release's without a tag)
```

Verify changes with `yarn test`, `yarn typecheck` and `yarn lint`. For the Edge TTS provider, also run `yarn tts:edge:check`, and for window setup, the preload or startup, `yarn test:e2e`.

### Linux checks from Windows (WSL)

The maintainer's Windows machine keeps a Linux copy of the repo in WSL (Ubuntu 24.04) at `~/tokio-wsl`, cloned from the Windows checkout, with Node 24 in `~/.local/node24/bin`. Run the tests there when a change can behave differently on Linux or macOS: file links, paths, case-sensitive names, permissions. It only sees committed code:

```sh
wsl.exe -e bash -lc 'cd ~/tokio-wsl && export PATH=$HOME/.local/node24/bin:$PATH &&
  git fetch -q origin && git checkout -q -B <branch> origin/<branch> && npx vitest run'
```

After `yarn.lock` changes, reinstall there first with `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npx yarn@1.22.22 install --frozen-lockfile --ignore-scripts`. Electron isn't installed, so `yarn dev` and `yarn test:e2e` don't run there.

## Agent models

- **Planning:** Opus 5.5 at high effort. Be 90–95% confident in the plan before implementing or handing off; otherwise keep reading code or ask the user.
- **Implementation subagents:** Sonnet 5.5 at high effort for well-scoped changes that follow existing patterns. Otherwise Opus 5.5: medium effort for moderate tasks, high for complex or cross-cutting ones (architecture, IPC/schema changes across processes, concurrency, licensing-sensitive code).

## Layout

- `src/main/`: Electron main process (services, IPC event handlers, window setup)
- `src/preload/`: exposes the typed `window.api.emit` / `window.api.on` bridge. The windows are sandboxed, so it builds as CommonJS (`out/preload/index.cjs`) and can load only `electron` at runtime; anything else it imports must be bundled, like `src/common`.
- `src/renderer/`: main React UI (pages, components, contexts, router)
- `src/music/`: separate music window UI, built as a single file into `music-out/`
- `src/common/`: shared by both processes (Zod schemas, event types, constants, utils). It must not import from `src/main` or `src/renderer`, and must stay free of Node/Electron-only APIs if the renderer uses it.
- `src/ui/`: web-only code shared by the main and music windows (design tokens, base CSS, `TitleBar`)
- `test/`: Vitest setup, fakes, helpers and fixtures; `e2e/`: Playwright tests of the built app
- `scripts/`: repo maintenance scripts (`edge-tts`, `release-notes`); `yarn clean` and `yarn todos` are one-liners in `package.json`
- `LICENSES/`, `THIRD_PARTY_NOTICES.md`: third-party license texts and notices, shipped to the app's `resources/licenses`
- `build/`: the app icons electron-builder uses

Generated, don't edit: `out/`, `music-out/`, `dist/`. The packaged app holds only `out/`, `music-out/`, `resources/` and the production dependencies (`files` in `electron-builder.yml`), so a file the app reads at runtime must live in one of them. Dependencies only the windows import are bundled by Vite, so they ship only their `package.json` and license files (for About), through the `!node_modules/{…}` pattern in `files`; take one out of it if main or the preload starts importing it. `src/main/packaging.test.ts` fails when code in `src/main` or `src/common` reaches one, directly or through a dependency. A file main imports from one with a query, like the countdown timer's font (`?inline`), is bundled into `out/main` instead, once the package is in main's `externalizeDeps.exclude` (`electron.vite.config.ts`); the test skips those imports.

## Path aliases

- Main process: `@/*` → `src/main/*`, `@/common/*` → `src/common/*`
- Renderer: `@/*` (preferred) and `@renderer/*` → `src/renderer/src/*`, plus `@/common/*` and `@/ui/*` → `src/ui/*`
- Music window: `@/common/*` and `@/ui/*` only.
- Tests: their process's aliases, plus `@test/*` → `test/main/*` or `test/renderer/*`.

## Topic rules

Notes that only matter in one area live in `.claude/rules/`. Claude Code loads each one when it reads or edits a file its `paths` match; read one directly when planning across areas.

**Other agents:** these rules don't load on their own. Before you read or edit files that a rule's `paths` (at the top of the file) match, read that rule.

- `testing.md`: Vitest and Playwright setup, fakes and helpers
- `renderer.md`: pages, components, styling, keyboard, hooks and audio queues
- `tts.md`: TTS engines and their providers
- `alerts.md`: alert triggers, gifts, sounds and spoken alerts
- `games.md`: the Games page, the Minecraft connection and game actions
- `live-session.md`: the LIVE session and activity feed on Home
- `overlays.md`: overlay previews and official overlays
- `updates.md`: the auto-updater
- `timer.md`: the countdown timer, its overlay and the Tools page

When a change alters what a rule says, update the rule with it. A new area gets its own rule with `paths`.

## Skills

Procedures live in `.claude/skills/<name>/SKILL.md`. Claude Code offers each one as `/<name>` and loads it when a task matches its description.

**Other agents:** before doing one of these tasks, read its `SKILL.md`.

- `release`: publish a version, only when the user asks
- `verify`: run the checks a change needs
- `sync-docs`: update the docs and the other repos a change affects
- `drive-app`: launch the built app to check a change or take screenshots
- `add-dependency`: add, upgrade or remove a package, with the license checks
- `live-event`: add or change a TikTok LIVE event end to end
- `ipc-event`: add an IPC request, reply or push, with its tests
- `new-page`: add a page to the main window
- `frontend-design`: the visual direction for new or reshaped UI (Anthropic's skill, Apache-2.0, vendored as published)

When a procedure changes, update its skill with it.

## Architecture

### Services (main process)

- Each service lives in `src/main/services/<name>/index.ts` and extends `Service` (or `ProviderService<T>`) from `src/main/services/shared`. It's instantiated once in `src/main/index.ts`, added to `AppServices` in `src/main/types`, and injected into `AppHandler` (`src/main/handler/app.ts`).
- Swappable backends (connector, TTS, music) use providers: `addProvider(name, provider, start?)` / `setProvider(name, key?)` (without a key the provider keeps its own; `""` clears it). Providers live in `services/<name>/providers/<provider>/` with `common/` and `config/` subfolders. TTS uses every provider at once, as engines (see `.claude/rules/tts.md`). The connector's provider key is the user's own Euler Stream API key, which signs the connection (`SET_PROVIDER`). Settings → TikTok LIVE always shows it; its provider picker only shows while more than one connector is registered. Never log the key or ship a shared one. Each service starts a provider in its constructor, so `_current` is always set.
- The default connector uses `@tokioapp/connector` (our MIT package, `../tokio-connector`), one `TikTokLiveConnection` per connect, with every listener added before `connect()`; a connect that comes while one is connecting gets that one, so only one connection opens. `isConnected()` is true from the start of a connect, so the profile can't be switched mid-connect, and `CONNECTED` comes only for a connect that worked. It reconnects on its own: a drop it recovers from calls `onReconnect` and keeps the LIVE session, and `DISCONNECTED` only comes once the connection stops (`reason: "ended"`, `"lost"`, or none when the user disconnected). A failed connect's `error.kind` picks the message `home.ts` shows. The library's warnings and errors go to `connector.log` through its `logger` option, with the error they carry; its info and debug lines are dropped.
- `GamesService` (`services/games`) runs the profile's game actions on every live event, each in the connected game when it's the action's edition (Bedrock or Java). `MinecraftConnection` listens on `MINECRAFT_PORT` while the Games page's toggle is on: Bedrock joins with `/connect`, Java through the Tokio mod with `/tokio connect`; one game at a time. It has its own log (`games.log`) and feedback source (`games`). Each action can show on Minecraft's overlay (`/games/minecraft/`, split in up to 4 columns), with pictures from the Minecraft library in `~/.tokio/games/minecraft`. See `.claude/rules/games.md`.
- Classes that send live events to listeners (`MusicProvider` in `services/music/common`, `MusicQueue`, `ConnectorProvider`) extend `TokioEmitter` (`services/shared/emitter`): a typed `on`/`off` and a protected `emit`. `createWindow(view)` places a provider's page under the music window's title bar.
- Log through `Logger` (`@/logger`) with the service's `_logFile` and a `<ServiceName>` prefix, e.g. ``Logger.error(`<Connector> ...`, this._logFile)``. Format errors with `formatError` from `@/common/util`.
- Fallible service methods return `{ success, error?, data? }` instead of throwing.

### IPC events

All renderer ↔ main communication is typed. To add an event:

1. Add the request to `APP_EVENTS` and `AppEventsMap` in `src/common/types/events/req.ts`. Names follow `app:<area>:<action>`.
2. If it replies, add the response to `APP_EVENTS_RESPONSE` and `AppEventsResponseMap` in `src/common/types/events/res.ts`.
3. Register the handler in `src/main/events/pages/<page>.ts` with `events.push(APP_EVENTS.X, async (services, e, data) => { ... e.reply(...) }, options)`. Don't wrap it in try/catch; throw and let `options` handle it (see Feedback). A new page stack must be added to `mergeStacks` in `src/main/events/index.ts`.
4. In the renderer, send with `window.api.emit` and listen with the `useIpcRequest` / `useIpcListener` hooks.

To push from main without a request, use `win.webContents.send(APP_EVENTS_RESPONSE.Y, data)`; a `void` response still needs `undefined` as payload.

Handlers open file dialogs with `showOpenDialog` / `showSaveDialog` from `@/helper/dialog`, which start in the last folder used. Electron's own start in Downloads.

A request about one item (an overlay, a document, a test) gets its id back in the reply, failures included, so the renderer ignores a late reply for another one (see `GET_OVERLAY_CONFIG`).

Live stream events (`TOKIO_EVENTS` / `TokioEventMap`) come from the connector. `ServerService` forwards them to overlays over WebSocket, and they drive TTS, music requests, alerts and game actions. A new live event needs a label in `ALERT_TRIGGER_LABELS` (`src/common/types/connector.ts`) or typecheck fails; a new internal event goes in the `exclude` list of `AlertTriggerSchema` (`src/common/schemas/profile.ts`).

### Feedback

Main tells the renderer what failed so it can show notifications. Types are in `src/common/types/feedback.ts`, helpers in `src/main/helper/feedback.ts` and `src/main/helper/events.ts`.

- Replies use `Reply<{ ... }>`, which adds `error?: AppError` (`{ code: FEEDBACK_CODES, message }`). The message is plain English for the user; details go only to the logs.
- `createStack(source)` sets the `FeedbackSource` (and log file) of a page's handlers.
- `push` options: `failure` (the `AppError` for unexpected throws), `onError(e, error, data, services)` to send the failure reply (`replyFailure(APP_EVENTS_RESPONSE.X)` for a plain `{ success: false, error }`), `notify: false` when the page already shows the failure or for status probes, and `source` to override the stack's.
- Throw `new AppFailure(code, message, { level: "warning", cause })` for an expected failure with its own message or level. A canceled dialog is not a failure: just `return`.
- Log failures once. If a service already logged it, throw `new LoggedError(res.error)` or pass `{ logged: true }` to `AppFailure`.
- A store mutator that returns false couldn't write the store file, and `JSONManagerService` logged why: send the reply that shows what main holds, then throw `saveFailure()` (`SETTINGS_SAVE_FAILED`), with no success notice.
- `notifier` (in the handler's services) pushes `APP_EVENTS_RESPONSE.NOTIFY`: `notifier.report({ source, error, fallback })` logs and notifies; `notifier.error/warn/info/success(source, code, message, { key, windowMs })` sends a notice. Repeated warnings and errors are dropped within `windowMs` (5s default); use a longer window for failures that can repeat on every live event.
- User actions that change something call `notifier.success(...)` after the reply, where the handler succeeds. Reads, status checks, tests, autosaves (TTS, music, alerts, the keys in Settings) and controls whose state the UI already shows (Home's feature switches) send nothing. Success codes are past tense (`PROFILE_CREATED`); failures end in `_FAILED`.
- Background failures (TTS, music playback, missing alert sounds, gifts, server port, reconnects, LIVE ending) are reported from `src/main/events/init.ts` through service callbacks. Services don't know about the notifier.
- The renderer shows notices via `NotificationsProvider` (mounted above `AppProvider`, since load-time notices arrive before the splash closes): `Toasts` and the title bar's `NotificationBell`. Pages don't show notices themselves.

### Persistence

Settings and profiles are validated with the Zod schemas in `src/common/schemas` and persisted by `StoreManagerService`. When you change a schema, update its defaults in `src/common/util/constants`. Give every new saved field a `.default(...)` so older files still load. Store mutators return whether the store file was written. `createNewProfile`, `cloneProfile` and `importProfile` return `"unsaved"` when only the store save failed, after deleting the profile file they wrote, and `null` for other failures. A profile switch that can't be saved keeps the old profile, and `updateProfileData` throws until the store has loaded. It writes the active profile unless given a file: a service that keeps a profile's data in memory, like the countdown timer, passes the file it loaded from. Provider keys (the Euler key, voice engine keys) are saved encrypted with `safeStorage`'s async calls. The store decrypts them once at startup and reads them from memory, so `getSettings` stays synchronous.

`getProfileData` keeps the active profile in memory. When its file fails to load, live events try it again at most every 30s (`LOAD_RETRY_MS`), so a broken file isn't read on every event. GET_PROFILE and the sweeps that remove a sound, media file or picture from every profile (`removeFromAlerts`, `removeFromGames`, through `_updateProfiles`) pass `{ fresh: true }`: they wait for the active profile's update still writing and retry a failed file at once.

Profile files are named by `StoreManagerService.profileFileFor`: the name in safe characters, numbered when the file is taken. The store never writes over a profile's file: creating or cloning a profile under a name another one has is refused (`PROFILE_EXISTS`), and an import gets a free file name. An import is listed under the name saved in it, trimmed, and numbered ("Name 2") when another profile has that name in any case. One whose trimmed name is too short is listed as "Imported profile".

Quitting waits up to 3s for IPC handlers and file writes still running (`track`/`settle`, `src/main/helper/quit.ts`): `Handler` tracks every handler run, and `writeFileAtomic` (`src/main/helper/fs.ts`), `updateFile`, the store's save queue and `Logger` track their writes. The first `will-quit` with work pending is held; `before-quit` isn't used because on Cmd+Q it comes before the windows send their last saves on `pagehide`. Write files through `writeFileAtomic` or the file managers, so a quit waits for them and a quit or crash midway leaves the old file whole. `writeFileAtomic` flushes the temp file to disk before the rename, so a power cut can't leave a file of NULs.

The store file is read once at startup. One that doesn't parse or validate is backed up from the bytes read to `tokio.corrupted-<time>.json` next to it and replaced by the defaults. One that can't be read (locked, no access) or backed up stops startup ("Tokio couldn't start") and is left as it is. A rebuilt store keeps a valid `default.json`; an invalid one is backed up as `default.corrupted-<time>.json` before it's replaced, and one that can't be read stops startup too.

Only one Tokio runs per userData folder (`requestSingleInstanceLock` in `src/main/index.ts`, after `TOKIO_HOME` sets it): a second launch quits and brings the running one to the front, out of the tray too. `yarn dev` and the installed app share that folder on Windows and macOS, so quit Tokio before `yarn dev`.

While **Settings → Tray** is on (the default, `settings.tray`), closing the main window only hides it: `TrayService` shows the icon once `LOAD_APP` has run and on `SET_TRAY`, and `AppHandler` (`src/main/handler/app.ts`) hides the window on `close` until a quit. On Linux, the first time each run that closing hides it, a system notification says Tokio is still running, and clicking it shows the window: desktops without a tray host (vanilla GNOME) show no icon. Every quit (the tray's menu, Cmd+Q, an update, Playwright's `close()`) goes through `app.quit()`, whose `before-quit` lets the window close. The main window plays every sound, so it has `backgroundThrottling: false` like the music windows: Chromium never treats it as a background page, minimized or in the tray. Playwright's focus emulation keeps pages visible, so `drive-app` and `e2e/` can't show how a hidden page behaves.

## Licensing

Tokio's source is MIT; treat license compliance as part of every change.

- **LGPL code stays isolated.** `src/main/services/tts/providers/edge/common/drm-v2.ts` is LGPL-3.0-only (derived from edge-tts). Code ported from edge-tts goes only into its own LGPL file with the same header (SPDX line, upstream commit, authors, dated modification notice). Never copy upstream code into MIT files.
- **The distributed app is MIT too**, with that one LGPL file and the Archivo font files (`@fontsource-variable/archivo`). The font stays under the SIL OFL 1.1, which the user approved: it allows bundling with any software. Keep it that way: no other copyleft dependency, and no code from `tiktok-live-connector` 2.4.1 or later or `tiktok-live-proto` 0.2.4 or later (AGPL).
- **Check licenses when adding or upgrading a dependency**, even minor bumps (tiktok-live-connector went MIT → AGPL in 2.4.1). Ask before adding anything copyleft (GPL, AGPL, LGPL, MPL, CC BY-SA). The `add-dependency` skill has the steps.
- **react-icons:** only use the sets listed under Icons in `THIRD_PARTY_NOTICES.md`, and add a row for any new set.
- **Keep the notices in sync** when licensed components change:
  - `THIRD_PARTY_NOTICES.md` (including its Services list for new online services) and `LICENSES/`
  - the license banner in `electron.vite.config.ts` (the bundler strips header comments)
  - `COMPONENTS` and `SERVICES` in `src/renderer/src/pages/About/helper.ts`, which mirror the non-npm parts of `THIRD_PARTY_NOTICES.md`
  - `src/renderer/src/pages/About/notices.test.ts` fails when they drift: icon sets in use, the services, license texts, no AGPL, the LGPL header and the banner
- The About page shows the license notices; keep it reachable from the sidebar. Its package list comes from `LicensesService`, which walks the production dependency tree, so new dependencies need no changes there.
- Keep `"license": "MIT"` in `package.json`; it describes the repository's own code.

## CI and releases

- `ci.yml` (PRs and `main`): Prettier check, lint, typecheck and tests on Linux, Windows and macOS, and the `e2e` job (under xvfb on Linux). Non-draft PRs, `main`, and draft PRs whose latest commit contains `[ci]` also package the app via `build-app.yml`; `chore(release): ...` commits skip packaging. On pull requests, a `commitlint` job checks every commit message against `.commitlintrc`.
- `release.yml` runs on a `v<version>` tag matching `package.json` and publishes a GitHub release with the packages and update files. `gh release create` uploads them before publishing. `scripts/release-notes` writes its notes from the Conventional Commits since the previous `v*` tag (`chore(release)` commits are skipped); a rerun only replaces the files, so edited notes are kept. Only its `release` job can write to the repository; the packaging jobs only read it.
- It then sends a `repository_dispatch` (`release`) to `tokio-app/website`, which rebuilds the download page. That needs the `WEBSITE_DISPATCH_TOKEN` secret (a fine-grained token with Contents read and write on `tokio-app/website`). Without it the step only warns.
- Versions with a `-` (`0.1.0-alpha.5`) are published as regular releases, not prereleases: auto-updates and the website only read the latest release.

To release, use the `release` skill (`/release`). The release goes out to auto-updates as soon as the workflow publishes it. Keep `artifactName` in `electron-builder.yml`, the upload paths in `build-app.yml` and the website's `src/lib/release.ts` in sync.

## Website

The website (`https://tokio.ialfaro.com`, repo `tokio-app/website`, locally `../tokio-web`) has its own `AGENTS.md`. Update it when any of these change:

- features, settings, chat commands or install steps (its docs describe them in full; the README only sums them up)
- the overlay format (`info.yaml`, `OverlayConfigSchema`, the `tokio-setup` script block), the server port or hostname, the alerts' overlay URL (`getAlertOverlayURL`), the countdown timer's (`TIMER_PATH`) or what it does, Minecraft's overlay's (`getMinecraftOverlayURL`) or what it does, or `TOKIO_EVENTS` names and payloads
- package file names (its `src/lib/release.ts` matches them)
- the Services list in `THIRD_PARTY_NOTICES.md` or the licensing

## Overlays repo

The official overlays live in `tokio-app/overlays` (locally `../tokio-overlays`), which has its own `AGENTS.md`. Its `scripts/lib/schema.js` copies `OverlayMetaSchema`, `OverlayConfigSchema` and the setup block's `SCRIPT_REGEX` so its builds are checked the way `processOverlay` checks an import. Update that copy when any of them, or what `processOverlay` accepts, change. Its releases publish a catalog of every overlay at `https://github.com/tokio-app/overlays/releases/latest/download/overlays.json` (format in its `README.md`), which Tokio installs from (see `.claude/rules/overlays.md`). A new catalog schema (a renamed or removed field) needs `CatalogOverlaySchema` and `parseCatalog` to read both. No official overlay can have the id `alerts`, `timer` or `games`: Tokio serves the alerts' overlays under `/alerts/`, the countdown timer's at `/timer/` and the games' overlays under `/games/`, and drops a catalog entry with any of them.

## Minecraft mod repo

Java Edition connects through the Tokio mod, a Fabric mod in `tokio-app/minecraft-mod` (locally `../tokio-minecraft-mod`, published at `https://github.com/tokio-app/minecraft-mod`), which has its own `AGENTS.md`. Its `PROTOCOL.md` is the contract with `MinecraftConnection`: change both together. The Games page links to the website's `#java-edition` install steps (`MINECRAFT_MOD_DOCS_URL`), and its README's commands must match the page's (see `.claude/rules/games.md`).

## Conventions

- Run `yarn format` on files you touch, and fix lint warnings in code you touch.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `feat!:`), enforced by a husky hook and by CI on pull requests. Don't bypass hooks.
- Keep the server port (`37891`), the Minecraft port (`MINECRAFT_PORT`, 37892) and its Java subprotocol (`MINECRAFT_JAVA_PROTOCOL`, `tokio.java.v1`), the alerts' overlay path (`/alerts/<alert id>/`), the countdown timer's (`/timer/`), Minecraft's overlay (`/games/minecraft/` and `/games/minecraft/<column>/`, its pictures under `/games/minecraft/pictures/`) and existing event names stable; overlays, browser sources and saved data depend on them.
- The overlay server listens on every network interface on purpose: a streaming app on another computer opens overlays through `tokio-app.local` pointed at this PC's address (shown in Settings → Overlay Server, `ServerService.networkAddresses()`) in that computer's hosts file or a DNS entry, and the setup block's `REMOTE_SOCKET` points their socket back at this PC. Don't bind it to loopback or add Host/Origin checks. The exception is the Minecraft socket (`MinecraftConnection`, `.claude/rules/games.md`): it refuses upgrades that carry an `Origin`, since the game never sends one and browsers always do, so web pages can't take it.
- Respect inline `NOTE: DO NOT CHANGE` markers.
- Inside a folder with a barrel `index` (`common/types`, `common/schemas`, `components`, `context`, `hooks`), import sibling files directly, never through the barrel, to avoid import cycles.
- `npx fallow health` (also `dead-code`, `dupes`) reports import cycles, dead code and duplication. It reads `.fallowrc.json`, where the music window UI is an entry point.
