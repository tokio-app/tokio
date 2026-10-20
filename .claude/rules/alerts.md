---
paths:
  - "src/main/services/alerts/**"
  - "src/main/helper/chat.ts"
  - "src/common/util/alerts.ts"
  - "src/renderer/src/pages/Alerts/**"
  - "src/renderer/src/components/AlertItem/**"
  - "src/renderer/src/components/SoundPicker/**"
  - "src/renderer/src/components/GiftSelect/**"
  - "src/renderer/src/hooks/useAlertTest.ts"
  - "src/renderer/src/pages/Settings/sections/SoundsSection.tsx"
---

# Alerts

## Triggers

- Saved per profile in `Profile.alerts` (`simultaneous`, `queue_length`, `items`).
- `AlertTriggerSchema` (`src/common/schemas/profile.ts`) derives the triggers from `TOKIO_EVENTS` (for a new event, see IPC events in `AGENTS.md`). `ROOM_USER` is excluded (it comes every few seconds and is meant for overlays), both there and in the `AlertTrigger` type. Saved Room Users alerts are dropped when a profile loads.
- `registerConnectorEvents` (`src/main/events/init.ts`) passes every trigger to `AlertsService.handle` while `activeFeatures.alerts` is on. `MUSIC_CHANGE` comes from `MusicService`, the rest from the connector. Gift alerts fire once per combo, on `repeatEnd`.
- The Emote trigger (`EMOTE_TRIGGER`) isn't a live event: the loop skips it and `AlertsService` matches it on `CHAT` (empty `trigger.emotes` means any emote). TikTok can't list a LIVE's emotes, so `StoreManagerService.recordEmotes` saves the ones seen in chat to `Profile.emotes`, and main pushes the list with `EMOTES`.
- Chat alerts filter on `trigger.keyword` through `hasKeyword` (`src/main/helper/chat.ts`, whole words), and Member Join and Super Fan Join alerts on `trigger.user` through `isUser` (handle or name).

## Gifts

- TikTok's gift list (`extra/gifts.json`) misses some gifts, like other regions' ones. `OverlayService.recordGift` saves the ones viewers send that aren't on it to `extra/custom-gifts.json`, shared by all profiles. It saves nothing while TikTok's list is empty, since every gift would look missing, and keeps both lists in memory once read, since every gift event checks them.
- The Alerts page reads them with `GET_CUSTOM_GIFTS`, and main pushes new ones on its reply, `CUSTOM_GIFTS`. `giftOptions` merges both lists cheapest first, each id once. Overlay gift settings use TikTok's list only.

## Sounds

- Uploaded, browsed and downloaded sounds go to a library shared by all profiles, in `settings.sounds`. Files in the `sounds` folder are named by a hash of their content (uploads) or URL (MyInstants), and alerts store only the basename.
- Read them through `AlertsService.readSound` (keeps paths inside the folder, caches). Check `StoreManagerService.isSoundInUse` before deleting one.
- MyInstants has no API; `AlertsService` scrapes it with cheerio. Only fetch `www.myinstants.com` URLs.
- Main sends sounds with `ALERT_AUDIO` on a queue (`channel`): one `alerts` queue, or `alerts:<trigger>` per trigger when `simultaneous` is on. `ALERT_CLEAR` (on disconnect and when the feature turns off) stops every `alerts*` queue. Tests and previews use `useAlertTest` on the `alert-test` queue, so clearing never cuts them.

## Text-to-speech

- An alert plays `sound` or speaks `tts` (a message with its own voice, speed and pitch). `tts` wins if both are set, and the picker clears one when the other is picked.
- `AlertsService.speak` fills the message with `formatAlertMessage` (variables per trigger in `ALERT_MESSAGE_VARIABLES`, `src/common/util/alerts.ts`), runs it through `TTSService.prepareText` (banned words, replacements, Remove Emojis) and generates it with the speaker from `setSpeaker`, caching it in the sound LRU under a `tts:` key.
- Alert queues are shared, so speed and pitch travel per sound on `ALERT_AUDIO.filters`, and `AudioQueue` items can override the queue's filters.
- Like chat TTS, alerts from live events make their messages through a `TaskQueue` with the TTS page's cooldown and queue length, so bursts can't flood the engine: blocked messages never enter it, and the ones past the length are dropped.
- `clearSpeech` runs wherever `ALERT_CLEAR` is sent. Previews call `speak` directly.
