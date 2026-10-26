---
paths:
  - "src/renderer/src/hooks/**"
  - "src/renderer/src/context/**"
  - "src/renderer/src/helper/audio.ts"
  - "src/renderer/src/components/ProfileDropdown/**"
  - "src/renderer/src/router/Layout/**"
  - "src/renderer/src/pages/Settings/sections/ProfileSection.tsx"
---

# Renderer state, hooks and audio

## State

- Global state is in `context/` (`app`, `audio`, `notifications`); shared hooks are in `hooks/`.
- If `LOAD_APP` fails, `AppProvider` still sends `SHOW_WINDOW`, but shows only the title bar and "Tokio couldn't start" instead of the pages. Toasts still work, since `NotificationsProvider` sits outside it.
- `useImmerState` returns an immer `Updater`; `scopeUpdater(update, key)` hands a section one field.

## Saving profile sections

- `useEditableSettings(section, onLoad?)` loads a profile section (TTS, Music, Alerts, Games) and saves it `SAVE_DELAY` after the last change, so quick changes go in one save.
- A change still waiting is sent when the page or the window closes (`pagehide`; not `beforeunload`, which can keep the window open).
- A change still waiting is dropped when another profile loads, and a failed save reloads the profile.
- Nothing is saved before a profile has loaded, so the defaults it starts from never reach one.
- `onLoad(profile, switched)` runs on every load. `switched` is true when it's another profile than the last one (by name), not for a resync, so a page can drop what it waits for from the last profile.
- Main saves to whichever profile is active, so call `flushSettings()` before switching profiles: it sends the changes still waiting to the profile they were made on, and the `useAutosave` fields still waiting.

## Saving one field

`useAutosave(saved, save)` does the same for one field outside the profile, such as the keys in Settings, which have no Save button.

- It saves `SAVE_DELAY` after the last change, and sends a change still waiting when the field unmounts, the window closes or `flushSettings()` runs (both hooks join one set through `useFlush`).
- It starts over when `saved` changes, except for main's echo of one of its own saves, which would undo what was typed since.
- It keeps every value sent and not echoed yet, so several saves can be in flight: an echo settles that one and the ones before it.
- Its delay keys on `prevSaved`, which changes only when `saved` changes by value. So a parent that passes a new but equal object, like the countdown timer's pushes, doesn't keep restarting it.

## Audio

Audio plays through named `AudioQueue`s (`helper/audio.ts`) from `useAudio().getQueue(name)`.

- `enqueue(bytes or a loader, { gain, key, cacheKey, speed, pitch, onEnded, minDuration, onScheduled, start, end })` adds a sound; `wait(seconds, options)` adds a silent place (speed changes don't stretch it). Both return a promise of whether the item got its place.
- Items get their places in the order they came (a chain on `tail`, reset by `stop()`), however long each takes to decode; decoding starts at once.
- An item's own speed and pitch are clamped to 0.5–2 like the queue's.
- An item's place lasts at least `minDuration`. `onScheduled(delay, duration)` gets the seconds until it's heard, measured from `Tone.immediate()` (`Tone.now()` runs ahead by the look ahead), and how long the place lasts.
- `onEnded` runs at Tone's stop, and doesn't run when a queue is stopped. Tone emits stop up to its look-ahead before the end is heard, so a finished item's nodes are disposed `lookAhead + CUT_FADE` later.
- `maxQueueLength` counts playing items and decodes in flight, so a full queue never decodes, or fetches.
- Sounds with a `cacheKey` are decoded once for every queue, kept in an LRU of decoded audio (`DECODED_CACHE_BYTES`).
- A loader (`() => Promise<bytes>`, a library alert sound's `soundData`) runs only on a cache miss, and its entry is set first, so copies and concurrent items share one fetch and one decode.
- Eviction never drops the sound just decoded or ones still decoding, and keeps evicted buffers weakly (`WeakRef`) for reuse while a player holds them.
- `forgetDecoded(cacheKey)` drops one that won't come again soon, such as an alert message; players that have it play on.
- `useAudio().decode(bytes, cacheKey)` (`decodeSound`) decodes into the same cache, for a page that draws a sound (the alert editor's waveform).
- `start` and `end` play a part of the sound, see Cuts in `.claude/rules/alerts.md`.
