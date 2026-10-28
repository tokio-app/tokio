---
paths:
  - "src/main/services/timer/**"
  - "src/main/services/server/timer.html"
  - "src/common/schemas/timer.ts"
  - "src/common/types/timer.ts"
  - "src/renderer/src/pages/Tools/**"
---

# Countdown timer

A subathon clock that viewers add time to. `TimerService` (`src/main/services/timer`) holds the active profile's timer, its overlay is served at `/timer/` (`TIMER_PATH`), and **Tools** drives it.

## Clock

- Statuses (`TIMER_STATUSES`): `idle` shows the starting time and follows `start`; `running` counts down; `paused` holds and still takes time from live events; `stopped` holds and takes none, after Stop or reaching 0.
- Time is `performance.now()`: `_endsAt` while running, `_remaining` otherwise.
  - The end is a `setTimeout` capped at `MAX_TIMEOUT_MS` (2³¹−1 ms), scheduled again when it fires early.
  - `_settle()` ends an overdue clock first in every method, so a gift right after 0 can't bring it back.
- `adjust(ms)` (Add and Remove, not while idle) is exact, without the multiplier. Removing down to 0 while running ends the clock.
- `cap` (minutes) stops added time, from events or Add, at that much on the clock. It never cuts time already there, or the starting time.
- The clock is clamped to `Number.MAX_SAFE_INTEGER` ms, so an absurd multiplier or Adjust can't make it `Infinity`, which can't save.

## Triggers

- `TIMER_EVENTS` turns each live event into seconds × `multiplier`, kept in ms.
- Gifts go through a `GiftStreaks` even while the clock doesn't count, so a streak begun before Start adds only what comes after. Coins are `added × max(0, coins)`, as `LiveService` counts them.
- Chat adds time only for messages with `chat.keyword` (`hasKeyword`, like chat alerts), once per viewer (by handle) in `chat.cooldown` seconds. A message without the keyword doesn't start the cooldown.
- There are no join, envelope or Super Fan box triggers: a Super Fan box comes with a new Super Fan, which already counts.
- `disconnected()` forgets the cooldowns and the streaks, and pauses a running clock when `pause_on_end` is on. `registerTimer` then sends `TIMER_PAUSED`.

## Saving

- Each profile has its own timer (`Profile.timer`, `TimerProfileSchema`, `.prefault({})` so older profiles load). `load(timer, file)` turns `running` into `paused`.
- `save()` writes into the profile the timer was loaded from, with `updateProfileData(updates, file)`. It takes the snapshot and the file before any `await`, so a save racing a profile switch can't land in the new profile. It returns true when nothing is loaded.
- When it saves:
  - The handlers save after each change, and throw `saveFailure()` when that fails.
  - An unref'd `SAVE_INTERVAL_MS` interval saves while running, or after a change no request saves: added time, the end, a pause on disconnect.
  - Never on quit (`shortcut:`): that would hold the quit the updater's install can't wait for (`.claude/rules/updates.md`). A quit or crash while running loses up to `SAVE_INTERVAL_MS`.
- `SET_PROFILE` saves the timer first and refuses the switch when that fails, then loads the new profile's timer. Picking the profile that's already active does nothing, even during a LIVE.

## Pushes and the overlay

- `onChange(deltaMs)` feeds `registerTimer` (`src/main/events/init.ts`). `added` sums the deltas, sent through a no-argument `throttle` that reads `timer.get()` when it fires, so a late push never sends an old time.
- The window gets `TIMER` (`{ settings, state, added }`), and the overlay's clients get `tokio:timer` (`{ status, remaining, added, multiplier, look, triggers }`). A client connecting with the id `timer` gets the state from `ServerService.onConnect`, with `added: 0`.
- `triggers` are the carousel's items, `[]` while `look.show_triggers` is off. `timerTriggers(settings, language)` (`src/common/util/timer.ts`) builds them for main and the Tools preview alike; triggers that add nothing are left out.
- The names (`look.names`) default to `""`, the app language's name (`timer.names.*`), which Tools shows as each field's placeholder. A saved name equal to its old English default reads as `""`. Main sends the overlay again when the language changes.
- **The font:** `timer.html` is served from memory, with Archivo inlined as a `data:` URL. Main imports the woff2 with `?inline`, which works only because `@fontsource-variable/archivo` is in main's `externalizeDeps.exclude` (`electron.vite.config.ts`). `packaging.test.ts` skips query imports.
- **Drawing:** the page anchors `remaining` to `performance.now()` and redraws every 250 ms. Sizes follow `--size`, times `--fit`, which shrinks everything when a wide font or a wrapped title wouldn't fit.
  - The halo is set on each text, since `em` in a `text-shadow` set on `body` resolves against the body's 16px.
  - The title wraps instead of clipping, which would cut its halo into a box.
  - The carousel is one line that a long name cuts short. The padding inside its clipping box, taken back by negative margins, keeps the halo from being cut into a box.
- The slot under the clock shows `×N` or `added`, summed until `LABEL_MS` after the last change. Times read like `formatAdded` (`src/common/util/timer.ts`), which the page's `changeText` repeats in plain JS.
- The Tools preview (`TimerPreview`, `SLOT_MS`, `TURN_MS`) does the same as the slot and the carousel, so keep the two in step.
- **Fonts and colors:** a font goes in with `style.fontFamily = JSON.stringify(name.trim())` plus the fallbacks. It's one CSSOM property, so a name can't add styles. Colors are CSS variables, which the schema keeps to hex.

## Tools page

- Timer look comes right after the preview, colors first, so its changes show while they're made.
- One `useAutosave(timer.settings)` feeds the three timer sections, nested fields through immer's `produce`. Its delay keys on `prevSaved`, so main's pushes (a new but equal `settings` every 250 ms on a busy LIVE) don't keep restarting it.
- The controls call `flushSettings()` before `TIMER_CONTROL` or `ADJUST_TIMER`, so a setting still waiting to save, like the starting time, reaches main first.
- The preview counts down from the last push's `at`, ticking only while running. While idle, it shows the starting time as typed.
