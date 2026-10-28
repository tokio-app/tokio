---
paths:
  - "src/main/services/alerts/**"
  - "src/main/helper/chat.ts"
  - "src/main/helper/triggers.ts"
  - "src/common/util/alerts.ts"
  - "src/renderer/src/pages/Alerts/**"
  - "src/renderer/src/components/AlertItem/**"
  - "src/renderer/src/components/SoundPicker/**"
  - "src/renderer/src/components/MediaPicker/**"
  - "src/renderer/src/components/GiftSelect/**"
  - "src/renderer/src/components/EmoteSelect/**"
  - "src/renderer/src/hooks/useAlertTest.ts"
  - "src/renderer/src/helper/alerts.ts"
  - "src/main/services/server/alert.html"
  - "src/renderer/src/pages/Settings/sections/SoundsSection.tsx"
  - "src/renderer/src/pages/Settings/sections/MediaSection.tsx"
---

# Alerts

## Triggers

- Saved per profile in `Profile.alerts` (`simultaneous`, `queue_length`, `items`).
- `AlertTriggerSchema` (`src/common/schemas/profile.ts`) derives the triggers from `TOKIO_EVENTS` (for a new event, see the `live-event` skill). `ROOM_USER` is excluded there and from the `AlertTrigger` type: it comes every few seconds and is meant for overlays.
- Migration: `AlertItemsSchema`'s preprocess drops saved Room Users alerts, then names alerts saved without a name by their place.
- `registerConnectorEvents` (`src/main/events/init.ts`) passes every trigger to `AlertsService.handle` while `activeFeatures.alerts` is on.
- Music change alerts come from `MusicService.onSongChange`: once each time a song starts, not for one that fails to start, is skipped while it loads, or was already playing when a request came. `MUSIC_CHANGE` also fires when the queue changes, and overlays get every one through `ServerService.initEvents`.
- Gift alerts fire once per combo, on `repeatEnd`, or with `trigger.every_gift` (**Every gift**) once per gift sent, at most `queue_length` times per event.
- `GiftStreaks` (`src/main/helper/streaks.ts`, also used by `LiveService`, `GamesService` and the timer) counts what each gift event adds to its sender's streak, like the gift jar overlay's `Tally`. `AlertsService` runs it once per event, even with no alert on every gift, but only while alerts are on: alerts turned on mid-streak play the whole count so far.
- Matching is `matchesTrigger` (`src/main/helper/triggers.ts`), shared with `GamesService` (see `.claude/rules/games.md`). Both callers get `added` and `total` from `streakOf` (same file), which counts the event in their `GiftStreaks` once and gives the streak's total as `{count}`. `AlertsService` keeps `enabled` and the sound, message or media check.
- Alerts and Games both use `TriggerSchema`, `TriggerFilter` and `TRIGGER_OPTIONS` (`components/AlertItem`), Games without five of them (`GAME_TRIGGERS`).
- Two conditions only the Alerts editor offers (game actions keep the defaults, which match everything):
  - `min_coins`: the streak's worth when it ends (`gift.coins × total`), or each gift's `coins` with `every_gift`. Only for any gift: picked gifts are the alert's choice, so `matchesTrigger` ignores it then, and the editor and the summary leave it out.
  - `roles` (`VIEWER_ROLES`; `[]` is anyone): only Chat, Emote and Gift carry the viewer's roles (the connector maps `userIdentity` for chat and gifts), so `takesRoles` (`src/common/util/alerts.ts`), shared by the matcher, the editor and the summary, allows only them. Other triggers' saved roles are ignored.
- The Emote trigger (`EMOTE_TRIGGER`) isn't a live event: the loop skips it and `matchesTrigger` matches it on `CHAT`. TikTok can't list a LIVE's emotes, so `StoreManagerService.recordEmotes` saves the ones seen in chat to `Profile.emotes`, and main pushes the list with `EMOTES`.
- Chat alerts filter on `trigger.keyword` through `hasKeyword`, Member join and Super Fan join alerts on `trigger.user` through `isUser` (both `src/main/helper/chat.ts`). Keywords match whole words (`wholeWord`), except next to scripts written without spaces (Chinese, Japanese, Thai); an emoji between words counts as a space.

## Gifts

- TikTok's gift list (`extra/gifts.json`) misses some gifts, like other regions' ones. `OverlayService.recordGift` saves the ones viewers send that aren't on it to `extra/custom-gifts.json`, shared by all profiles.
- It saves nothing while TikTok's list is empty, since every gift would look missing. It keeps both lists in memory once read, since every gift event checks them.
- The Alerts and Games pages read them through `useTriggerChoices` (`pages/Alerts`), with TikTok's list and the emotes: `GET_CUSTOM_GIFTS`, and main pushes new ones on its reply, `CUSTOM_GIFTS`. `giftOptions` merges both lists cheapest first, each id once. Overlay gift settings use TikTok's list only.

## Page

- An alert row without media keeps its **Copy overlay URL** button's slot, hidden (`visibility`, `aria-hidden`, disabled), so the rows' actions line up.
- The row's summary is `triggerSummary`: one sentence, at most `NAMED` gifts or emotes, the rest counted by `listOf` (`src/common/i18n`). `gameEventText` (the Games overlay) shares `giftNames` but names every gift. There are no columns: a new condition goes in the editor and the sentence.
- Picked gifts and emotes show as pictures before the sentence instead (`triggerPictures`): at most `NAMED`, then `+N` for the rest, ones without a picture or not on the lists yet included, so more picks don't widen the row. The pictures are one `role="img"` named, and titled, by the names the sentence would say. With none of their pictures known the sentence names them.
- The row has three columns, each a name over its details: the alert's name over the trigger's line (the event, the pictures, the sentence), the sound or message over its length, and the media over its duration. No arrows between them: the user rejected one, and sound and media stacked in one column. A sentence too long for its line wraps rather than hide a condition.
- An alert that's off greys its pictures and texts.
- The row's sound length is `SoundLength`'s, given the alert's `cut` (`cutPart`), so a cut that doesn't fit shows the whole file, as the queue plays it.
- Each alert has a `name` (default `""`). A new one gets `defaultAlertName(index)`; an empty one shows its place's default (`alertName`, `src/common/util/alerts.ts`). Defaults count the place when made, so after a delete two alerts can share one.
- The header's `SearchToggle` matches `alertName`; each alert keeps its list index for its default name. Adding an alert clears the search, which would hide it.
- `AlertEditor` (`pages/Alerts`) is a `Modal` with **Trigger**, **Sound** and **Media** tabs. Edits go straight to the page's `update`, saved like any change.
  - The alert's `volume` (Sound tab) is the sound's or message's; a video has its own on the Media tab.
  - The panel's `min-height` is the gift Trigger tab's, the tallest, so the dialog doesn't move between tabs.
  - The pickers render after it, so they open over it, and Escape closes the picker first.

## Sounds

- Uploaded, browsed and downloaded sounds go to a library shared by all profiles, in `settings.sounds`. Files in the `sounds` folder are named by a hash of their content (uploads) or URL (MyInstants), and alerts store only the basename.
- Imports (`importSound`, `importMedia`) go through `importFile` (`src/main/helper/library.ts`), shared with the Minecraft pictures (see `.claude/rules/games-overlay.md`).
- Read them through `AlertsService.readSound` (keeps paths inside the folder, caches).
- Deleting a sound or media file (`REMOVE_SOUND`, `REMOVE_MEDIA`):
  - takes it out of its library, then off every alert in every profile (`StoreManagerService.removeFromAlerts`, which shares `_updateProfiles` with `removeFromGames`), then deletes the file;
  - a profile that can't be saved keeps the file, for its alerts, and fails with `saveFailure()`;
  - main sends `ALERT_FILE_REMOVED`, and the Alerts page clears the file from the alerts it shows, so its next save doesn't bring it back;
  - a sound whose file can't be deleted still leaves the library, with a warning (`SOUND_REMOVE_FAILED`).
- **Clear** in the pickers takes the sound, message or media off the alert and keeps the file.
- Upload counts only sounds new to the library: one already in `settings.sounds`, or picked twice, isn't counted.
- Size and caching:
  - Sounds are up to `CACHE_MAX_FILE_BYTES`: `importSound` and `fetchSound` refuse bigger ones (`fetchSound` checks `content-length` before reading the body), so every sound added now is served from memory.
  - A bigger one saved before is read from disk only on `GET_SOUND_DATA`, one read shared by the requests that want it at once.
  - `handle` only checks that a library sound's file is there (`_missing`: the cache, else `access`), without reading it, and doesn't log a missing sound. `init.ts` logs it to `alerts.log` only when its notice goes out (once per `REPEAT_NOTICE_MS` per alert).
- MyInstants has no API; `AlertsService` scrapes it with cheerio. Only fetch `www.myinstants.com` URLs.
- `SoundLength` (`components/SoundPicker`) reads a library file's length from a hidden `<audio preload="metadata">` loading `tokio-media:///sounds/<file>` (`getSoundPreviewURL`); `mediaFile` serves only audio right in the sounds folder there. A MyInstants sound not downloaded gets a length once previewed, from `useAlertTest`'s `lengths` (`onScheduled`).
- Main sends sounds with `ALERT_AUDIO` on a queue (`channel`), each with a `key` (its file, or its `tts:` cache key), `repeat`, and a file sound's cut (`start`, `end`).
  - The window queues `repeat` copies sharing one decode, and forgets a `tts:` key's decoded audio (`forgetDecoded`) once its copies have places, since messages rarely repeat.
  - Library sounds go by `key` alone, without `data`: the window fetches the bytes with `GET_SOUND_DATA` (`soundData`, `renderer/src/helper/alerts.ts`) only when it hasn't decoded that key, and copies and concurrent events share one fetch. Messages (`tts:` keys) still carry `data`.
- Queues: `alerts`, or `alerts:<trigger>` per trigger when `simultaneous` is on. `ALERT_CLEAR` (on disconnect and when the feature turns off) stops every `alerts*` queue. Tests and previews use `useAlertTest` on the `alert-test` queue, so clearing never cuts them.
- Request numbering:
  - The page applies a `SET_ALERT_SOUND` reply only while it waits for one for that alert (`asked`, set by `onRequest` from a Browse or MyInstants download), even after the picker closed. A library or TTS pick made since wins over a late reply.
  - `onRequest` numbers each request: `DOWNLOAD_SOUND`/`IMPORT_SOUND` carry it as `request` and `SET_ALERT_SOUND` echoes it. A reply applies only if it's newer than the last one applied for that alert (`applied`), and the picker shows only the newest request's failure.
  - `asked` and `askedMedia` are cleared when another profile loads (`useEditableSettings`'s `switched`), since a clone has the same alert ids.
  - `useAlertTest` numbers tests the same way: `TEST_ALERT` carries `request` and its reply echoes it, failures included, so a late reply for a test stopped and started again on the same id (which also keys its gain, `lengths` and `PlayButton`) is dropped. Callers pass `AlertTestRequest` without it; the hook adds it.

## Cuts

- An alert's sound is `AlertClipSchema`: the library's `{ name, file }` plus `start` (seconds) and `end` (null plays to the end). The library and the games overlay's pictures stay `AlertSound`.
- A library pick or a `SET_ALERT_SOUND` reply goes through `soundClip`: another file plays whole, the alert's own file keeps its cut. The file is never changed, so each alert cuts it its own way. Messages aren't cut.
- The window plays the part: `AudioQueue.enqueue`'s `start`/`end` (seconds of the sound) go to `GrainPlayer.start(time, start / speed, length)`, `length` being the seconds heard (`(end − start) / speed`). GrainPlayer reads the offset in played seconds too, so the part starts at its cut at any speed.
- The part is `cutPart`'s (`src/common/util/alerts.ts`): a part outside the sound, or empty, plays it whole, and a negative start counts as 0.
- A cut end fades over `CUT_FADE` on its own `Gain` node, so `setItemGain`'s ramps can't cancel it. A cut start needs nothing, as the player's grains fade in.
- Tests pass the cut through `AlertTestRequest`'s `start`/`end`, which main ignores.
- Videos are cut the same way: `AlertMediaSchema` shares the `start`/`end` fields (`CUT`); images ignore them. `setMedia` keeps the cut for the same file and drops it for another. `SHOW_ALERT_MEDIA` carries them, and `showMedia` refuses non-finite ones and clamps them.
- The overlay page loads the video at `#t=<start>` and, from its first `playing`, times it by its own clock: it hides it at `min(end, start + duration)` of `currentTime`, waking `stop − currentTime` seconds later and waiting again while the clock lags (a fragment's end is checked only every 250 ms). The page's `duration` timer hides only images and videos that aren't playing, since a video loads and starts after its turn, which ended the cut early.
- The Sound tab's waveform (`SoundCut`) gets the bytes with `GET_SOUND_DATA { file }` (`readSound`). `SOUND_DATA` echoes the file, failures included, with `notify: false`: the tab shows the failure.
- It decodes them with `useAudio().decode` under the file's name, the key `ALERT_AUDIO` uses, so the editor and the alert's plays share one decode. A decode that ends after the tab's sound changed is dropped, its failure too.
- An end at the sound's end saves null. `CutTrack` (`SoundCut.tsx`) and `ResetCut` are shared with the Media tab.

## Text-to-speech

- An alert plays `sound` or speaks `tts` (a message with its own voice, speed and pitch). `tts` wins if both are set, and the picker clears one when the other is picked.
- `AlertsService.speak` fills the message with `formatAlertMessage` (variables per trigger in `ALERT_MESSAGE_VARIABLES`, `src/common/util/alerts.ts`) and runs it through `TTSService.prepareText`, whose third argument limits banned words to the event's values, as chat TTS does. It generates with the speaker from `setSpeaker` and caches it in the sound LRU under a `tts:` key.
- Alert queues are shared, so speed and pitch travel per sound on `ALERT_AUDIO.filters`, and `AudioQueue` items can override the queue's filters.
- `{count}` in a gift alert's message is the streak's total from `GiftStreaks`, not TikTok's `comboCount`. `TtsTab` doesn't offer it on every gift; a message that has it still gets the count so far. One event that adds several gifts makes the message once and sends one `ALERT_AUDIO` with `repeat`.
- A live alert's failed message isn't logged by `AlertsService` (`_generate(..., false)`): `init.ts` logs it to `alerts.log` only when its notice goes out, like a missing sound. Previews (`speak`) log their own failures, which `speakTest` counts on.
- Like chat TTS, live alerts make their messages through a `TaskQueue` with the TTS page's cooldown and queue length: blocked messages never enter it, and the ones past the length are dropped.
- `AlertsService.clear` runs wherever `ALERT_CLEAR` is sent: it drops the messages waiting, the sounds being read and the media waiting to show, hides the media on the overlays that showed some, and forgets the gift streaks, since their ends may be missed. Previews call `speak` directly.

## Media

- An alert can also show an image or video (`media`: a file and a `duration`), with its sound or message or alone.
- The library is shared by all profiles like the sounds: `settings.media`, files in the `media` folder named by a hash of their content, up to `MEDIA_MAX_BYTES`. The extensions and `mediaKind` are in `src/common/util/alerts.ts`, for the window too. A rebuilt store recovers it like the sounds (`_findFiles`).
- No SVG: opened from the overlay server, its scripts would run there.
- Media is never cached or sent over IPC.
- Each alert has its own overlay at `getAlertOverlayURL(id)` (`/alerts/<alert id>/`). `ServerService` serves one page from memory (`services/server/alert.html`, loaded with `?raw`, typed by `src/main/env.d.ts`) at every id, and the page reads the id from its path. Nothing is stored for it, so deleting, cloning or importing alerts needs no cleanup, and cloned profiles share their alerts' overlays.
- The media folder is mounted at `/alerts/media/` (`express.static`, so videos get byte ranges).
- The window's queue times the media, so it shows with the alert's sound and waits its turn:
  - `ALERT_AUDIO` carries `media`, and the item's place lasts `max(sound length / speed, duration)` (`minDuration`). A media-only alert sends neither `data` nor `key` and holds a silent place (`AudioQueue.wait`).
  - Once the item has its place, `queueAlert` (`renderer/src/helper/alerts.ts`) emits `SHOW_ALERT_MEDIA` with the delay and `media.volume`, and `AlertsService.showMedia` sends `tokio:alert:media` to the alert's overlay (`sendToClient`) when it's over. Main keeps the timers, so `clear` can drop the media still waiting.
- The page shows one at a time and removes it after `duration`, when a video ends, or on `tokio:alert:clear`. It ignores the live events every client gets.
- A video is muted if the browser refuses sound. One removed before its play started (its `play()` aborted) isn't replayed muted.
- `AlertMediaSchema.volume` is the video's, apart from the alert's `volume`. Another file keeps it, as it keeps the duration.
- Migration: `withSavedMedia` (a preprocess on `AlertSchema`) gives media saved without a volume the alert's, and cuts a video saved before cuts (no `start`) at its old `duration` unless its `match_video` was on. The schema no longer has `match_video`.
- Media rides on the alert's audio: a missing sound or a blocked or failed message skips it too. A file missing on disk (a profile imported from another computer) shows nothing, with no notice.
- Request numbering: the page applies a `SET_ALERT_MEDIA` reply only while that alert waits for one (`askedMedia`). `IMPORT_MEDIA` carries `request` (one counter with the sounds') and `SET_ALERT_MEDIA` echoes it, failures included: the page applies only a reply newer than the last applied for that alert (`appliedMedia`), and the picker shows only the newest request's failure. `IMPORT_MEDIA` also replies `GET_MEDIA`.
- The `MediaPicker` only picks: it closes after a pick, and once a browsed file for its alert arrives.
- The windows load thumbnails from `tokio-media:///<file>` (`getMediaPreviewURL`). Main registers `MEDIA_SCHEME` with `stream` for videos and serves only images and videos right in the media folder (`mediaFile`, `src/main/helper/preview.ts`). The CSP allows it in `img-src` and `media-src`.
- Chromium and `tokio-media:`:
  - Every video player loads its own URL, `useVideoURL(file)` (`components/MediaPicker`, a `?player=` query from `useId`, which `mediaFile` ignores). Chromium fails every player that loads one `tokio-media:` URL at once (error 4), and the URL stays failed. A row's thumbnail and the editor's preview, or a Media library row and its **Full size**, load together.
  - Videos come in the parts their players ask for (`videoResponse`, `src/main/helper/preview.ts`, 206 with `Content-Range`). Chromium seeks only in media served in parts, and net.fetch of a `file:` URL answers a Range with the whole file, so the editor's cut couldn't seek, nor a thumbnail's `#t=0.1` show its frame. Images and sounds still go through net.fetch.
- The Media tab (`MediaPreview`):
  - A video whose length the preview read gets a **Cut** (`CutTrack` without `peaks`) and no Duration to type: an effect sets the duration to the part that plays (`cutPart` of the length read on `loadedmetadata`), to the hundredth, from 1 to `MEDIA_MAX_DURATION`. The tab sets it, so a file browsed while it isn't shown keeps the old duration until it is.
  - A video whose length is unknown (some recordings don't say it, or the preview fails) can't be cut and keeps a typed Duration.
  - `MEDIA_DURATION` and `MEDIA_MAX_DURATION` are next to the schema, in `src/common/schemas/profile.ts`.
- A space between a picker tile's name and its length keeps the button's name "Clip 12s".
- **Settings → Media library** (`MediaSection`): **Upload** sends `UPLOAD_MEDIA`, which shares the `upload` loop with `UPLOAD_SOUNDS`.
- `useAlertTest` queues a test of media alone without asking main. A test with a sound or message passes the request's `media` to `queueAlert` on the reply. Stopping a test leaves its media on the overlay until it ends.
