---
paths:
  - "src/main/services/controls/**"
  - "src/main/events/pages/controls.ts"
  - "src/main/helper/shortcuts.ts"
  - "src/renderer/src/helper/accelerator.ts"
  - "src/renderer/src/components/ShortcutField/**"
  - "src/renderer/src/pages/Settings/sections/ShortcutsSection.tsx"
  - "src/renderer/src/pages/Home/sections/PausedSection.tsx"
  - "src/main/services/server/remote.ts"
  - "src/main/services/server/remote.html"
  - "src/renderer/src/pages/Settings/sections/RemoteSection.tsx"
  - "src/renderer/src/components/QRCode/**"
---

# Live controls

Skip song, stop TTS, replay the last alert and pause everything (`CONTROL_ACTIONS`). They all run through the `CONTROL` request (`src/main/events/pages/controls.ts`), which global shortcuts reach with `invoke` (AGENTS.md, IPC events). The handler parses its payload, since `invoke` callers send whatever they got.

## Actions

- Stop TTS is `clearTalk()` and `TTS_CLEAR`, always together (`.claude/rules/tts.md`).
- Skip (`MusicService.skip`) waits behind song searches as `!next` does, with no cooldown or permissions. A waiting request plays; otherwise the player's own Next runs (`MusicProvider.next`), and `endCurrent` drops the skipped request at once, since `remaining()` would notice only within `MOVED_CHECK_MS`. YouTube's Next selector is `NEXT_BUTTON` in its config: fix it there when YouTube changes. A failed Next is only logged.
- Replay sends the last LIVE event's alerts again, once each (`repeat: 1`), even with alerts off or paused: it's an explicit press. Each `dispatchAlert` call (`init.ts`) collects its payloads in one array, recorded with its first, so spoken alerts made later join their own event.
- Pause holds reactions while the music plays on (the user's call):
  - Pausing stops TTS and alerts (the same pairs as Home's switches) and drops the game backlogs (`GamesService.stopRuns`).
  - While paused, `handleChat`, `dispatchAlert` and `dispatchGames` return at once. So does the alert send callback, for a spoken alert finished after the pause came. Nothing from the pause plays later.
  - `handleChat` returns before its `else` branches: their `clearHandler()` would empty the song queue.
  - It lives in memory. `CONNECTED` clears it, so a new LIVE never starts silent.
  - Home shows it: it asks `GET_CONTROLS` on mount, since a reload mid-pause misses the `CONTROLS` push.
- No success notices: the effect is heard, and a LIVE's skips would fill the bell.

## Shortcuts

- `settings.shortcuts` holds an Electron accelerator per action, all empty by default: a global shortcut takes its keys from every app. `applyShortcuts` registers them at the first `LOAD_APP` and on `SET_SHORTCUTS`. `register` is false when another app holds one, which warns (`SHORTCUT_TAKEN`) and shows under its row.
- The recorder suspends them (`SUSPEND_SHORTCUTS`), or a combination already set would fire its action instead of reaching the field. Registrations fail while suspended, so `SET_SHORTCUTS` resumes first. Every `LOAD_APP` resumes too, so a window that died mid-recording can't leave them off. `will-quit` unregisters before its settle wait.
- `toAccelerator` takes a letter from the character its key types on the user's layout (`navigator.keyboard.getLayoutMap()`), never from where it sits on a US keyboard (`.claude/rules/app-lifecycle.md`), and a digit from the number row's key.
- What a shortcut may be:
  - F13–F24 and the media keys can stand alone: macro pads and Stream Deck hotkey actions send them.
  - Everything else needs two modifiers, one of them Ctrl (⌘ or ⌃ on macOS), so Ctrl+C, F5 or a numpad digit never stop working in other apps.
  - On Windows and Linux, Ctrl+Alt without Shift is refused: it's AltGr there, which types @ and € on Spanish layouts. So is a press with AltGr itself.
- A combination already on another row moves to the new one, since main would report the second as taken.
- MCP's `shortcuts` section checks the same rule with `shortcutProblem` (`src/main/mcp/tools/settings.ts`), since `SET_SHORTCUTS` takes any string: change it with `toAccelerator`.
- On Wayland the shortcuts go through the GlobalShortcuts portal. GNOME asks once and needs a valid app identity (`desktopName`). This hasn't been checked on a real session.

## Remote access

- **Settings → Remote control** turns on the phone page at `/remote/` and its API under `/remote/api/` (`src/main/services/server/remote.ts`). It's off by default and has one key (`settings.remote`), made on first enable and replaced by **New key**, which cuts off every device. The key is plain in the store: it's local, and safeStorage would make macOS ask for the Keychain. Never log it, and never send it to overlays or WebSocket clients.
- The overlay server listens on every interface, so the key is the API's only gate on the LAN. Every API route checks, in order: remote off → 403, then `Authorization: Bearer <key>` → 401, comparing lengths and then `timingSafeEqual` (`sameKey`, which the camera's key uses too), and refusing everything while the key is empty. The check runs before a body is parsed. No CORS headers: a page on another origin can't send the header without a preflight that fails.
- The routes are a contract (`NOTE: DO NOT CHANGE`): Stream Deck and Companion setups call `GET /remote/api/state` and `POST /remote/api/skip-song|stop-tts|replay-alert|pause` (with an optional strict `{ paused }`). Each action runs `CONTROL` through `invoke`; the state (`remoteState`) is read straight from the services. Those setups read its fields too, so a field is only ever added, never renamed or removed.
- The page shows what each key acts on (the LIVE, the song playing, whether there's an alert to replay), and a key with nothing to do is off with a line saying why. The song comes from viewers' requests: it goes in as text, and a cover loads only from an `https:` address.
- `setControlRoutes` puts the routes before the overlays' dynamic router, so they win over an installed overlay. `remote` and `mcp` are reserved ids for the same reason (`RESERVED_IDS`).
- The page keeps the key in the URL's fragment (`#key=`), never in `localStorage`: every overlay is same-origin with `/remote/`, and a browser that opened both would share the storage. Its link (`getRemoteURL`) uses this PC's IP, since a phone can't edit its hosts file for `tokio-app.local`.
- The page pauses with an explicit `{ paused }`, so two phones pressing at once can't undo each other; the API still toggles without a body.
- The page's requests give up after 5 s with `AbortController` and `setTimeout` (`AbortSignal.timeout` misses older iPhones), and its 3 s poll skips while a state request is still out. A pressed key waits with `aria-disabled`, not `disabled`, so a keyboard user keeps the focus. The Pause key has no `aria-pressed`: its label already changes to **Resume**. Its LIVE shows as `handleOf` on Home does (a value with `/` as typed); the API's `live` stays raw.
- Settings hides the QR code and the key until **Show**, since streamers show their screen. The QR is drawn black on white in any theme, for phone cameras.
- Tokio's logo covers the QR's middle. Error correction Q lets it, and every IPv4 link fits version 5 or 6, whose only alignment pattern sits in a corner (`QRCode`'s test checks the shortest and longest). A longer link, such as one with a hostname, reaches version 7, which has an alignment pattern right under the logo.
