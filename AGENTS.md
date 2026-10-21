# AGENTS.md

## Project

Tokio is an Electron desktop app for Windows, macOS and Linux that connects to a TikTok LIVE stream and reacts to its events with text-to-speech, music requests (Spotify/YouTube), sound alerts, and browser-source overlays served over a local HTTP/WebSocket server.

Stack: Electron 39, electron-vite, React 19, TypeScript, TanStack Router, Express 5 + `ws`, Zod 4, Yarn 1, Node >= 24.

## Commands

```sh
yarn dev                  # build the music window UI, then electron-vite dev (close Tokio first)
yarn test                 # vitest (yarn test:watch to watch, --project main|renderer for one)
yarn test:coverage        # vitest with a coverage report in coverage/
yarn test:e2e             # build the app and drive it with Playwright (needs port 37891: close Tokio first)
yarn typecheck            # tsc for node (main/preload/common) and web (renderer/music)
yarn lint                 # oxlint --type-aware
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
- `src/preload/`: exposes the typed `window.api.emit` / `window.api.on` bridge
- `src/renderer/`: main React UI (pages, components, contexts, router)
- `src/music/`: separate music window UI, built as a single file into `music-out/`
- `src/common/`: shared by both processes (Zod schemas, event types, constants, utils). It must not import from `src/main` or `src/renderer`, and must stay free of Node/Electron-only APIs if the renderer uses it.
- `src/ui/`: web-only code shared by the main and music windows (design tokens, base CSS, `TitleBar`)
- `test/`: Vitest setup, fakes, helpers and fixtures; `e2e/`: Playwright tests of the built app
- `scripts/`: repo maintenance scripts (`clean`, `todos`, `edge-tts`, `release-notes`)
- `LICENSES/`, `THIRD_PARTY_NOTICES.md`: third-party license texts and notices, shipped to the app's `resources/licenses`
- `build/`: the app icons electron-builder uses

Generated, don't edit: `out/`, `music-out/`, `dist/`. The packaged app holds only `out/`, `music-out/`, `resources/` and the production dependencies (`files` in `electron-builder.yml`), so a file the app reads at runtime must live in one of them. Dependencies only the windows import are bundled by Vite, so they ship only their `package.json` and license files (for About), through the `!node_modules/{…}` pattern in `files`; take one out of it if main or the preload starts importing it.

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
- `live-session.md`: the LIVE session and activity feed on Home
- `overlays.md`: overlay previews and official overlays
- `updates.md`: the auto-updater

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

When a procedure changes, update its skill with it.

## Architecture

### Services (main process)

- Each service lives in `src/main/services/<name>/index.ts` and extends `Service` (or `ProviderService<T>`) from `src/main/services/shared`. It's instantiated once in `src/main/index.ts`, added to `AppServices` in `src/main/types`, and injected into `AppHandler` (`src/main/handler/app.ts`).
- Swappable backends (connector, TTS, music) use providers: `addProvider(name, provider, start?)` / `setProvider(name, key?)`. Providers live in `services/<name>/providers/<provider>/` with `common/` and `config/` subfolders. TTS uses every provider at once, as engines (see `.claude/rules/tts.md`). The connector's provider key is the user's own Euler Stream API key, which signs the connection (`SET_PROVIDER`). Settings → TikTok LIVE always shows it; its provider picker only shows while more than one connector is registered. Never log the key or ship a shared one. Each service starts a provider in its constructor, so `_current` is always set.
- The default connector uses `@tokioapp/connector` (our MIT package, `../tokio-connector`), one `TikTokLiveConnection` per connect, with every listener added before `connect()`; a connect that comes while one is connecting gets that one, so only one connection opens. `isConnected()` is true from the start of a connect, so the profile can't be switched mid-connect, and `CONNECTED` comes only for a connect that worked. It reconnects on its own: a drop it recovers from calls `onReconnect` and keeps the LIVE session, and `DISCONNECTED` only comes once the connection stops (`reason: "ended"`, `"lost"`, or none when the user disconnected). A failed connect's `error.kind` picks the message `home.ts` shows. The library's warnings and errors go to `connector.log` through its `logger` option, with the error they carry; its info and debug lines are dropped.
- Music providers extend `MusicProvider` (`services/music/common`), which implements `on`/`off`/`emit`. `createWindow(view)` places a provider's page under the music window's title bar.
- Log through `Logger` (`@/logger`) with the service's `_logFile` and a `<ServiceName>` prefix, e.g. ``Logger.error(`<Connector> ...`, this._logFile)``. Format errors with `formatError` from `@/common/util`.
- Fallible service methods return `{ success, error?, data? }` instead of throwing.

### IPC events

All renderer ↔ main communication is typed. To add an event:

1. Add the request to `APP_EVENTS` and `AppEventsMap` in `src/common/types/events/req.ts`. Names follow `app:<area>:<action>`.
2. If it replies, add the response to `APP_EVENTS_RESPONSE` and `AppEventsResponseMap` in `src/common/types/events/res.ts`.
3. Register the handler in `src/main/events/pages/<page>.ts` with `events.push(APP_EVENTS.X, async (services, e, data) => { ... e.reply(...) }, options)`. Don't wrap it in try/catch; throw and let `options` handle it (see Feedback). A new page stack must be added to `mergeStacks` in `src/main/events/index.ts`.
4. In the renderer, send with `window.api.emit` and listen with the `useIpcRequest` / `useIpcListener` hooks.

To push from main without a request, use `win.webContents.send(APP_EVENTS_RESPONSE.Y, data)`; a `void` response still needs `undefined` as payload.

A request about one item (an overlay, a document, a test) gets its id back in the reply, failures included, so the renderer ignores a late reply for another one (see `GET_OVERLAY_CONFIG`).

Live stream events (`TOKIO_EVENTS` / `TokioEventMap`) come from the connector. `ServerService` forwards them to overlays over WebSocket, and they drive TTS, music requests and alerts. A new live event needs a label in `ALERT_TRIGGER_LABELS` (`src/common/types/connector.ts`) or typecheck fails; a new internal event goes in the `exclude` list of `AlertTriggerSchema` (`src/common/schemas/profile.ts`).

### Feedback

Main tells the renderer what failed so it can show notifications. Types are in `src/common/types/feedback.ts`, helpers in `src/main/helper/feedback.ts` and `src/main/helper/events.ts`.

- Replies use `Reply<{ ... }>`, which adds `error?: AppError` (`{ code: FEEDBACK_CODES, message }`). The message is plain English for the user; details go only to the logs.
- `createStack(source)` sets the `FeedbackSource` (and log file) of a page's handlers.
- `push` options: `failure` (the `AppError` for unexpected throws), `onError(e, error, data, services)` to send the failure reply (`replyFailure(APP_EVENTS_RESPONSE.X)` for a plain `{ success: false, error }`), `notify: false` when the page already shows the failure or for status probes, and `source` to override the stack's.
- Throw `new AppFailure(code, message, { level: "warning", cause })` for an expected failure with its own message or level. A canceled dialog is not a failure: just `return`.
- Log failures once. If a service already logged it, throw `new LoggedError(res.error)` or pass `{ logged: true }` to `AppFailure`.
- A store mutator that returns false couldn't write the store file, and `JSONManagerService` logged why: send the reply that shows what main holds, then throw `saveFailure()` (`SETTINGS_SAVE_FAILED`), with no success notice.
- `notifier` (in the handler's services) pushes `APP_EVENTS_RESPONSE.NOTIFY`: `notifier.report({ source, error, fallback })` logs and notifies; `notifier.error/warn/info/success(source, code, message, { key, windowMs })` sends a notice. Repeated warnings and errors are dropped within `windowMs` (5s default); use a longer window for failures that can repeat on every live event.
- User actions that change something call `notifier.success(...)` after the reply, where the handler succeeds. Reads, status checks, tests, autosaves (TTS, music, alerts) and controls whose state the UI already shows (Home's feature switches) send nothing. Success codes are past tense (`PROFILE_CREATED`); failures end in `_FAILED`.
- Background failures (TTS, music playback, missing alert sounds, gifts, server port, reconnects, LIVE ending) are reported from `src/main/events/init.ts` through service callbacks. Services don't know about the notifier.
- The renderer shows notices via `NotificationsProvider` (mounted above `AppProvider`, since load-time notices arrive before the splash closes): `Toasts` and the title bar's `NotificationBell`. Pages don't show notices themselves.

### Persistence

Settings and profiles are validated with the Zod schemas in `src/common/schemas` and persisted by `StoreManagerService`. When you change a schema, update its defaults in `src/common/util/constants`. Give every new saved field a `.default(...)` so older files still load. Store mutators return whether the store file was written. A profile switch that can't be saved keeps the old profile, and `updateProfileData` throws until the store has loaded.

Profile files are named by `StoreManagerService.profileFileFor`: the name in safe characters, numbered when the file is taken. The store never writes over a profile's file: creating or cloning a profile under a name another one has is refused (`PROFILE_EXISTS`), and an import gets a free file name. An import is listed under the name saved in it, trimmed, and numbered ("Name 2") when another profile has that name in any case.

A store file that doesn't parse is copied to `tokio.corrupted-<time>.json` next to it and replaced by the defaults. One that can't be read (locked, no access) or copied stops startup ("Tokio couldn't start") and is left as it is.

Only one Tokio runs per userData folder (`requestSingleInstanceLock` in `src/main/index.ts`, after `TOKIO_HOME` sets it): a second launch quits and brings the running one to the front. `yarn dev` and the installed app share that folder on Windows and macOS, so close Tokio before `yarn dev`.

## Licensing

Tokio's source is MIT; treat license compliance as part of every change.

- **LGPL code stays isolated.** `src/main/services/tts/providers/edge/common/drm-v2.ts` is LGPL-3.0-only (derived from edge-tts). Code ported from edge-tts goes only into its own LGPL file with the same header (SPDX line, upstream commit, authors, dated modification notice). Never copy upstream code into MIT files.
- **The distributed app is MIT too**, with that one LGPL file. Keep it that way: no copyleft dependency, and no code from `tiktok-live-connector` 2.4.1 or later or `tiktok-live-proto` 0.2.4 or later (AGPL).
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

- `ci.yml` (PRs and `main`): Prettier check, lint, typecheck and tests on Linux, Windows and macOS, and the `e2e` job (under xvfb on Linux). Non-draft PRs, `main`, and draft PRs whose latest commit contains `[ci]` also package the app via `build-app.yml`; `chore(release): ...` commits skip packaging.
- `release.yml` runs on a `v<version>` tag matching `package.json` and publishes a GitHub release with the packages and update files. `gh release create` uploads them before publishing. `scripts/release-notes` writes its notes from the Conventional Commits since the previous `v*` tag (`chore(release)` commits are skipped); a rerun only replaces the files, so edited notes are kept. Only its `release` job can write to the repository; the packaging jobs only read it.
- It then sends a `repository_dispatch` (`release`) to `tokio-app/website`, which rebuilds the download page. That needs the `WEBSITE_DISPATCH_TOKEN` secret (a fine-grained token with Contents read and write on `tokio-app/website`). Without it the step only warns.
- Versions with a `-` (`0.1.0-alpha.5`) are published as regular releases, not prereleases: auto-updates and the website only read the latest release.

To release, use the `release` skill (`/release`). The release goes out to auto-updates as soon as the workflow publishes it. Keep `artifactName` in `electron-builder.yml`, the upload paths in `build-app.yml` and the website's `src/lib/release.ts` in sync.

## Website

The website (`https://tokio.ialfaro.com`, repo `tokio-app/website`, locally `../tokio-web`) has its own `AGENTS.md`. Update it when any of these change:

- features, settings, chat commands or install steps in `README.md`
- the overlay format (`info.yaml`, `OverlayConfigSchema`, the `tokio-setup` script block), the server port or hostname, or `TOKIO_EVENTS` names and payloads
- package file names (its `src/lib/release.ts` matches them)
- the Services list in `THIRD_PARTY_NOTICES.md` or the licensing

## Overlays repo

The official overlays live in `tokio-app/overlays` (locally `../tokio-overlays`), which has its own `AGENTS.md`. Its `scripts/lib/schema.js` copies `OverlayMetaSchema`, `OverlayConfigSchema` and the setup block's `SCRIPT_REGEX` so its builds are checked the way `processOverlay` checks an import. Update that copy when any of them, or what `processOverlay` accepts, change. Its releases publish a catalog of every overlay at `https://github.com/tokio-app/overlays/releases/latest/download/overlays.json` (format in its `README.md`), which Tokio installs from (see `.claude/rules/overlays.md`). A new catalog schema (a renamed or removed field) needs `CatalogOverlaySchema` and `parseCatalog` to read both.

## Conventions

- Run `yarn format` on files you touch, and fix lint warnings in code you touch.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `feat!:`), enforced by a husky hook. Don't bypass hooks.
- Keep the server port (`37891`) and existing event names stable; overlays and saved data depend on them.
- Respect inline `NOTE: DO NOT CHANGE` markers.
- Inside a folder with a barrel `index` (`common/types`, `common/schemas`, `components`, `context`, `hooks`), import sibling files directly, never through the barrel, to avoid import cycles.
- `npx fallow health` (also `dead-code`, `dupes`) reports import cycles, dead code and duplication. It reads `.fallowrc.json`, where the music window UI is an entry point.
