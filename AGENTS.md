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

The `verify` skill picks the checks a change needs, the Linux run in WSL included.

## Agent models

- **Planning:** Opus 5.5 at high effort. Be 90–95% confident in the plan before implementing or handing off; otherwise keep reading code or ask the user.
- **Implementation subagents:** Sonnet 5.5 at high effort for well-scoped changes that follow existing patterns. Otherwise Opus 5.5: medium effort for moderate tasks, high for complex or cross-cutting ones (architecture, IPC/schema changes across processes, concurrency, licensing-sensitive code).

## Layout

- `src/main/`: Electron main process (services, IPC event handlers, window setup)
- `src/preload/`: exposes the typed `window.api.emit` / `window.api.on` bridge. The windows are sandboxed, so it builds as CommonJS (`out/preload/index.cjs`) and can load only `electron` at runtime; anything else it imports must be bundled, like `src/common`.
- `src/renderer/`: main React UI (pages, components, contexts, router)
- `src/music/`: separate music window UI, built as a single file into `music-out/`
- `src/common/`: shared by both processes (Zod schemas, event types, constants, utils, and the locale files in `src/common/i18n`). It must not import from `src/main` or `src/renderer`, and must stay free of Node/Electron-only APIs if the renderer uses it.
- `src/ui/`: web-only code shared by the main and music windows (design tokens, base CSS, `TitleBar`)
- `test/`: Vitest setup, fakes, helpers and fixtures; `e2e/`: Playwright tests of the built app
- `scripts/`: repo maintenance scripts (`edge-tts`, `release-notes`)
- `LICENSES/`, `THIRD_PARTY_NOTICES.md`: third-party license texts and notices, shipped to the app's `resources/licenses`
- `build/`: the app icons electron-builder uses

Generated, don't edit: `out/`, `music-out/`, `dist/`.

- The packaged app holds only `out/`, `music-out/`, `resources/` and the production dependencies (`files` in `electron-builder.yml`), so a file the app reads at runtime must live in one of them.
- Packages only the windows import are bundled by Vite and ship only their `package.json` and license files, through the `!node_modules/{…}` pattern in `files` (see the `add-dependency` skill). `src/main/packaging.test.ts` fails when `src/main` or `src/common` reaches one, even through a dependency.
- A file main imports from one with a query (`?inline`, like the countdown timer's font) is bundled into `out/main` once the package is in main's `externalizeDeps.exclude` (`electron.vite.config.ts`); the test skips those imports.

## Path aliases

- Main process: `@/*` → `src/main/*`, `@/common/*` → `src/common/*`
- Renderer: `@/*` (preferred) and `@renderer/*` → `src/renderer/src/*`, plus `@/common/*` and `@/ui/*` → `src/ui/*`
- Music window: `@/common/*` and `@/ui/*` only.
- Tests: their process's aliases, plus `@test/*` → `test/main/*` or `test/renderer/*`.

## Topic rules

Notes for one area live in `.claude/rules/`. Claude Code loads each one when it reads or edits a file its `paths` match; read one directly when planning across areas.

**Other agents:** these rules don't load on their own. Before you read or edit files a rule's `paths` match, read that rule.

- `testing.md`: Vitest and Playwright setup, fakes and helpers
- `renderer.md`: pages, components, the look, keyboard and the CSP
- `renderer-state.md`: profile autosaves, `useAutosave` and `AudioQueue`
- `app-lifecycle.md`: single instance, tray, windows and quitting
- `store.md`: the store and profile files
- `connector.md`: the TikTok connector and its key
- `tts.md`: TTS engines and their providers
- `alerts.md`: alert triggers, gifts, sounds and spoken alerts
- `games.md`: the Games page, the Minecraft connection and game actions
- `games-overlay.md`: the games overlay and the Minecraft pictures library
- `live-session.md`: the LIVE session and activity feed on Home
- `overlays.md`: overlay previews and official overlays
- `updates.md`: the auto-updater
- `timer.md`: the countdown timer, its overlay and the Tools page
- `i18n.md`: the locale files, translating in the windows and main, and the language setting

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
- `minecraft-lists`: regenerate the Minecraft mob and item lists
- `frontend-design`: the visual direction for new or reshaped UI (Anthropic's skill, Apache-2.0, vendored as published)
- `humanizer`: rewrite UI text, translations and docs that read as AI-written (blader/humanizer v3.1.0, MIT, vendored as published)

When a procedure changes, update its skill with it.

## Architecture

### Languages

Tokio is in English and Spanish, following the system's language unless **Settings → Language** picks one. Details in `.claude/rules/i18n.md`.

- Every text the user or the stream sees comes from `src/common/i18n/locales/<tag>.json`. A new language is one new file there; `yarn test` checks it against `en.json`.
- The windows use `useT()` (`@/ui/i18n`), main uses `t()` (`@/helper/i18n`), and helpers that write text take the `language`. Logs stay English.
- `react/jsx-no-literals` (`.oxlintrc.json`) fails lint on text written into the windows' JSX or text props.
- UI text and translations go through the `humanizer` skill.

### Services (main process)

- Each service lives in `src/main/services/<name>/index.ts` and extends `Service` (or `ProviderService<T>`) from `src/main/services/shared`. It's created once in `src/main/index.ts`, added to `AppServices` (`src/main/types`) and injected into `AppHandler`.
- Swappable backends (connector, TTS, music) use providers: `addProvider(name, provider, start?)` / `setProvider(name, key?)` (without a key the provider keeps its own; `""` clears it). Providers live in `services/<name>/providers/<provider>/` with `common/` and `config/` subfolders. Each service starts a provider in its constructor, so `_current` is always set.
- TTS uses every provider at once, as engines (`.claude/rules/tts.md`). The connector's key is the user's Euler Stream key (`.claude/rules/connector.md`).
- Classes that send live events to listeners (`MusicProvider` in `services/music/common`, `MusicQueue`, `ConnectorProvider`) extend `TokioEmitter` (`services/shared/emitter`): a typed `on`/`off` and a protected `emit`. `createWindow(view)` places a provider's page under the music window's title bar.
- Log through `Logger` (`@/logger`) with the service's `_logFile` and a `<ServiceName>` prefix, e.g. ``Logger.error(`<Connector> ...`, this._logFile)``. Format errors with `formatError` from `@/common/util`.
- Fallible service methods return `ServiceResult<T>` (`{ success, error?, data? }`, in `services/shared`) instead of throwing.

### IPC events

All renderer ↔ main communication is typed. The `ipc-event` skill has the steps and the code shapes.

- Requests go in `APP_EVENTS` and `AppEventsMap` (`src/common/types/events/req.ts`), named `app:<area>:<action>`. Replies and pushes go in `APP_EVENTS_RESPONSE` and `AppEventsResponseMap` (`res.ts`).
- Handlers live in `src/main/events/pages/<page>.ts`, registered with `events.push(event, handler, options)`. Don't wrap them in try/catch; throw and let `options` handle it (see Feedback). A new page stack goes in `mergeStacks` (`src/main/events/index.ts`).
- The renderer sends with `window.api.emit` and listens with the `useIpcRequest` / `useIpcListener` hooks.
- Main pushes without a request with `win.webContents.send(APP_EVENTS_RESPONSE.Y, data)`; a `void` response still needs `undefined` as payload.
- Handlers open file dialogs with `showOpenDialog` / `showSaveDialog` from `@/helper/dialog`, which start in the last folder used. Electron's own start in Downloads.
- A request about one item (an overlay, a document, a test) gets its id back in the reply, failures included, so the renderer ignores a late reply for another one (see `GET_OVERLAY_CONFIG`).

Live stream events (`TOKIO_EVENTS` / `TokioEventMap`) come from the connector. `ServerService` forwards them to overlays over WebSocket, and they drive TTS, music requests, alerts and game actions. The `live-event` skill adds or changes one.

### Feedback

Main tells the renderer what failed so it can show notifications. Types are in `src/common/types/feedback.ts`, helpers in `src/main/helper/feedback.ts` and `src/main/helper/events.ts`.

- Replies use `Reply<{ ... }>`, which adds `error?: AppError` (`{ code: FEEDBACK_CODES, message }`). The message is plain text for the user, in their language (`t()`, see Languages); details go only to the logs, in English.
- `createStack(source)` sets the `FeedbackSource` (and log file) of a page's handlers.
- `push` options: `failure` (`{ code, message }` for unexpected throws, its message a locale key that `runEvent` translates when it reports), `onError(e, error, data, services)` to send the failure reply (`replyFailure(APP_EVENTS_RESPONSE.X)` for a plain `{ success: false, error }`), `notify: false` when the page already shows the failure or for status probes, and `source` to override the stack's.
- Throw `new AppFailure(code, message, { level: "warning", cause })` for an expected failure with its own message or level. A canceled dialog is not a failure: just `return`.
- Log failures once. If a service already logged it, throw `new LoggedError(res.error)` or pass `{ logged: true }` to `AppFailure`.
- A store mutator that returns false couldn't write the store file (`JSONManagerService` logged why): send the reply that shows what main holds, then throw `saveFailure()` (`SETTINGS_SAVE_FAILED`), with no success notice.
- `notifier` (in the handler's services) pushes `APP_EVENTS_RESPONSE.NOTIFY`. `report({ source, error, fallback })` logs and notifies; `error/warn/info/success(source, code, message, { key, windowMs })` sends a notice.
- Repeated warnings and errors are dropped within `windowMs` (`DEDUPE_MS` by default); use a longer window for failures that can repeat on every live event.
- User actions that change something call `notifier.success(...)` after the reply. Reads, status checks, tests, autosaves (TTS, music, alerts, the keys in Settings) and controls whose state the UI already shows (Home's feature switches) send nothing.
- Success codes are past tense (`PROFILE_CREATED`); failures end in `_FAILED`.
- Background failures (TTS, music playback, missing alert sounds, gifts, server port, reconnects, LIVE ending) are reported from `src/main/events/init.ts` through service callbacks. Services don't know about the notifier.
- The renderer shows notices via `NotificationsProvider` (mounted above `AppProvider`, since load-time notices arrive before the splash closes): `Toasts` and the title bar's `NotificationBell`. Pages don't show notices themselves.

### Persistence

- Settings and profiles are validated with the Zod schemas in `src/common/schemas` and persisted by `StoreManagerService`.
- When you change a schema, update its defaults in `src/common/util/constants`. Give every new saved field a `.default(...)` so older files still load.
- Store mutators return whether the store file was written (see Feedback for a false).
- `updateProfileData` throws until the store has loaded. It writes the active profile unless given a file: a service that keeps a profile's data in memory, like the countdown timer, passes the file it loaded from.
- Provider keys (the Euler key, voice engine keys) are saved encrypted with `safeStorage`'s async calls. The store decrypts them once at startup and reads them from memory, so `getSettings` stays synchronous. Never log a provider key, and never ship a shared one.
- Quitting waits up to 3s for IPC handlers and file writes still running (`track`/`settle`, `src/main/helper/quit.ts`).
- Write files through `writeFileAtomic` (`src/main/helper/fs.ts`) or the file managers, so a quit waits for them and a quit or crash midway leaves the old file whole. `writeFileAtomic` flushes the temp file to disk before the rename, so a power cut can't leave a file of NULs.

Profile files and the store's recovery: `.claude/rules/store.md`. The single instance, the tray and how a quit is held: `.claude/rules/app-lifecycle.md`.

## Licensing

Tokio's source is MIT; treat license compliance as part of every change.

- **LGPL code stays isolated.** `src/main/services/tts/providers/edge/common/drm-v2.ts` is LGPL-3.0-only (derived from edge-tts). Code ported from edge-tts goes only into its own LGPL file with the same header (SPDX line, upstream commit, authors, dated modification notice). Never copy upstream code into MIT files.
- **The distributed app is MIT too**, with that one LGPL file and the Archivo font files (`@fontsource-variable/archivo`). The font stays under the SIL OFL 1.1, which the user approved: it allows bundling with any software. Keep it that way: no other copyleft dependency, and no code from `tiktok-live-connector` 2.4.1 or later or `tiktok-live-proto` 0.2.4 or later (AGPL).
- **Check licenses when adding or upgrading a dependency**, even minor bumps (tiktok-live-connector went MIT → AGPL in 2.4.1). Ask before adding anything copyleft (GPL, AGPL, LGPL, MPL, CC BY-SA). Steps in the `add-dependency` skill.
- **react-icons:** only use the sets listed under Icons in `THIRD_PARTY_NOTICES.md`, and add a row for any new set.
- **Keep the notices in sync** when licensed components change:
  - `THIRD_PARTY_NOTICES.md` (including its Services list for new online services) and `LICENSES/`
  - the license banner in `electron.vite.config.ts` (the bundler strips header comments)
  - `COMPONENTS` and `SERVICES` in `src/renderer/src/pages/About/helper.ts`, which mirror the non-npm parts of `THIRD_PARTY_NOTICES.md`
  - `src/renderer/src/pages/About/notices.test.ts` fails when they drift
- The About page shows the license notices; keep it reachable from the sidebar. Its package list comes from `LicensesService` (the production dependency tree), so new dependencies need no changes there.
- Keep `"license": "MIT"` in `package.json`; it describes the repository's own code.

## CI and releases

- `ci.yml` (PRs and `main`): Prettier check, lint, typecheck and tests on Linux, Windows and macOS, and the `e2e` job (under xvfb on Linux). On pull requests, a `commitlint` job checks every commit message against `.commitlintrc`.
- Non-draft PRs, `main`, and draft PRs whose latest commit contains `[ci]` also package the app via `build-app.yml`; `chore(release): ...` commits skip packaging.
- `release.yml` runs on a `v<version>` tag matching `package.json` and publishes a GitHub release with the packages and update files. Only its `release` job can write to the repository; the packaging jobs only read it.
- It then sends a `repository_dispatch` (`release`) to `tokio-app/website`, which rebuilds the download page. That needs the `WEBSITE_DISPATCH_TOKEN` secret (a fine-grained token with Contents read and write on `tokio-app/website`). Without it the step only warns.
- Versions with a `-` (`0.1.0-alpha.5`) are published as regular releases, not prereleases: auto-updates and the website only read the latest release.
- Keep `artifactName` in `electron-builder.yml`, the upload paths in `build-app.yml` and the website's `src/lib/release.ts` in sync.

To release, use the `release` skill (`/release`). A release reaches auto-updates as soon as the workflow publishes it.

## Website

The website (`https://tokio.ialfaro.com`, repo `tokio-app/website`, locally `../tokio-web`) has its own `AGENTS.md`. Update it when any of these change:

- features, settings, chat commands or install steps (its docs describe them in full; the README only sums them up)
- the overlay format (`info.yaml`, `OverlayConfigSchema`, the `tokio-setup` script block), the server port or hostname, the alerts' overlay URL (`getAlertOverlayURL`), the countdown timer's (`TIMER_PATH`) or what it does, Minecraft's overlay's (`getMinecraftOverlayURL`) or what it does, or `TOKIO_EVENTS` names and payloads
- package file names (its `src/lib/release.ts` matches them)
- the Services list in `THIRD_PARTY_NOTICES.md` or the licensing

It's in English and Spanish, so an update lands in both: its docs in `src/content/docs/docs/` and `src/content/docs/es/docs/`, its pages' text in `src/i18n/en.json` and `es.json`, and the screenshots retaken in both languages. Its Spanish quotes this app's own Spanish labels (`es-419.json`).

## Overlays repo

The official overlays live in `tokio-app/overlays` (locally `../tokio-overlays`), which has its own `AGENTS.md`.

- Its `scripts/lib/schema.js` copies `OverlayMetaSchema`, `OverlayConfigSchema` and the setup block's `SCRIPT_REGEX` so its builds are checked the way `processOverlay` checks an import. Update that copy when any of them, or what `processOverlay` accepts, change.
- Its releases publish a catalog of every overlay at `https://github.com/tokio-app/overlays/releases/latest/download/overlays.json` (format in its `README.md`), which Tokio installs from (see `.claude/rules/overlays.md`). A new catalog schema (a renamed or removed field) needs `CatalogOverlaySchema` and `parseCatalog` to read both.
- No official overlay can have the id `alerts`, `timer` or `games`, paths Tokio serves itself: it drops a catalog entry with any of them.

## Minecraft mod repo

Java Edition connects through the Tokio mod, a Fabric mod in `tokio-app/minecraft-mod` (locally `../tokio-minecraft-mod`, published at `https://github.com/tokio-app/minecraft-mod`), which has its own `AGENTS.md`. Its `PROTOCOL.md` is the contract with `MinecraftConnection`: change both together. The Games page links to the website's `#java-edition` install steps (`MINECRAFT_MOD_DOCS_URL`), and its README's commands must match the page's (see `.claude/rules/games.md`).

## Conventions

- Run `yarn format` on files you touch, and fix lint warnings in code you touch.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `feat!:`), enforced by a husky hook and by CI on pull requests. Don't bypass hooks.
- Pull requests: a Conventional Commits title and the sections of `.github/pull_request_template.md`.
- Keep these stable; overlays, browser sources and saved data depend on them:
  - the server port (`37891`), the Minecraft port (`MINECRAFT_PORT`, 37892) and its Java subprotocol (`MINECRAFT_JAVA_PROTOCOL`, `tokio.java.v1`)
  - the alerts' overlay path (`/alerts/<alert id>/`), the countdown timer's (`/timer/`), Minecraft's overlay (`/games/minecraft/` and `/games/minecraft/<column>/`, its pictures under `/games/minecraft/pictures/`)
  - existing event names
- The overlay server listens on every network interface on purpose, for streaming apps on other computers (`tokio-app.local`, `REMOTE_SOCKET`, see `.claude/rules/overlays.md`). Don't bind it to loopback or add Host/Origin checks. The Minecraft socket is the exception (`.claude/rules/games.md`).
- Respect inline `NOTE: DO NOT CHANGE` markers.
- Inside a folder with a barrel `index` (`common/types`, `common/schemas`, `components`, `context`, `hooks`), import sibling files directly, never through the barrel, to avoid import cycles.
- `npx fallow health` (also `dead-code`, `dupes`) reports import cycles, dead code and duplication. `.fallowrc.json` makes the music window UI an entry point.
