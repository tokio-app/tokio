---
paths:
  - "src/main/services/alerts/**"
  - "src/main/helper/preview.ts"
  - "src/common/util/alerts.ts"
  - "src/renderer/src/pages/Alerts/**"
  - "src/renderer/src/components/AlertItem/index*"
  - "src/renderer/src/components/SoundPicker/**"
  - "src/renderer/src/components/MediaPicker/**"
  - "src/renderer/src/components/GiftSelect/**"
  - "src/renderer/src/components/EmoteSelect/**"
  - "src/renderer/src/hooks/useAlertTest.ts"
  - "src/renderer/src/helper/alerts.ts"
  - "src/main/services/server/alert.html"
  - "src/renderer/src/pages/Library/**"
---

# Alerts

The trigger rows, their matching, minimums and roles are in `.claude/rules/triggers.md`.

## Firing

- Music change alerts fire once each time a song starts (`MusicService.onSongChange`), not for one that fails to start, is skipped while it loads, or was already playing when a request came. Overlays get every `MUSIC_CHANGE`, queue changes too (songs a lower queue length drops included), but `MusicQueue.clear` sends one only when the queue held songs, since it runs on every chat while music is off.
- Gift alerts fire once per combo, on `repeatEnd`, or with `every_gift` once per gift, at most `queue_length` times per event.
- `AlertsService` runs its `GiftStreaks` only while alerts are on, so alerts turned on mid-streak play the whole count so far.
- `handle` takes the first row that matches (`triggersOf(alert).find`): it decides `every_gift`'s repeat and the `alerts:<type>` queue, and `onError` gets it, so a notice names the row that fired (an Emote row on a chat still says Emote).

## Gifts

- Only a profile with TikTok asks TikTok for its gift list (the user's call). `refreshTikTokGifts` (`src/main/helper/gifts.ts`) fetches it once a run, at startup or when TikTok first joins the active profile, unawaited by those handlers, and pushes `GET_GIFTS`, since pages ask only when they open. A failed fetch is tried again by the next trigger. Startup without a saved list awaits TikTok, and a profile without TikTok then loads none, with no warning.
- TikTok's list (`extra/gifts.json`) misses some, like other regions' gifts. `OverlayService.recordGift` saves the ones viewers send that aren't on it to `extra/custom-gifts.json`, shared by all profiles.
  - It saves nothing while TikTok's list is empty, since every gift would look missing.
  - After a failed save it writes nothing for `LOAD_RETRY_MS`, as emote saves do, so a file that can't be written isn't tried and logged on every gift.
  - A file that's there but doesn't read is never written over (it fails instead), and a gift's details count as compared once a run only after their save went through.

## Page

- The row's summary is one sentence per trigger (`triggerSummary`), joined by `ROWS` (" · "): a trigger's conditions hold commas and "or" already, so another "or" between them blurred which went with which. A new condition goes in the editor and the sentence, never a column.
- Picked gifts and emotes show as pictures before the sentence (`triggerPictures`), at most `NAMED` then `+N`, so more picks don't widen the row.
- No arrows between the row's columns, and sound and media aren't stacked in one column (the user's call). A long sentence wraps rather than hide a condition.
- A row without media keeps its **Copy overlay URL** slot, hidden and disabled, so the rows' actions line up.
- An empty `name` shows its place's default (`alertName`), counted when made, so after a delete two alerts can share one. The search keeps each alert's list index for that, and adding an alert clears it, since it would hide the new one.
- The alert's `volume` is the sound's or message's; a video has its own (`AlertMediaSchema.volume`), and another file keeps it and the duration.
- `AlertEditor`'s panel `min-height` is the gift Trigger tab's, the tallest, so the dialog doesn't move between tabs. The pickers render after it, so they open over it and Escape closes the picker first. With more rows than it holds, the Trigger tab scrolls inside it (`.scrolls`), so the dialog never outgrows the window.
- A space between a picker tile's name and its length keeps the button's name "Clip 12s".

## Sounds

- The sound and media libraries are managed on **Alerts → Library** (`pages/Library`), not in Settings (the user's call), a tab each, newest first (the user's call); the pickers keep the stored order.
- The sound library is shared by all profiles (`settings.sounds`). Files in the `sounds` folder are named by a hash of their content (uploads) or URL (MyInstants); alerts store only the basename.
- Imports go through `importFile` (`src/main/helper/library.ts`), shared with the Minecraft pictures. Read sounds through `AlertsService.readSound`, which keeps paths inside the folder. The `upload` loop imports every file, then lists them with one store save, so 1000 files aren't 1000 writes.
- `handle` only checks that a library sound's file is there (`_missing`: the cache, else `access`), without reading it.
- Sounds are up to `CACHE_MAX_FILE_BYTES`, so every sound added now is served from memory: `importSound` and `fetchSound` refuse bigger ones (`fetchSound` counts the bytes as they come). A bigger one saved before is read from disk only on `GET_SOUND_DATA`, one read shared by concurrent requests.
- MyInstants has no API; `AlertsService` scrapes its result list (`resultInstants`, which counts div tags so the trending list after it stays out). Only fetch `www.myinstants.com` URLs.
- `ALERT_AUDIO` carries a `key` (the file, or a `tts:` cache key), `repeat` and the cut. The window queues `repeat` copies sharing one decode, and forgets a `tts:` key's decode once its copies have places, since messages rarely repeat. It fetches a library sound's bytes (`GET_SOUND_DATA`) only when it hasn't decoded that key, one fetch for copies and concurrent events; messages carry `data`.
- Queues: `alerts`, or `alerts:<trigger>` with `simultaneous`. `ALERT_CLEAR` stops every `alerts*` queue. Tests and previews (`useAlertTest`) use `alert-test`, so clearing never cuts them.

## Request numbering

- The page applies a `SET_ALERT_SOUND` reply only while that alert waits for one (`asked`, set by `onRequest` from a Browse or MyInstants download), even after the picker closed, so a library or TTS pick made since wins over a late reply. Media does the same with `askedMedia`, `SET_ALERT_MEDIA` and `appliedMedia`.
- `onRequest` numbers each request: `DOWNLOAD_SOUND`, `IMPORT_SOUND` and `IMPORT_MEDIA` carry it as `request`, and `SET_ALERT_SOUND` and `SET_ALERT_MEDIA` echo it, failures included. A reply applies only if newer than the last one applied for that alert (`applied`), and the picker shows only the newest request's failure.
- When the library's store file can't be written, the file still goes to the alert: the success reply comes first, then the `saveFailure()` one with the same `request`, which the page ignores and the picker shows. `upload` adds a listed file again for the same reason, counting only new ones.
- The counter is module-level (`requests` in `pages/Alerts`), one for sounds and media, so a reply from before leaving the page can't beat a newer request.
- `asked` and `askedMedia` are cleared on `useEditableSettings`'s `switched`, since a cloned profile has the same alert ids.
- `useAlertTest` numbers `TEST_ALERT` with its own module-level counter, so a late reply for a test restarted on the same id (which also keys its gain, `lengths` and `PlayButton`), or one from before the page left, is dropped. Tests read the number from `sent()`.

## Removing sounds and media

- `REMOVE_SOUND` and `REMOVE_MEDIA` take the file out of its library, then off every alert in every profile (`StoreManagerService.removeFromAlerts`, `.claude/rules/store.md`), then delete it. A failed write keeps the file, for its alerts, and fails with `saveFailure()`. Overlay Studio's side is in `.claude/rules/studio.md`.
- Main sends `ALERT_FILE_REMOVED`, and the Alerts page (and Studio's editor, for media) clears the file from what it shows, so its next save doesn't bring it back.
- A sound whose file can't be deleted still leaves the library, with a warning (`SOUND_REMOVE_FAILED`).
- **Clear** in the pickers takes the sound, message or media off the alert and keeps the file.

## Cuts

- An alert's sound is `AlertClipSchema`: the library's `{ name, file }` plus `start` and `end` (null plays to the end, and an end at the sound's end saves null). The library and the games overlay's pictures stay `AlertSound`.
- A library pick or a `SET_ALERT_SOUND` reply goes through `soundClip`: another file plays whole, the alert's own file keeps its cut. Files are never changed, so each alert cuts its own way. Messages aren't cut.
- The part is `cutPart`'s: a part outside the sound, or empty, plays it whole, and a negative start counts as 0. Lengths shown for a cut go through it too, so they match what plays.
- `AudioQueue` passes `start / speed` and `(end − start) / speed` to `GrainPlayer.start`, which reads the offset in played seconds, so the part starts at its cut at any speed.
- A cut end fades over `CUT_FADE` on its own `Gain` node, so `setItemGain`'s ramps can't cancel it. A cut start needs nothing, as the grains fade in.
- Tests pass the cut through `AlertTestRequest`, which main ignores.
- Videos are cut the same way (`AlertMediaSchema` spreads `CUT`; images ignore it). `setMedia` keeps the cut for the same file and drops it for another. `showMedia` refuses non-finite ones and clamps them.
- The overlay page loads the video at `#t=<start>` and, from its first `playing`, hides it at `min(end, start + duration)` of `currentTime`, waiting again while the clock lags: a fragment's end is checked only every 250 ms. Its `duration` timer hides only media that isn't playing, since a video starts after its turn begins, which ended cuts early.
- The waveform (`SoundCut`) decodes `GET_SOUND_DATA { file }`'s bytes under the file's name, `ALERT_AUDIO`'s key, so the editor and the alert share one decode. `SOUND_DATA` echoes the file, failures included, with `notify: false`, as the tab shows the failure. A decode that ends after the tab's sound changed is dropped, its failure too.
- `CutTrack` and `ResetCut` (`SoundCut.tsx`) are shared with the **Image or video** tab and Overlay Studio's video fields.

## Text-to-speech

- An alert plays `sound` or speaks `tts` (a message with its own voice, speed and pitch); `tts` wins if both are set.
- `TTSService.prepareText`'s third argument limits an alert message's banned words to the event's values. `AlertsService.speak` caches the audio in the sound LRU under a `tts:` key. Live alerts make their messages on a `TaskQueue` with the TTS page's cooldown and queue length.
- A viewer on the TTS page's block list loses only the message (the user's call), checked with `isBlocked` on `eventUser`. The alert plays its sound, or its media alone; one with only a message plays nothing. Banned words still skip the whole alert. The allow list and the roles stay chat-only.
- Alert queues are shared, so speed and pitch travel per sound on `ALERT_AUDIO.filters`, overriding the queue's.
- `{translation}` (Chat and Emote) is the chat's translation, or what the viewer typed without one (`messageValues`); when it's offered: `.claude/rules/translation.md`.
- `{count}` in a gift alert's message is the streak's total, not TikTok's `comboCount`. It isn't offered on every gift; a message that has it gets the count so far. One event that adds several gifts makes the message once and sends one `ALERT_AUDIO` with `repeat`.
- `_generate(..., false)` doesn't log a live alert's failed message; previews (`speak`) log their own, which `speakTest` counts on.
- A TTS test (`TEST_ALERT`'s `tts` branch) fills the message with a sample from the `platform` it carries: the row's own, else the profile's first that sends its event (`samplePlatform`), which every caller resolves (the row's Play, the editor's Sound tab, the sound picker's TTS tab, MCP's alert test). Without one it's TikTok's (Music change).
- `AlertsService.clear` runs wherever `ALERT_CLEAR` is sent: it drops the waiting messages, sounds and media, hides the media shown, and forgets the gift streaks, since their ends may be missed.

## Media

- The media library is shared by all profiles (`settings.media`), files in the `media` folder named by a hash of their content, up to `MEDIA_MAX_BYTES`. `mediaKind` and the extensions are in `src/common/util/alerts.ts`, for the window too.
- No SVG: opened from the overlay server, its scripts would run there.
- Media is never cached or sent over IPC.
- Each alert's overlay (`getAlertOverlayURL(id)`) is one page (`services/server/alert.html`) at every id, which reads the id from its path. Nothing is stored for it, so deleting, cloning or importing alerts needs no cleanup, and cloned profiles share their alerts' overlays.
- The media folder is mounted at `/alerts/media/` (`express.static`, so videos get byte ranges).
- The window's queue times the media, so it shows with the alert's sound and waits its turn: the item's place lasts `max(sound length / speed, duration)` (`minDuration`), and a media-only alert holds a silent place (`AudioQueue.wait`). `queueAlert` then emits `SHOW_ALERT_MEDIA` with the delay, and main keeps the timers, so `clear` can drop the media still waiting.
- A removed video is paused and loses its `src`, since Chromium keeps a detached video with a source alive. A video is muted if the browser refuses sound, but one removed before its play started isn't replayed muted.
- Migration: `withSavedMedia` gives media saved without a volume the alert's, and cuts a video saved before cuts at its old `duration` unless its old `match_video` was on.
- Media rides on the alert's audio: a missing sound, or a message that banned words block or that fails, skips it too. A file missing on disk (a profile from another computer) shows nothing, with no notice.
- Stopping a test leaves its media on the overlay until it ends.
- The **Image or video** tab sets a video's duration to `cutPart` of the length its preview read, so a file browsed while the tab isn't shown keeps the old duration until it is. A video of unknown length (some recordings don't say it) can't be cut and keeps a typed Duration.

## LibraryPicker

- `LibraryPicker` (`components/MediaPicker/LibraryPicker.tsx`) holds what the `MediaPicker` and the Games page's `PicturePicker` share: the library, search, listeners, failure check and delete flow. Build a new library picker on it.

## tokio-media:

- The windows load library files from `tokio-media:///<file>` (`getMediaPreviewURL`) and `tokio-media:///sounds/<file>` (`getSoundPreviewURL`). Main registers `MEDIA_SCHEME` with `stream` and serves only images and videos right in the media folder, and audio right in the sounds folder (`mediaFile`, `src/main/helper/preview.ts`). The CSP allows it in `img-src` and `media-src`.
- Videos come in the parts their players ask for (`videoResponse`, 206 with `Content-Range`): Chromium seeks only in media served in parts, and net.fetch of a `file:` URL answers a Range with the whole file, so cuts couldn't seek nor a thumbnail's `#t=0.1` show its frame. Images and sounds go through net.fetch.
