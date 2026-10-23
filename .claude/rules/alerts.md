---
paths:
  - "src/main/services/alerts/**"
  - "src/main/helper/chat.ts"
  - "src/common/util/alerts.ts"
  - "src/renderer/src/pages/Alerts/**"
  - "src/renderer/src/components/AlertItem/**"
  - "src/renderer/src/components/SoundPicker/**"
  - "src/renderer/src/components/MediaPicker/**"
  - "src/renderer/src/components/GiftSelect/**"
  - "src/renderer/src/hooks/useAlertTest.ts"
  - "src/renderer/src/helper/alerts.ts"
  - "src/main/services/server/alert.html"
  - "src/renderer/src/pages/Settings/sections/SoundsSection.tsx"
  - "src/renderer/src/pages/Settings/sections/MediaSection.tsx"
---

# Alerts

## Triggers

- Saved per profile in `Profile.alerts` (`simultaneous`, `queue_length`, `items`).
- `AlertTriggerSchema` (`src/common/schemas/profile.ts`) derives the triggers from `TOKIO_EVENTS` (for a new event, see IPC events in `AGENTS.md`). `ROOM_USER` is excluded (it comes every few seconds and is meant for overlays), both there and in the `AlertTrigger` type. Saved Room Users alerts are dropped when a profile loads.
- `registerConnectorEvents` (`src/main/events/init.ts`) passes every trigger to `AlertsService.handle` while `activeFeatures.alerts` is on. Music Change alerts come from `MusicService.onSongChange`, once each time a song starts, not for one that fails to start, is skipped while it loads, or was already playing when a request came; the rest from the connector. `MUSIC_CHANGE` also fires when the queue changes, and overlays get every one through `ServerService.initEvents`. Gift alerts fire once per combo, on `repeatEnd`.
- The Emote trigger (`EMOTE_TRIGGER`) isn't a live event: the loop skips it and `AlertsService` matches it on `CHAT` (empty `trigger.emotes` means any emote). TikTok can't list a LIVE's emotes, so `StoreManagerService.recordEmotes` saves the ones seen in chat to `Profile.emotes`, and main pushes the list with `EMOTES`.
- Chat alerts filter on `trigger.keyword` through `hasKeyword` (`src/main/helper/chat.ts`, whole words through `wholeWord`, except next to letters of scripts written without spaces, such as Chinese, Japanese or Thai, where it matches anywhere; a keyword of only emojis is looked for as written), and Member Join and Super Fan Join alerts on `trigger.user` through `isUser` (handle or name).

## Gifts

- TikTok's gift list (`extra/gifts.json`) misses some gifts, like other regions' ones. `OverlayService.recordGift` saves the ones viewers send that aren't on it to `extra/custom-gifts.json`, shared by all profiles. It saves nothing while TikTok's list is empty, since every gift would look missing, and keeps both lists in memory once read, since every gift event checks them.
- The Alerts page reads them with `GET_CUSTOM_GIFTS`, and main pushes new ones on its reply, `CUSTOM_GIFTS`. `giftOptions` merges both lists cheapest first, each id once. Overlay gift settings use TikTok's list only.

## Sounds

- Uploaded, browsed and downloaded sounds go to a library shared by all profiles, in `settings.sounds`. Files in the `sounds` folder are named by a hash of their content (uploads) or URL (MyInstants), and alerts store only the basename.
- Read them through `AlertsService.readSound` (keeps paths inside the folder, caches).
- Deleting a sound or media file (`REMOVE_SOUND`, `REMOVE_MEDIA`) takes it out of its library, then off every alert that has it in every profile (`StoreManagerService.removeFromAlerts`; the active profile through `updateProfileData`, which keeps it in memory), then deletes the file. A profile that can't be saved keeps the file, for its alerts, and fails with `saveFailure()`. Main sends `ALERT_FILE_REMOVED`, and the Alerts page clears the file from the alerts it shows, so its next save doesn't bring it back. Every delete button asks first (`Modal`, "Delete sound?" or "Delete media?"). **Clear** in the pickers takes the alert's sound, message or media off it and keeps the file.
- Upload counts only sounds new to the library: one already in `settings.sounds`, or picked twice, isn't counted. A removed sound whose file can't be deleted still leaves the library, with a warning (`SOUND_REMOVE_FAILED`).
- Sounds are up to `CACHE_MAX_FILE_BYTES` (8 MB): `importSound` and `fetchSound` refuse bigger ones, so every sound added now is served from memory. A bigger one saved before is read from disk, with one read shared by the events that want it at once. `handle` doesn't log a missing sound; `init.ts` logs it to `alerts.log` only when its notice goes out (once per 30s per alert).
- MyInstants has no API; `AlertsService` scrapes it with cheerio. Only fetch `www.myinstants.com` URLs.
- Main sends sounds with `ALERT_AUDIO` on a queue (`channel`), each with a `key` (its file, or its `tts:` cache key) so the window decodes a sound's copies once: one `alerts` queue, or `alerts:<trigger>` per trigger when `simultaneous` is on. `ALERT_CLEAR` (on disconnect and when the feature turns off) stops every `alerts*` queue. Tests and previews use `useAlertTest` on the `alert-test` queue, so clearing never cuts them.
- The Alerts page applies a `SET_ALERT_SOUND` reply only while it waits for one for that alert (`onRequest`, from a Browse or MyInstants download), even after the picker closed; a library or TTS pick made since wins over a late reply. MyInstants loads its trending sounds only when its tab is first shown.

## Text-to-speech

- An alert plays `sound` or speaks `tts` (a message with its own voice, speed and pitch). `tts` wins if both are set, and the picker clears one when the other is picked.
- `AlertsService.speak` fills the message with `formatAlertMessage` (variables per trigger in `ALERT_MESSAGE_VARIABLES`, `src/common/util/alerts.ts`), runs it through `TTSService.prepareText` (replacements, Remove Emojis, and banned words, which its third argument limits to the event's values, the template's variables filled, as chat TTS does) and generates it with the speaker from `setSpeaker`, caching it in the sound LRU under a `tts:` key.
- Alert queues are shared, so speed and pitch travel per sound on `ALERT_AUDIO.filters`, and `AudioQueue` items can override the queue's filters.
- Like chat TTS, alerts from live events make their messages through a `TaskQueue` with the TTS page's cooldown and queue length, so bursts can't flood the engine: blocked messages never enter it, and the ones past the length are dropped.
- `AlertsService.clear` runs wherever `ALERT_CLEAR` is sent: it drops the messages waiting and the media waiting to show, and hides the media on the overlays that showed some. Previews call `speak` directly.

## Media

- An alert can also show an image or video (`media`: a file and a `duration`, 1–60 s), with its sound or message or alone. The library is shared by all profiles like the sounds: `settings.media`, files in the `media` folder named by a hash of their content, png, jpg, jpeg, gif, webp, mp4 or webm up to `MEDIA_MAX_BYTES` (50 MB). No SVG: opened from the overlay server, its scripts would run there. Media is never cached or sent over IPC. A rebuilt store recovers the library like the sounds' (`_findFiles`). The extensions and `mediaKind` are in `src/common/util/alerts.ts`, for the window too.
- Each alert has its own overlay at `getAlertOverlayURL(id)` (`/alerts/<alert id>/`): `ServerService` serves one page from memory (`services/server/alert.html`, loaded with `?raw`, typed by `src/main/env.d.ts`) at every id, and the page reads the id from its path. Nothing is stored for it, so deleting, cloning or importing alerts needs no cleanup, and cloned profiles share their alerts' overlays. The media folder is mounted at `/alerts/media/` (`express.static`, so videos get byte ranges).
- The window's queue times the media, so it shows with the alert's sound and waits its turn. `ALERT_AUDIO` carries `media`, and the item's place lasts `max(sound length / speed, duration)` (`minDuration`). A media-only alert sends no `data` and holds a silent place (`AudioQueue.wait`). Once the item has its place, `queueAlert` (`renderer/src/helper/alerts.ts`) emits `SHOW_ALERT_MEDIA` with the delay, and `AlertsService.showMedia` sends `tokio:alert:media` to the alert's overlay (`sendToClient`) when it's over. Main keeps the timers, so `clear` can drop the media still waiting.
- The page shows one at a time, and removes it after `duration`, when a video ends, or on `tokio:alert:clear`. It ignores the live events every client gets. A video plays at the alert's volume, muted if the browser refuses sound.
- Media rides on the alert's audio: a missing sound or a blocked or failed message skips it too. A file missing on disk (a profile imported from another computer) shows nothing, with no notice.
- The Alerts page applies a `SET_ALERT_MEDIA` reply only while that alert waits for one (`askedMedia`, apart from the sounds' `asked`). The `MediaPicker` stays open after a pick, for the duration and the overlay URL, so `IMPORT_MEDIA` also replies `GET_MEDIA`. Another file keeps the alert's duration.
- The `MediaPicker` shows the library as thumbnails, the alert's file marked with `aria-current` (the sound picker's library marks its sound the same way). The window loads them from `tokio-media:///<file>` (`getMediaPreviewURL`): main registers `MEDIA_SCHEME` with `stream` for videos and serves only images and videos right in the media folder (`mediaFile`, `src/main/helper/preview.ts`), passing the Range header on. The CSP allows it in `img-src` and `media-src`. A video shows its first frame (`#t=0.1`).
- The `MediaPicker`'s search is a `SearchToggle` in its title row (`Modal`'s `actions`), like the overlay gallery's. Its buttons' row starts with the duration, shown even without media, and the **Match video** check for a video (`match_video`, kept when another file is picked). While it's on, an effect sets the duration to the length the video's thumbnail read (`loadedmetadata`), rounded up and at most `MEDIA_MAX_DURATION`, also for a video picked later, and the duration can't be typed. It can't be turned on while the length is unknown (some recordings don't say it), and it doesn't apply to images. The picker sets it, so a file browsed after the picker closed keeps the old duration until it's opened again. `MEDIA_DURATION` and `MEDIA_MAX_DURATION` are next to the schema, in `src/common/schemas/profile.ts`.
- **Settings → Media Library** (`MediaSection`) lists the library like the Sound Library: each row a thumbnail (`MediaThumbnail`, from the picker), the name, **Full size** (a `Modal` with the image or the video playing) and **Delete**. **Upload** sends `UPLOAD_MEDIA`, which shares the `upload` loop with `UPLOAD_SOUNDS`.
- `useAlertTest` queues a test of media alone without asking main. A test with a sound or message passes the request's `media` to `queueAlert` on the reply. Stopping a test leaves its media on the overlay until it ends.
