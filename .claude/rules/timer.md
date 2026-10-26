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

- Statuses (`TIMER_STATUSES`):
  - `idle` shows the starting time and follows `start`.
  - `running` counts down.
  - `paused` holds and still takes time from live events.
  - `stopped` holds and takes none, after Stop or reaching 0.
- `control(action)` ignores actions that don't apply (Start at 0, Pause when not running). Reset (`idle`) forgets the like remainder and the cooldowns.
- Time is `performance.now()`: `_endsAt` while running, `_remaining` otherwise.
  - The end is a `setTimeout` capped at 2³¹−1 ms, scheduled again when it fires early.
  - `_settle()` ends an overdue clock first in every method, so a gift right after 0 can't bring it back.
- `adjust(ms)` (Add and Remove, not while idle) is exact, without the multiplier. Removing down to 0 while running ends the clock.
- `cap` (minutes) stops added time, from events or Add, at that much on the clock. It never cuts time already there, or the starting time. The clock is clamped to `Number.MAX_SAFE_INTEGER` ms, so an absurd multiplier or Adjust can't make it `Infinity`, which can't save.

## Triggers

- `TIMER_EVENTS` turns each live event into seconds × `multiplier`, kept in ms. A trigger set to 0 adds nothing.
- Gifts go through a `GiftStreaks` even while the clock doesn't count, so a streak begun before Start adds only what comes after. Coins are `added × max(0, coins)`, as `LiveService` counts them.
- Likes add to a remainder while counting. Each full `likes_every` adds `likes` seconds.
- Chat adds time only for messages with `chat.keyword`, matched with `hasKeyword` like chat alerts' keywords (empty means any message), and once per viewer (by handle) in `chat.cooldown` seconds. A message without the keyword doesn't start the cooldown. The cooldowns are pruned by the save interval.
- Follows, shares and new Super Fans add time for every event, like their alerts. There are no join, envelope or Super Fan box triggers: a Super Fan box comes with a new Super Fan, which already counts.
- `disconnected()` forgets the cooldowns and the streaks, and pauses a running clock when `pause_on_end` is on. `registerTimer` then sends `TIMER_PAUSED`.

## Saving

- Each profile has its own timer (`Profile.timer`, `TimerProfileSchema`, `.prefault({})` so older profiles load). `load(timer, file)` turns `running` into `paused`.
- `save()` writes into the profile the timer was loaded from, with `updateProfileData(updates, file)`. It takes the snapshot and the file before any `await`, so a save racing a profile switch can't land in the new profile. It returns true when nothing is loaded.
- When it saves:
  - The handlers save after each change, and throw `saveFailure()` when that fails.
  - A 5 s unref'd interval saves while running, or after a change no request saves: added time, the end, a pause on disconnect.
  - Never on quit (`shortcut:`): that would hold the quit the updater's install can't wait for (`.claude/rules/updates.md`). A quit or crash while running loses up to 5 s.
- `SET_PROFILE` saves the timer first and refuses the switch when that fails, then loads the new profile's timer. Picking the profile that's already active does nothing, even during a LIVE.

## Pushes and the overlay

- **Pushes:** `onChange(deltaMs)` feeds `registerTimer` (`src/main/events/init.ts`).
  - `added` sums the deltas. They go out through a no-argument `throttle` (250 ms) that reads `timer.get()` when it fires, so a late push never sends an old time.
  - The window gets `TIMER` (`{ settings, state, added }`), and the overlay's clients get `tokio:timer` (`{ status, remaining, added, multiplier, look, triggers }`).
  - `triggers` are the carousel's items, `[]` while `look.show_triggers` is off. `timerTriggers` (`src/common/util/timer.ts`) builds them for main and the Tools preview alike: the streamer's `look.names`, after the count for coins and likes ("1 coin", "100 likes"), with chat's keyword quoted, and the time each adds with the multiplier. Triggers that add nothing are left out.
  - A client connecting with the id `timer` gets the state from `ServerService.onConnect`, with `added: 0`.
- **The font:** `timer.html` is served from memory, with Archivo inlined as a `data:` URL.
  - Main imports the woff2 with `?inline`. That works only because `@fontsource-variable/archivo` is in main's `externalizeDeps.exclude` (`electron.vite.config.ts`).
  - `packaging.test.ts` skips query imports.
- **Drawing:** the page anchors `remaining` to `performance.now()` and redraws every 250 ms.
  - Sizes follow `--size`: `min(26vw, 46vh)` times `--fit`, which shrinks everything when a wide font or a wrapped title wouldn't fit.
  - The halo is set on each text, since `em` in a `text-shadow` set on `body` resolves against the body's 16px.
  - The title wraps instead of clipping, which would cut its halo into a box.
- **The slot under the clock:**
  - It shows `×N` (`show_multiplier`, multiplier not 1, rounded to two decimals here and in the Tools preview), or `added` summed until 1.5 s after the last change: `+` in the accent color, `−` in the clock's.
  - A sum that rounds to under a second shows `×N` meanwhile.
  - Times read like `formatAdded` (`src/common/util/timer.ts`): tenths under 10 s, then `1:30` and `1:00:00`. The page's `changeText` repeats it in plain JS.
- **The carousel** under the slot shows one trigger at a time for 3 s (`TURN_MS`), its name in the title's font and color and its time in the accent color, as text nodes. A push restarts the turns only when the triggers changed. It's one line that a long name cuts short; the padding inside its clipping box, taken back by negative margins, keeps the halo from being cut into a box.
- The Tools preview (`TimerPreview`) does the same as the slot and the carousel, so keep the two in step.
- **Fonts and colors:** a font goes in with `style.fontFamily = JSON.stringify(name.trim())` plus the fallbacks. It's one CSSOM property, so a name can't add styles. Colors are CSS variables, which the schema keeps to hex.

## Tools page

- **Tools** is a page of settings (`layout="aside"`): Countdown Timer, Timer Look, Time Added, then Test Overlays. The server-off notice sits above them. Timer Look comes right after the preview, colors first, so its changes show while they're made.
- With **Show the triggers, one at a time** on, Timer Look lists a name field for each trigger that adds time (its seconds × the multiplier over 0, as `timerTriggers` keeps them, so a multiplier of 0 lists none). Those fields have their own accessible names ("Follows on stream"), apart from the seconds fields that share their labels.
- One `useAutosave(timer.settings)` feeds the three timer sections, nested fields through immer's `produce`. `useAutosave` keys its delay on `prevSaved`, so main's pushes (a new but equal `settings` every 250 ms on a busy LIVE) don't keep restarting it.
- The controls (Start, Pause, Stop, Reset, Add, Remove) call `flushSettings()` before `TIMER_CONTROL` or `ADJUST_TIMER`, so a setting still waiting to save, like the starting time, reaches main first.
- The preview counts down from the last push's `at`, ticking only while running. While idle, it shows the starting time as typed. Its clock is weight 800 like the overlay's, heavier than the app's other readouts (700).
