---
paths:
  - "**/*.test.ts"
  - "**/*.test.tsx"
  - "**/*.test.js"
  - "test/**"
  - "e2e/**"
  - "vitest.config.ts"
  - "playwright.config.ts"
---

# Tests

- Vitest runs in Node, without Electron or network, in two projects: `main` (`src/main`, `src/common`, `src/preload` and the scripts' `*.test.js`) and `renderer` (jsdom with Testing Library: `src/renderer`, `src/ui`, `src/music`). Tests sit next to the code as `<file>.test.ts(x)`.
- Fixtures live in `test/fixtures`; Prettier skips them so saved HTML keeps its markup.
- `restoreMocks` only restores spies. `vi.fn` mocks keep their calls and implementation, so create them in each test.
- `it.fails` marks a known bug. Turn it into `it` when the bug is fixed.

## Main process

- `test/setup.ts` mocks `electron` with the fakes in `test/main/electron.ts` (import them from `@test/electron`) and resets them before each test: windows, views and webContents that record what they get, `ipcMain`, `app`, `session`, `protocol`, `shell`, `dialog`, `net` and a `safeStorage` that round-trips text with the `v10` prefix Chromium adds (a saved key without it is read as plain text). Their state survives `vi.resetModules()`.
- The setup also silences the console, and Logger only writes to absolute paths, so tests can name log files `"system.log"`. Spy on `Logger` to assert logs; after `vi.resetModules()`, on the copy the re-imported code got.
- Test IPC handlers with `createHandler(stubs)` from `@test/handler`: the services the handler uses as partial stubs (anything else it reaches for fails the test), fake windows and a real `Notifier`.
  - `invoke(stack, APP_EVENTS.X, data)` runs a page's handler as the Handler does. Read `replies(channel)`, `pushed(channel)`, `notices`, or `sent()` for all of them in order.
  - `eventSource()` stands in for the live events of the connector and the music service.
- Give services a temp folder (`mkdtemp(join(tmpdir(), "tokio-test-"))`) through their setters or `initialize`, stub `fetch` with `vi.stubGlobal`, and use fake timers for the queues.

## Renderer

- Each test gets a fresh fake `window.api` (`test/renderer/setup.ts`). `send` from `@test/ipc` pushes a reply from main inside `act` (await it). `sent(event)` lists the payloads the renderer emitted for an event, and `sentEvents()` the events in order.
- Render with `renderWithProviders` (`@test/render`), which adds fake audio queues, the real notifications and unsaved-changes providers, and a `user`. Pages that navigate use `renderApp(path)`: the real routes in memory history.
  - Components never reach Tone.js; `audio.queue(name)` is the fake queue they got.
  - Builders and replies are in `@test/fixtures`.
  - Entry points (`main.tsx`) run with `runEntry` from `@test/entry`, which gives them the `#root` their `index.html` has.
- jsdom has no layout. `test/renderer/dom.ts` gives elements a size (virtualized lists like `Select` render nothing at zero), fakes the observers (`intersect()` fires `IntersectionObserver`) and `scrollTo`.
- A `jest` shim lets Testing Library run with `vi.useFakeTimers()`; give user-event `advanceTimers: (ms) => vi.advanceTimersByTime(ms)`.
- Query by role and visible text. `Field` (and `SettingField`) names a group after its label, not the control: use `within(getByRole("group", { name }))` or placeholders. `Select` is a clickable div whose list is portaled to the body, so use placeholders, text or `within` there. `@test/queries` has `inList` (an item of a portaled list) and `section` (queries inside a section, by its heading).
- Mock `copy-to-clipboard` and spy on `window.open`.

## End to end

- `e2e/` drives the built app with Playwright's `_electron`. It runs in a temporary folder that main reads from `TOKIO_HOME`, setting `home` and `userData`, and answers native dialogs from main with `electronApp.evaluate`. The single-instance lock follows `userData`, so a run doesn't clash with an open Tokio (port 37891 aside).
- Built pages carry the production CSP as a meta tag. Check it with an inline script: what Playwright evaluates goes through DevTools, which skips the CSP's `eval` check.
