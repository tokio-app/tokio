---
paths:
  - "src/main/services/timer/**"
  - "src/main/services/server/timer.html"
  - "src/common/schemas/timer.ts"
  - "src/common/types/timer.ts"
  - "src/renderer/src/pages/CountdownTimer/**"
  - "src/renderer/src/pages/Tools/**"
---

# Countdown

A subathon clock that viewers add time to. `TimerService` (`src/main/services/timer`) holds the active profile's timer, its overlay is served at `/timer/` (`TIMER_PATH`), and **Tools → Countdown** drives it.

## Clock

- Statuses (`TIMER_STATUSES`): `idle` shows the starting time and follows `start`; `running` counts down; `paused` holds and still takes time from live events; `stopped` holds and takes none, after Stop or reaching 0.
- Time is `performance.now()`: `_endsAt` while running, `_remaining` otherwise.
  - The end is a `setTimeout` capped at `MAX_TIMEOUT_MS` (2³¹−1 ms, the platform's limit), scheduled again when it fires early.
  - `_settle()` ends an overdue clock first in every method, so a gift right after 0 can't bring it back.
- `adjust(ms)` (Add and Remove, not while idle) is exact, without the multiplier. Removing down to 0 while running ends the clock.
- `cap` (minutes) stops added time, from events or Add, at that much on the clock. It never cuts time already there, or the starting time.
- The clock is clamped to `Number.MAX_SAFE_INTEGER` ms, so an absurd multiplier or Adjust can't make it `Infinity`, which can't save.

## Triggers

- `TIMER_EVENTS` turns each live event into seconds × `multiplier`, kept in ms.
- Gifts go through a `GiftStreaks` even while the clock doesn't count, so a streak begun before Start adds only what comes after. Coins are `added × max(0, coins)`, as `LiveService` counts them.
- Chat adds time only for messages with `chat.keyword` (`hasKeyword`, like chat alerts), once per viewer (by handle) in `chat.cooldown` seconds. A message without the keyword doesn't start the cooldown.
- There are no join, envelope or Super Fan box triggers: a Super Fan box comes with a new Super Fan, which already counts.
- `disconnected()` forgets the cooldowns and the streaks, and pauses a running clock when `pause_on_end` is on.

## Saving

- Each profile has its own timer (`Profile.timer`, `TimerProfileSchema`, `.prefault({})` so older profiles load). `load(timer, file)` turns `running` into `paused`. It holds the profile's data in memory as Persistence in `AGENTS.md` describes.
- The handlers save after each change and throw `saveFailure()` when that fails. The interval saves while running, or after a change no request saves: added time, the end, a pause on disconnect. A failed one warns once per `REPEAT_NOTICE_MS` (`TIMER_SAVE_FAILED`, key `timer`).
- Never on quit: that would hold the quit the updater's install can't wait for (`.claude/rules/updates.md`).
- `SET_PROFILE` switches run one at a time, and the profile lock is checked again after the saves, so a LIVE that connected meanwhile refuses the switch (`PROFILE_LOCKED`). Picking the profile that's already active does nothing, even during a LIVE.

## Pushes and the overlay

- `added` sums `onChange`'s deltas, sent through a no-argument `throttle` that reads `timer.get()` when it fires, so a late push never sends an old time.
- The window gets `TIMER` (`{ settings, state, added }`), and the overlay's clients get `tokio:timer` (`{ status, remaining, added, multiplier, look, triggers }`). A client connecting with the id `timer` gets the state from `ServerService.onConnect`, with `added: 0`.
- `triggers` are the carousel's items, `[]` while `look.show_triggers` is off. `timerTriggers(settings, language)` (`src/common/util/timer.ts`) builds them for main and the page's preview alike.
- The names (`look.names`) default to `""`, the app language's name (`timer.names.*`). A saved name equal to its old English default reads as `""`. Main sends the overlay again when the language changes.
- `timer.html` inlines Archivo as a `data:` URL: main imports the woff2 with `?inline`, which needs `@fontsource-variable/archivo` in main's `externalizeDeps.exclude`.
- The page anchors `remaining` to `performance.now()`. `--fit` shrinks everything when a wide font or a wrapped title wouldn't fit.
  - The halo is set on each text, since `em` in a `text-shadow` set on `body` resolves against the body's 16px.
  - The title wraps instead of clipping, which would cut its halo into a box.
  - The carousel is one line that a long name cuts short. The padding inside its clipping box, taken back by negative margins, keeps the halo from being cut into a box.
- The slot under the clock shows `×N` or `added`, summed until `LABEL_MS` after the last change. Times read like `formatAdded` (`src/common/util/timer.ts`), which the page's `changeText` repeats in plain JS: keep them in step.
- The page's preview (`TimerPreview`, `SLOT_MS`, `TURN_MS`) repeats the slot and the carousel, so keep the two in step. Its `bare` is for an embed in Overlay Studio's editor.

## The page

- One `useAutosave(timer.settings)` feeds the three timer sections. Its delay keys on `prevSaved`, so main's pushes (a new but equal `settings` every 250 ms on a busy LIVE) don't keep restarting it.
- The controls call `flushSettings()` before `TIMER_CONTROL` or `ADJUST_TIMER`, so a setting still waiting to save, like the starting time, reaches main first.
- The preview and Tools' timer row count down from the last push's `at` (`timeLeft`, `helper.ts`), ticking only while running. While idle, the preview shows the starting time as typed.
