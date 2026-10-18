# AGENTS.md

## Project

Tokio is an Electron desktop app for Windows, macOS and Linux that connects to a TikTok LIVE stream and reacts to its events with text-to-speech, music requests (Spotify/YouTube), sound alerts, and browser-source overlays served over a local HTTP/WebSocket server.

Stack: Electron 39, electron-vite, React 19, TypeScript, TanStack Router, Express 5 + `ws`, Zod 4, Yarn 1, Node >= 24.

## Commands

```sh
yarn dev                  # build the music window UI, then electron-vite dev
yarn test                 # vitest (yarn test:watch to watch)
yarn typecheck            # tsc for node (main/preload/common) and web (renderer/music)
yarn lint                 # oxlint --type-aware
yarn format               # prettier --write .
yarn build                # typecheck + music UI + electron-vite build
yarn build:win            # build + package (also build:mac, build:linux)
yarn tts:edge:check       # live check of the Edge TTS provider (needs network)
yarn release:notes [tag]  # print a release's notes (the next release's without a tag)
```

Verify changes with `yarn test`, `yarn typecheck` and `yarn lint`. For the Edge TTS provider, also run `yarn tts:edge:check`.

### Tests

- Vitest runs in Node, without Electron or network. Tests sit next to the code as `<file>.test.ts` under `src/main` and `src/common`.
- `test/setup.ts` mocks `electron` (`safeStorage` round-trips plain text) and silences the console. Spy on `Logger` to assert logs.
- Give services a temp folder (`mkdtemp(join(tmpdir(), "tokio-test-"))`) through their setters or `initialize`, stub `fetch` with `vi.stubGlobal`, and use fake timers for the queues.
- Fixtures live in `test/fixtures`; Prettier skips them so saved HTML keeps its markup.
- `it.fails` marks a known bug. Turn it into `it` when the bug is fixed.

## Agent models

- **Planning:** Opus 5.5 at high effort. Be 90–95% confident in the plan before implementing or handing off; otherwise keep reading code or ask the user.
- **Implementation subagents:** Sonnet 5.5 at high effort for well-scoped changes that follow existing patterns. Otherwise Opus 5.5: medium effort for moderate tasks, high for complex or cross-cutting ones (architecture, IPC/schema changes across processes, concurrency, licensing-sensitive code).

## Layout

| Path                                  | Role                                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------------------- |
| `src/main/`                           | Electron main process: services, IPC event handlers, window setup                       |
| `src/preload/`                        | Exposes the typed `window.api.emit` / `window.api.on` bridge                            |
| `src/renderer/`                       | Main React UI (pages, components, contexts, router)                                     |
| `src/music/`                          | Separate music window UI, built as a single file into `music-out/`                      |
| `src/common/`                         | Shared by both processes: Zod schemas, event types, constants, utils                    |
| `src/ui/`                             | Web-only code shared by the main and music windows: design tokens, base CSS, `TitleBar` |
| `scripts/`                            | Repo maintenance scripts (`clean`, `todos`, `edge-tts`, `release-notes`)                |
| `LICENSES/`, `THIRD_PARTY_NOTICES.md` | Third-party license texts and notices, shipped to the app's `resources/licenses`        |

Generated, don't edit: `out/`, `music-out/`, `build/` output.

## Path aliases

- Main process: `@/*` → `src/main/*`, `@/common/*` → `src/common/*`
- Renderer: `@/*` (preferred) and `@renderer/*` → `src/renderer/src/*`, plus `@/common/*` and `@/ui/*` → `src/ui/*`
- Music window: `@/common/*` and `@/ui/*` only.

Code in `src/common/` must not import from `src/main` or `src/renderer`, and must stay free of Node/Electron-only APIs if the renderer uses it.

## Architecture

### Services (main process)

- Each service lives in `src/main/services/<name>/index.ts` and extends `Service` (or `ProviderService<T>`) from `src/main/services/shared`. It's instantiated once in `src/main/index.ts`, added to `AppServices` in `src/main/types`, and injected into `AppHandler` (`src/main/handler/app.ts`).
- Swappable backends (connector, TTS, music) use providers: `addProvider(name, provider, start?)` / `setProvider(name, key?)`. Providers live in `services/<name>/providers/<provider>/` with `common/` and `config/` subfolders.
- Log through `Logger` (`@/logger`) with the service's `_logFile` and a `<ServiceName>` prefix, e.g. `Logger.error(\`<Connector> ...\`, this._logFile)`. Format errors with `formatError`from`@/common/util`.
- Fallible service methods return `{ success, error?, data? }` instead of throwing.

### TTS providers

- A provider extends `TTSProvider` (`src/main/services/tts/common`) and implements `label`, `getVoices` (may be async), `generateBuffer` and `setKey`. Set `keyLabel` if it takes a key. Override `dispose` (runs on `will-quit`) if it holds resources such as child processes.
- Providers aren't picked: `TTSService` treats each one as an engine, and its `addProvider` name is the engine id. `getVoices` lists every engine's voices as `VoiceData` (`{ engine, name, lang }`), and `generateBuffer` speaks with the voice's engine. A failing engine is logged and left out of the list.
- Voices saved before engines existed have `engine: ""`. Those, and voices naming an engine that isn't registered (Windows on macOS), go to the active provider: `settings.activeTTSProvider`, set by the store at startup. `generateBuffer` must still fall back to a default when given another engine's voice name.
- Engines with a `keyLabel` get a field in Settings → Voice Engines (`GET_VOICE_KEYS` / `SET_VOICE_KEY`). Their keys are saved encrypted in `settings.providers.tts` and applied to every engine at startup.
- The connector keeps its provider setup (`SET_PROVIDER`), but Settings only shows its form while more than one connector is registered.
- `windows` drives SAPI and OneCore voices through a long-lived 32-bit PowerShell helper, so 32-bit-only voices such as Loquendo are visible. Its script in `common/script.ts` must not contain backticks.
- `edge` uses Microsoft's unofficial Read Aloud protocol. Read `providers/edge/README.md` before changing it. Volatile values live in its `config/index.ts`.

### Alerts

- Saved per profile in `Profile.alerts` (`simultaneous`, `queue_length`, `items`). Uploaded sounds are a library shared by all profiles, in `settings.sounds`.
- `AlertTriggerSchema` (`src/common/schemas/profile.ts`) derives the triggers from `TOKIO_EVENTS`. A new live event needs a label in `ALERT_TRIGGER_LABELS` (`src/common/types/connector.ts`) or typecheck fails; a new internal event goes in the schema's `exclude` list.
- `registerConnectorEvents` (`src/main/events/init.ts`) passes every trigger to `AlertsService.handle` while `activeFeatures.alerts` is on. `MUSIC_CHANGE` comes from `MusicService`, the rest from the connector. Gift alerts fire once per combo, on `repeatEnd`.
- Sound files in the `sounds` folder are named by a hash of their content (uploads) or URL (MyInstants), and alerts store only the basename. Read them through `AlertsService.readSound` (keeps paths inside the folder, caches). Check `StoreManagerService.isSoundInUse` before deleting one.
- MyInstants has no API; `AlertsService` scrapes it with cheerio. Only fetch `www.myinstants.com` URLs.
- Main sends sounds with `ALERT_AUDIO` on a queue (`channel`): one `alerts` queue, or `alerts:<trigger>` per trigger when `simultaneous` is on. `ALERT_CLEAR` (on disconnect and when the feature turns off) stops every `alerts*` queue. Tests and previews use `useAlertTest` on the `alert-test` queue, so clearing never cuts them.

### Updates

- `UpdaterService` (`src/main/services/updater`) wraps electron-updater's `autoUpdater`. It's loaded with a dynamic `import()` because the package is CJS and main builds to ESM, so use its default export. Tests inject a fake `Updater` instead.
- It reads the GitHub release marked latest (`allowPrerelease = false`). Without that, the library would allow prereleases on its own for `-alpha` versions.
- Windows (NSIS) and Linux (AppImage) download in the background and install on restart. macOS builds are ad-hoc signed, which Squirrel.Mac rejects, so mac only checks (`manual: true`) and opens the release page.
- Status reaches the renderer as `UpdateStatus` (`src/common/types/updates.ts`) on `UPDATE_STATUS`, pushed on every change. Read it with `useUpdateStatus`. `UpdateButton` (title bar and About) restarts or opens the release page, and asks first while a LIVE is connected.
- Checks run 15s after `LOAD_APP` and then every 6h while `settings.updates.auto` is on. A failed background check is only logged, since it's usually just offline; About shows a failed manual check. The updater logs its own errors through `<Updater>`, so don't log them again.
- `app-update.yml` is only packaged for update-capable targets (NSIS, mac zip, AppImage), not `--dir` builds. In dev, `TOKIO_DEV_UPDATES=1 yarn dev` checks against `dev-app-update.yml`.

### IPC events

All renderer ↔ main communication is typed. To add an event:

1. Add the request to `APP_EVENTS` and `AppEventsMap` in `src/common/types/events/req.ts`. Names follow `app:<area>:<action>`.
2. If it replies, add the response to `APP_EVENTS_RESPONSE` and `AppEventsResponseMap` in `src/common/types/events/res.ts`.
3. Register the handler in `src/main/events/pages/<page>.ts` with `events.push(APP_EVENTS.X, async (services, e, data) => { ... e.reply(...) }, options)`. Don't wrap it in try/catch; throw and let `options` handle it (see Feedback). A new page stack must be added to `mergeStacks` in `src/main/events/index.ts`.
4. In the renderer, send with `window.api.emit` and listen with the `useIpcRequest` / `useIpcListener` hooks.

To push from main without a request, use `win.webContents.send(APP_EVENTS_RESPONSE.Y, data)`; a `void` response still needs `undefined` as payload.

Live stream events (`TOKIO_EVENTS` / `TokioEventMap`) come from the connector. `ServerService` forwards them to overlays over WebSocket, and they drive TTS, music requests and alerts.

### Feedback

Main tells the renderer what failed so it can show notifications. Types are in `src/common/types/feedback.ts`, helpers in `src/main/helper/feedback.ts` and `src/main/helper/events.ts`.

- Replies use `Reply<{ ... }>`, which adds `error?: AppError` (`{ code: FEEDBACK_CODES, message }`). The message is plain English for the user; details go only to the logs.
- `createStack(source)` sets the `FeedbackSource` (and log file) of a page's handlers.
- `push` options: `failure` (the `AppError` for unexpected throws), `onError(e, error, data, services)` to send the failure reply (`replyFailure(APP_EVENTS_RESPONSE.X)` for a plain `{ success: false, error }`), `notify: false` when the page already shows the failure or for status probes, and `source` to override the stack's.
- Throw `new AppFailure(code, message, { level: "warning", cause })` for an expected failure with its own message or level. A canceled dialog is not a failure: just `return`.
- Log failures once. If a service already logged it, throw `new LoggedError(res.error)` or pass `{ logged: true }` to `AppFailure`.
- `notifier` (in the handler's services) pushes `APP_EVENTS_RESPONSE.NOTIFY`: `notifier.report({ source, error, fallback })` logs and notifies; `notifier.error/warn/info/success(source, code, message, { key, windowMs })` sends a notice. Repeated warnings and errors are dropped within `windowMs` (5s default); use a longer window for failures that can repeat on every live event.
- User actions that change something call `notifier.success(...)` after the reply, where the handler succeeds. Reads, status checks, tests, autosaves (alerts) and controls whose state the UI already shows (Home's feature switches) send nothing. Success codes are past tense (`PROFILE_SAVED`); failures end in `_FAILED`.
- Background failures (TTS, music playback, missing alert sounds, gifts, server port, LIVE ending) are reported from `src/main/events/init.ts` through service callbacks. Services don't know about the notifier.
- The renderer shows notices via `NotificationsProvider` (mounted above `AppProvider`, since load-time notices arrive before the splash closes): `Toasts` and the title bar's `NotificationBell`. Pages don't show notices themselves.

### Renderer

- Each page is a folder `src/renderer/src/pages/<Page>/` with `index.tsx`, `<page>.module.css`, an optional `helper.ts` and `sections/*Section.tsx`. Export it from `pages/index.tsx`, route it in `router/index.tsx` (hash history) and add sidebar links to `NAV_ITEMS` in `router/Layout`.
- Build pages from `components/Page` (`Page`, `Section`, `Field`, `FormGrid`, `EmptyState`); a page module only holds page-specific layout.
- Components are folders with `index.tsx` and `<name>.module.css`, re-exported from `components/index.tsx`. Use the primitives in `components/Elements` before creating new ones; they take colors from the tokens, not props. `Modal` is the only modal shell.
- Style with CSS Modules and the tokens in `src/ui/styles/tokens.css` (colors, `--space-*`, `--font-*`, `--radius-*`, `--z-*`), not raw values.
- Global state is in `context/` (`app`, `audio`, `notifications`, `unsaved`); shared hooks are in `hooks/`. Notably:
  - `useImmerState` returns an immer `Updater`; `scopeUpdater(update, key)` hands a section one field.
  - `useEditableSettings(section, label)` edits a profile section as a draft and registers with `UnsavedProvider`, which asks to save or discard on profile switch or navigation. Call `confirmDiscard()` from `useUnsavedChanges` before anything else that reloads the profile.
- Audio plays through named `AudioQueue`s (`helper/audio.ts`) from `useAudio().getQueue(name)`. `onEnded` doesn't run when a queue is stopped, and `maxQueueLength` counts waiting and playing items.

### Persistence

Settings and profiles are validated with the Zod schemas in `src/common/schemas` and persisted by `StoreManagerService`. When you change a schema, update its defaults in `src/common/util/constants`. Give every new saved field a `.default(...)` so older files still load.

## Licensing

Tokio's source is MIT; treat license compliance as part of every change.

- **LGPL code stays isolated.** `src/main/services/tts/providers/edge/common/drm-v2.ts` is LGPL-3.0-only (derived from edge-tts). Code ported from edge-tts goes only into its own LGPL file with the same header (SPDX line, upstream commit, authors, dated modification notice). Never copy upstream code into MIT files.
- **The distributed app is AGPL-3.0-only** because `tiktok-live-connector` and `tiktok-live-proto` are AGPL. Don't patch them in place.
- **Check licenses when adding or upgrading a dependency**, even minor bumps (tiktok-live-connector went MIT → AGPL in 2.4.1). Ask before adding anything copyleft (GPL, AGPL, LGPL, MPL, CC BY-SA).
- **react-icons:** only use the sets listed under Icons in `THIRD_PARTY_NOTICES.md`, and add a row for any new set.
- **Keep the notices in sync** when licensed components change:
  - `THIRD_PARTY_NOTICES.md` (including its Services list for new online services) and `LICENSES/`
  - the license banner in `electron.vite.config.ts` (the bundler strips header comments)
  - `COMPONENTS` and `SERVICES` in `src/renderer/src/pages/About/helper.ts`, which mirror the non-npm parts of `THIRD_PARTY_NOTICES.md`
- The About page shows the AGPL's "Appropriate Legal Notices"; keep it reachable from the sidebar. Its package list comes from `LicensesService`, which walks the production dependency tree, so new dependencies need no changes there.
- Keep `"license": "MIT"` in `package.json`; it describes the repository's own code.

## CI and releases

- `ci.yml` (PRs and `main`): Prettier check, lint, typecheck and tests on Linux and Windows. Non-draft PRs, `main`, and draft PRs whose latest commit contains `[ci]` also package the app via `build-app.yml`; `chore(release): ...` commits skip packaging.
- `release.yml` runs on a `v<version>` tag matching `package.json` and attaches the packages and update files to a draft GitHub release. `scripts/release-notes` writes its notes from the Conventional Commits since the previous `v*` tag (`chore(release)` commits are skipped); a rerun keeps the draft's notes.

To release: bump `version` in `package.json`, commit, push a `v<version>` tag, then review and publish the draft (only published releases feed auto-updates and the website's download links). Keep `artifactName` in `electron-builder.yml`, the upload paths in `build-app.yml` and the website's `src/lib/release.ts` in sync.

## Website

The website (`https://tokio.ialfaro.com`, repo `tokio-app/website`, locally `../tokio-web`) has its own `AGENTS.md`. Update it when any of these change:

- features, settings, chat commands or install steps in `README.md`
- the overlay format (`info.yaml`, `OverlayConfigSchema`, the `tokio-setup` script block), the server port or hostname, or `TOKIO_EVENTS` names and payloads
- package file names (its `src/lib/release.ts` matches them)
- the Services list in `THIRD_PARTY_NOTICES.md` or the licensing

## Conventions

- Run `yarn format` on files you touch, and fix lint warnings in code you touch.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `feat!:`), enforced by a husky hook. Don't bypass hooks.
- Keep the server port (`37891`) and existing event names stable; overlays and saved data depend on them.
- Respect inline `NOTE: DO NOT CHANGE` markers.
- Inside a folder with a barrel `index` (`common/types`, `common/schemas`, `components`, `context`, `hooks`), import sibling files directly, never through the barrel, to avoid import cycles.
- `npx fallow -c .\.fallowrc.json health` (also `dead-code`, `dupes`) reports import cycles, dead code and duplication. The music window UI is an entry point in `.fallowrc.json`.
