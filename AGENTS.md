# AGENTS.md

## Project

Tokio is an Electron desktop app for Windows, macOS and Linux that connects to a TikTok LIVE, a Twitch stream, a YouTube LIVE and a Kick stream, any of them at once, and reacts to their events with text-to-speech, music requests (Spotify/YouTube), alerts (sounds, images and videos), game actions (Minecraft commands), and browser-source overlays served over a local HTTP/WebSocket server.

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
- `src/preload/`: the typed `window.api.emit` / `window.api.on` bridge. The windows are sandboxed, so it builds as CommonJS (`out/preload/index.cjs`) and can load only `electron` at runtime; anything else it imports must be bundled, like `src/common`.
- `src/renderer/`: main React UI (pages, components, contexts, router)
- `src/music/`: separate music window UI, built as a single file into `music-out/`
- `src/common/`: shared by both processes (Zod schemas, event types, constants, utils, the locale files in `src/common/i18n`). It must not import from `src/main` or `src/renderer`, and must stay free of Node/Electron-only APIs if the renderer uses it.
- `src/ui/`: web-only code shared by the main and music windows (design tokens, base CSS, `TitleBar`)
- `test/`: Vitest setup, fakes, helpers and fixtures; `e2e/`: Playwright tests of the built app
- `scripts/`: repo maintenance scripts (`edge-tts`, `release-notes`)
- `LICENSES/`, `THIRD_PARTY_NOTICES.md`: third-party license texts and notices, shipped to the app's `resources/licenses`
- `build/`: the app icons electron-builder uses

Generated, don't edit: `out/`, `music-out/`, `dist/`.

- The packaged app holds only `out/`, `music-out/`, `resources/` and the production dependencies (`files` in `electron-builder.yml`), so a file the app reads at runtime must live in one of them.
- Packages only the windows import are bundled by Vite and ship only their `package.json` and license files (the `!node_modules/{…}` pattern in `files`, see the `add-dependency` skill). `src/main/packaging.test.ts` fails when `src/main` or `src/common` reaches one, even through a dependency. It skips main's query imports (`?raw`, `?inline`, `?script`), whose build rules are in `.claude/rules/served-pages.md`.

## Path aliases

- Main process: `@/*` → `src/main/*`, `@/common/*` → `src/common/*`
- Renderer: `@/*` (preferred) and `@renderer/*` → `src/renderer/src/*`, plus `@/common/*` and `@/ui/*` → `src/ui/*`
- Music window: `@/common/*` and `@/ui/*` only.
- Tests: their process's aliases, plus `@test/*` → `test/main/*` or `test/renderer/*`.

## Topic rules

Notes for one area live in `.claude/rules/`. Claude Code loads each one when it reads or edits a file its `paths` match; read one directly when planning across areas.

**Other agents:** these rules don't load on their own. Before you read or edit files a rule's `paths` match, read that rule.

- `testing.md`: Vitest and Playwright setup, fakes and helpers
- `renderer.md`: pages, components, the look, keyboard, media elements and the CSP
- `renderer-state.md`: profile autosaves, `useAutosave` and `AudioQueue`
- `first-start.md`: the first-start dialog and the tour
- `i18n.md`: the locale files, translating in the windows and main, and the language setting
- `app-lifecycle.md`: single instance, tray, windows and quitting
- `logging.md`: the log files, what goes at which level, Detailed logs and the export
- `store.md`: the store, the profile files and profile switches
- `ci.md`: CI, packaging and releases
- `updates.md`: the auto-updater
- `platforms.md`: several platforms in one LIVE session, each one's money, namespaced ids and what the window shows per platform
- `connector.md`: TikTok's connector and its key
- `twitch.md`: Twitch's provider and its sign-in
- `youtube.md`: YouTube's provider, read from its public pages
- `kick.md`: Kick's provider, its API and chat feed
- `live-session.md`: the LIVE session and Home: its tabs, numbers and activity feed
- `controls.md`: the live controls (skip song, stop TTS, replay alert, pause), their global shortcuts and the phone remote
- `mcp.md`: the MCP server at `/mcp`, its tools and what it must never expose
- `tts.md`: TTS engines and chat TTS
- `music.md`: music requests and YouTube's ad blocker
- `translation.md`: chat translation, its pipe and the commands it leaves as typed
- `triggers.md`: the trigger rows alerts, game actions and Overlay Studio share
- `alerts.md`: alerts' gifts, sounds, media, cuts and spoken alerts
- `games.md`: the Games page, game actions and their runs
- `minecraft-connection.md`: the Minecraft socket and its protocol, both editions
- `minecraft-commands.md`: the commands game actions send: mobs, hazards and helps
- `games-overlay.md`: the games overlay and the Minecraft pictures library
- `overlays.md`: overlay previews, imports, official overlays and the overlays repo
- `timer.md`: the countdown timer, its overlay and its page in Tools
- `fans.md`: the fans each profile keeps, sent to overlays and listed in Tools → Fans
- `history.md`: each profile's past LIVEs and gifters, LIVE history in Tools, and the top gifters overlays get
- `studio.md`: Overlay Studio's data, reactions and live numbers
- `studio-stage.md`: the stage that draws Overlay Studio's overlays, on stream and in the editor
- `studio-camera.md`: Overlay Studio's cameras, from capture to the page
- `studio-editor.md`: Overlay Studio's editor
- `served-pages.md`: what every page the overlay server serves itself must follow

A rule holds what its reader can't get quickly from the code: the user's calls, marked "(the user's call)"; gotchas, with the reason the obvious way breaks; contracts that other code, saved data or other repos depend on; and couplings between files. It leaves out what reading the code shows, history, and what AGENTS.md or another rule already says. When a change alters what a rule says, update the rule with it. A new area gets its own rule with `paths`.

## Skills

Procedures live in `.claude/skills/<name>/SKILL.md`. Claude Code offers each one as `/<name>` and loads it when a task matches its description.

**Other agents:** before doing one of these tasks, read its `SKILL.md`.

- `release`: publish a version, only when the user asks
- `verify`: run the checks a change needs
- `sync-docs`: update the docs and the other repos a change affects
- `optimize-docs`: measure, audit and trim the agent docs
- `drive-app`: launch the built app to check a change or take screenshots
- `add-dependency`: add, upgrade or remove a package, with the license checks
- `live-event`: add or change a LIVE event (TikTok's or another platform's) end to end
- `ipc-event`: add an IPC request, reply or push, with its tests
- `new-page`: add a page to the main window
- `minecraft-lists`: regenerate the Minecraft mob and item lists
- `frontend-design`: the visual direction for new or reshaped UI (Anthropic's skill, Apache-2.0, vendored as published)
- `modern-web-guidance`: current HTML, CSS and browser APIs, with Tokio's browser targets (GoogleChrome v1.0.2, Apache-2.0, guides vendored as published). It reads them from its folder: never run its CLI, which reports usage to Google.
- `humanizer`: rewrite UI text, translations and docs that read as AI-written (blader/humanizer v3.1.0, MIT, vendored as published)

When a procedure changes, update its skill with it.

## Architecture

### Languages

Tokio is in English and Spanish, following the system's language unless **Settings → Language** picks one (`.claude/rules/i18n.md`).

- Every text the user or the stream sees comes from `src/common/i18n/locales/<tag>.json`. A new language is one new file there; `yarn test` checks it against `en.json`.
- The windows use `useT()` (`@/ui/i18n`), main uses `t()` (`@/helper/i18n`), and helpers that write text take the `language`. Logs stay English.
- `react/jsx-no-literals` (`.oxlintrc.json`) fails lint on text written into the windows' JSX or text props.
- UI text and translations go through the `humanizer` skill.

### Services (main process)

- Each service lives in `src/main/services/<name>/index.ts` and extends `Service` (or `ProviderService<T>`) from `src/main/services/shared`. It's created once in `src/main/index.ts`, added to `AppServices` (`src/main/types`) and injected into `AppHandler`.
- Swappable backends (TikTok's connector, TTS, music) use providers: `addProvider(name, provider, start?)` / `setProvider(name, key?)` (without a key the provider keeps its own; `""` clears it). Providers live in `services/<name>/providers/<provider>/` with `common/` and `config/` subfolders. Each service starts a provider in its constructor, so `_current` is always set. TTS uses every provider at once, as engines (`.claude/rules/tts.md`).
- Classes that send live events to listeners (`MusicProvider` in `services/music/common`, `MusicQueue`, `ConnectorProvider`) extend `TokioEmitter` (`services/shared/emitter`): a typed `on`/`off` and a protected `emit`.
- Log through `Logger` (`@/logger`) with the service's `_logFile` and a `<ServiceName>` prefix, e.g. ``Logger.error(`<Connector> ...`, this._logFile)``. Format errors with `formatError` from `@/common/util`. Routine traffic goes to `Logger.debug`, which only Detailed logs writes (`.claude/rules/logging.md`).
- Fallible service methods return `ServiceResult<T>` (`{ success, error?, data? }`, in `services/shared`) instead of throwing.

### IPC events

All renderer ↔ main communication is typed. The `ipc-event` skill has the steps and the code shapes.

- Requests go in `APP_EVENTS` and `AppEventsMap` (`src/common/types/events/req.ts`), named `app:<area>:<action>`. Replies and pushes go in `APP_EVENTS_RESPONSE` and `AppEventsResponseMap` (`res.ts`).
- Handlers live in `src/main/events/pages/<page>.ts`, registered with `events.push(event, handler, options)`. Don't wrap them in try/catch; throw and let `options` handle it (see Feedback). A new page stack goes in `mergeStacks` (`src/main/events/index.ts`).
- `invoke(event, data)` (in the handler variables) runs a request's handler in main as if the window had sent it, so global shortcuts, the remote's API and MCP get the UI's checks, saving and notices. Handlers only call `e.reply`. Each reply also reaches the main window, except `PRIVATE_REPLIES` (`src/main/helper/events.ts`): a page would take those as the answer to its own request.
- The renderer sends with `window.api.emit` and listens with the `useIpcRequest` / `useIpcListener` hooks. Main pushes without a request with `win.webContents.send(APP_EVENTS_RESPONSE.Y, data)`; a `void` response still needs `undefined` as payload.
- Handlers open file dialogs with `showOpenDialog` / `showSaveDialog` from `@/helper/dialog`, which start in the last folder used. Electron's own start in Downloads.
- A request about one item (an overlay, a document, a test) gets its id back in the reply, failures included, so the renderer ignores a late reply for another one (see `GET_OVERLAY_CONFIG`).

Live stream events (`TOKIO_EVENTS` / `TokioEventMap`) come from the connector, which runs one LIVE session across the profile's platforms (`ConnectorService`, `.claude/rules/platforms.md`). `ServerService` forwards them to overlays over WebSocket, and they drive TTS, music requests, alerts and game actions. The `live-event` skill adds or changes one.

### Feedback

Main tells the renderer what failed so it can show notifications. Types are in `src/common/types/feedback.ts`, helpers in `src/main/helper/feedback.ts` and `src/main/helper/events.ts`.

- Replies use `Reply<{ ... }>`, which adds `error?: AppError` (`{ code: FEEDBACK_CODES, message }`). The message is plain text for the user, in their language (`t()`); details go only to the logs, in English.
- `createStack(source)` sets the `FeedbackSource` (and log file) of a page's handlers.
- `push` options: `failure` (`{ code, message }` for unexpected throws, its message a locale key that `runEvent` translates when it reports), `onError(e, error, data, services)` to send the failure reply (`replyFailure(APP_EVENTS_RESPONSE.X)` for a plain `{ success: false, error }`), `notify: false` when the page already shows the failure or for status probes, and `source` to override the stack's.
- Throw `new AppFailure(code, message, { level: "warning", cause })` for an expected failure with its own message or level. A canceled dialog is not a failure: just `return`.
- Log failures once. If a service already logged it, throw `new LoggedError(res.error)` or pass `{ logged: true }` to `AppFailure`. A warning is logged only with a `cause`.
- A store mutator that returns false couldn't write the store file (`JSONManagerService` logged why): send the reply that shows what main holds, then throw `saveFailure()` (`SETTINGS_SAVE_FAILED`), with no success notice.
- `notifier` (in the handler's services) pushes `APP_EVENTS_RESPONSE.NOTIFY`. `report({ source, error, fallback })` logs and notifies; `error/warn/info/success(source, code, message, { key, windowMs })` sends a notice. Repeated warnings and errors are dropped within `windowMs` (`DEDUPE_MS` by default).
- User actions that change something call `notifier.success(...)` after the reply. Reads, status checks, tests, autosaves (TTS, music, alerts, the keys in Settings) and controls whose state the UI already shows (Home's feature switches) send nothing.
- Success codes are past tense (`PROFILE_CREATED`); failures end in `_FAILED`.
- Background failures (TTS, music playback, missing alert sounds, gifts, server port, reconnects, LIVE ending, game actions) are reported from `src/main/events/init.ts` through service callbacks; services don't know about the notifier. One that can repeat on every live event gets a longer `windowMs`, and its service doesn't log it: `init.ts` logs it only when its notice goes out, so the window limits the log too.
- The renderer shows notices via `NotificationsProvider` (mounted above `AppProvider`, since load-time notices arrive before the splash closes): `Toasts` and the title bar's `NotificationBell`. Pages don't show notices themselves.

### Persistence

- Settings and profiles are validated with the Zod schemas in `src/common/schemas` and persisted by `StoreManagerService` (`.claude/rules/store.md`).
- When you change a schema, update its defaults in `src/common/util/constants`. Give every new saved field a `.default(...)` so older files still load.
- `updateProfileData` throws until the store has loaded. It writes the active profile unless given a file.
- What a profile collects that isn't settings, like its fans or its LIVEs, goes in its own file or folder named after the profile's (`fans/<profile file>`, `history/<profile file without .json>/`), so a rename moves nothing: exports, clones and `GET_PROFILE` carry the whole profile.
- Services that hold a profile's data in memory (the countdown timer, fans, history) take the file and the data before any `await`, so a save racing a profile switch lands in the file the data came from (the timer passes it to `updateProfileData`). They save on an interval and before a `SET_PROFILE` switch, which a failed save refuses, and never on quit (`shortcut:`): a quit or crash loses up to one interval. A later `load` wins over one still reading.
- Provider keys (the Euler key, voice engine keys, Twitch's refresh token) are saved encrypted with `safeStorage`'s async calls. The store decrypts them once at startup and reads them from memory, so `getSettings` stays synchronous. Never log a provider key, and never ship a shared one.
- Quitting waits up to 3s for IPC handlers and file writes still running (`track`/`settle`, `src/main/helper/quit.ts`, `.claude/rules/app-lifecycle.md`).
- Write files through `writeFileAtomic` (`src/main/helper/fs.ts`) or the file managers, so a quit waits for them and a quit or crash midway leaves the old file whole. `writeFileAtomic` flushes the temp file to disk before the rename, so a power cut can't leave a file of NULs, and runs writes to one file in the order they came.

## Licensing

Tokio's source is MIT; treat license compliance as part of every change.

- **LGPL code stays isolated.** `src/main/services/tts/providers/edge/common/drm-v2.ts` is LGPL-3.0-only (derived from edge-tts). Code ported from edge-tts goes only into its own LGPL file with the same header (SPDX line, upstream commit, authors, dated modification notice). Never copy upstream code into MIT files.
- **The distributed app is MIT too**, with that one LGPL file and the Archivo font files (`@fontsource-variable/archivo`). The font stays under the SIL OFL 1.1, which the user approved: it allows bundling with any software. Keep it that way: no other copyleft dependency, and no code from `tiktok-live-connector` 2.4.1 or later or `tiktok-live-proto` 0.2.4 or later (AGPL). Twitch connects through its official API with each user's own sign-in, YouTube by reading a LIVE's public chat the way youtube.com does, and Kick by reading its website API and chat feed the way kick.com's page does, with an honest User-Agent. No code is copied from any Twitch, YouTube or Kick library: read only MIT, BSD or Apache ones as references.
- **The ad blocker's filter lists are other authors' data under the GPL-3.0 or CC BY-SA.** Each user's Tokio downloads them at runtime (`@tokioapp/adblock`, ours, MIT). Never ship them in the app, bundle a copy for a first start, or commit them.
- **Check licenses when adding or upgrading a dependency**, even minor bumps (tiktok-live-connector went MIT → AGPL in 2.4.1), with the `add-dependency` skill. Ask before adding anything copyleft (GPL, AGPL, LGPL, MPL, CC BY-SA).
- **react-icons:** only use the sets listed under Icons in `THIRD_PARTY_NOTICES.md`, and add a row for any new set.
- **Keep the notices in sync** when licensed components or online services change: `THIRD_PARTY_NOTICES.md` and `LICENSES/`, the license banner in `electron.vite.config.ts` (the bundler strips header comments), and `COMPONENTS` and `SERVICES` in `src/renderer/src/pages/About/helper.ts`, which mirror the non-npm parts of `THIRD_PARTY_NOTICES.md`. `src/renderer/src/pages/About/notices.test.ts` fails when they drift; the `add-dependency` skill says what each change needs.
- The About page shows the license notices; keep it reachable from the sidebar.
- The MCP server SDK (`@modelcontextprotocol/server`) is Apache-2.0, with MIT for older contributions, and compiles other packages into its files. Their licenses are in `LICENSES/MCP-SDK-bundled.txt`, which an upgrade must update (the `add-dependency` skill).
- Keep `"license": "MIT"` in `package.json`; it describes the repository's own code.

## CI and releases

- `ci.yml` runs Prettier, lint, typecheck and the tests on Linux, Windows and macOS, and the e2e tests; on pull requests, `commitlint` checks every commit message. Non-draft PRs, `main`, and draft PRs whose latest commit contains `[ci]` also package the app. The rest is in `.claude/rules/ci.md`.
- To release, use the `release` skill (`/release`). A release reaches auto-updates as soon as the workflow publishes it.

## Website

The website (`https://tokio.ialfaro.com`, repo `tokio-app/website`, locally `../tokio-web`) has its own `AGENTS.md`. Update it, in English and Spanish (the `sync-docs` skill says where), when any of these change:

- features, settings, the platforms Tokio connects to and their setup, chat commands or install steps (its docs describe them in full; the README only sums them up)
- the overlay format (`info.yaml`, `OverlayConfigSchema`, the `tokio-setup` script block), the server port or hostname, `TOKIO_EVENTS` names and payloads (including `platform` on users and gifters), or the other messages overlays get (`TokioPayload`)
- the URL or behavior of Tokio's own overlays: the alerts' (`getAlertOverlayURL`), the countdown timer's (`TIMER_PATH`), Minecraft's (`getMinecraftOverlayURL`) and Overlay Studio's (`getStudioOverlayURL`), the phone remote's page and API (`getRemoteURL`, `/remote/api/*`), and the MCP server's address and tools (`MCP_URL`)
- package file names (its `src/lib/release.ts` matches them)
- the Services list in `THIRD_PARTY_NOTICES.md` or the licensing

## Other repos

Each has its own `AGENTS.md`, and the `sync-docs` skill says what a change needs there.

- The official overlays, `tokio-app/overlays` (`../tokio-overlays`): their schema copy and catalog are in `.claude/rules/overlays.md`.
- The Tokio mod, `tokio-app/minecraft-mod` (`../tokio-minecraft-mod`), Java Edition's way in: its `PROTOCOL.md` is in `.claude/rules/minecraft-connection.md`.
- The overlay SDK, `@tokioapp/overlay` (`../tokio-event-loader`): the `live-event` skill.
- The TikTok connector, `@tokioapp/connector` (`../tokio-connector`): `.claude/rules/connector.md`.
- The ad blocker, `@tokioapp/adblock` (`../tokio-adblock`): `.claude/rules/music.md`.

## Conventions

- Run `yarn format` on files you touch, and fix lint warnings in code you touch.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/) (`feat:`, `fix:`, `feat!:`), enforced by a husky hook and by CI on pull requests. Don't bypass hooks.
- Keep a commit's subject under 100 characters and wrap its body at 72 columns. CI's commitlint fails a pull request on any longer line (`header-max-length`, `body-max-line-length`).
  - The hook doesn't run on `git cherry-pick`, nor in a checkout installed with `--ignore-scripts` until `npx husky` runs there.
  - So check a branch with `npx commitlint --from <base> --to HEAD` before pushing it.
- Pull requests: a Conventional Commits title, which is their line in the release notes, and the sections of `.github/pull_request_template.md`. Merge them with a merge commit, not a squash or rebase: the notes find pull requests by it (`.claude/rules/ci.md`).
- Keep these stable; overlays, browser sources and saved data depend on them:
  - the server port (`37891`), the Minecraft port (`MINECRAFT_PORT`, 37892) and its Java subprotocol (`MINECRAFT_JAVA_PROTOCOL`, `tokio.java.v1`)
  - the alerts' overlay path (`/alerts/<alert id>/`), the countdown timer's (`/timer/`), Minecraft's overlay (`/games/minecraft/` and `/games/minecraft/<column>/`, its pictures under `/games/minecraft/pictures/`), Overlay Studio's (`/studio/<id>/`, socket id `studio:<id>`), the phone remote's (`/remote/`) and its API's routes (`/remote/api/state`, `/remote/api/<action>`), which Stream Deck setups call, and the MCP server's (`/mcp`)
  - existing event names
- The overlay server listens on every network interface on purpose, for streaming apps on other computers (`tokio-app.local`, `REMOTE_SOCKET`, see `.claude/rules/overlays.md`). Don't bind it to loopback or add Host/Origin checks. The Minecraft socket is the exception (`.claude/rules/minecraft-connection.md`). The remote's API is gated by its key instead (`.claude/rules/controls.md`), and `/mcp` also answers only on loopback and refuses an `Origin` (`.claude/rules/mcp.md`).
- Respect inline `NOTE: DO NOT CHANGE` markers.
- A new setting or action users have needs its MCP section field, kind or tool, with a test (`.claude/rules/mcp.md`).
- Inside a folder with a barrel `index` (`common/types`, `common/schemas`, `components`, `context`, `hooks`), import sibling files directly, never through the barrel, to avoid import cycles.
- `npx fallow health` (also `dead-code`, `dupes`) reports import cycles, dead code and duplication. `.fallowrc.json` makes the music window UI an entry point.
