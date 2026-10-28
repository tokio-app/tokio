---
paths:
  - "src/main/services/tts/**"
  - "src/renderer/src/pages/TTS/**"
  - "src/renderer/src/components/VoiceSelect/**"
  - "src/renderer/src/pages/Settings/sections/VoiceKeysSection.tsx"
  - "scripts/edge-tts/**"
---

# TTS engines

- A provider extends `TTSProvider` (`src/main/services/tts/common`) and implements `label`, `getVoices` (may be async), `generateBuffer` and `setKey`. Set `keyLabel` if it takes a key. Override `dispose` (runs on `will-quit`) if it holds resources such as child processes.
- Providers aren't picked: `TTSService` treats each one as an engine, and its `addProvider` name is the engine id. `getVoices` lists every engine's voices as `VoiceData` (`{ engine, name, lang }`), and `generateBuffer` speaks with the voice's engine. A failing engine is logged and left out of the list.
- Voices saved before engines existed have `engine: ""`. Those, and voices naming an engine that isn't registered (Windows on macOS), go to the active provider: `settings.activeTTSProvider`, set by the store at startup. `generateBuffer` must still fall back to a default when given another engine's voice name.
- Engines with a `keyLabel` get a field in Settings → Voice engines (`GET_VOICE_KEYS` / `SET_VOICE_KEY`). Their keys are saved encrypted in `settings.providers.tts` and applied to every engine at startup; `setEngineKey` trims them, saved ones too.
- `default` (the TikTok voices) sends the session ID as a cookie. A failed request, or a failed read of a 200's body, is rethrown as its own `Error` with no cause, only `formatError`'s message, so nothing holding the request headers reaches `Logger`, which prints errors whole. Without a session ID it uses the third-party proxy `API_URL_ALT` (`ottsy.weilbyte.dev`), listed under Services in `THIRD_PARTY_NOTICES.md`.
- `windows` drives SAPI and OneCore voices through a long-lived 32-bit PowerShell helper, so 32-bit-only voices such as Loquendo are visible. Its script in `common/script.ts` must not contain backticks, and answers `{ name, lang, engine }` per voice.
- `common/script.test.ts` runs that script in a real PowerShell on Windows (CI's Windows job), with whatever voices are installed, and raises `START_TIMEOUT_MS`, since a busy runner takes longer to start the host.
- `edge` uses Microsoft's unofficial Read Aloud protocol. Read `providers/edge/README.md` before changing it. Volatile values live in its `config/index.ts`. Its `common/drm-v2.ts` is LGPL-3.0-only: see Licensing in `AGENTS.md`. It fetches the voice list before its first message (one shared fetch), so the default-voice fallback for a retired voice works without the TTS page.

## Chat TTS

- `TTSService.talk` checks a chat message and makes its audio on a `TaskQueue` (cooldown and queue length from the TTS page).
- With a trigger other than "any", the comment must start with it, in any case (phones capitalize the first letter), and it's cut off and isn't read.
- A blank command (only spaces) reads nothing, since it would match every message. Choosing **Custom** on the TTS page fills in `!tts` (`MODE_VALUES`, `FormatSection.tsx`).
- A message that's empty once the trigger is cut, or only invisible characters (`isBlank`, `src/main/helper/chat.ts`), is skipped.
- So is one whose filled text has no letter, number or emoji, since Edge sends no audio for punctuation alone. `prepareText` refuses such text, so the TTS page's tester warns.
- Replacements match whole words in any case (`wholeWord`, `src/main/helper/chat.ts`): an end that isn't a letter, digit or `_` (":)") matches anywhere, and so does one next to letters of scripts written without spaces (Han, Kana, Thai, Lao, Khmer, Myanmar).
- Banned words are checked in the comment, the name and the handle, not in the template's own words.
- Both sides are folded first (NFKD, without marks or invisible characters, lowercased, look-alike Cyrillic, Greek and Turkish letters mapped to Latin by `LOOKALIKES`), so accents, styled letters, look-alikes and zero-width spaces can't hide a word. Look-alikes are mapped only in words with a Latin letter, so Russian or Greek is kept. An entry that folds to nothing matches nothing.
- The template is filled once with `formatAlertMessage`, so a comment or name that looks like a variable is read as written.
- `hasPermission` (`src/main/helper/permissions.ts`, shared with music requests): with the lists on, a handle on the block list is refused and a non-empty allow list decides alone; otherwise Allow everyone, then the roles.
- **Special users** (`tts.user_voices`, `UserVoicesSection.tsx`): a message from a listed handle (`sameHandle`, the first match wins) is read with that user's voice. Only the voice changes: the trigger, permissions, protection and the page's speed, pitch and volume still apply. A new row starts with the page's voice.
- Main sends each message with `TTS_AUDIO { id, data, filters, queueOptions }` to the window's `tts_data` queue, with speed and pitch per message, so a change spares the queued ones.
- The window answers `TTS_PLAYED { id }` when a message ends or is dropped. Main makes the next message only while fewer than min(2, queue length) are held, so the queue length bounds main's backlog and nothing is made just to be dropped. A hold ends after `HOLD_TIMEOUT_MS`, and a repeat `LOAD_APP` (a reloaded window) calls `releaseHeld()`.
- A failed generation isn't logged by `TTSService`: `init.ts` logs it to `tts.log` only when its notice (`TTS_GENERATION_FAILED`) goes out, like a missing alert sound.
- `TTS_CLEAR` (on disconnect, and when TTS is turned off, with `clearTalk()`) stops `tts_data`. `clearTalk()` drops the waiting messages, the one being made and the held ids.
- The TTS page's tester (`GET_TTS_TEST`) runs `prepareText` only: it doesn't cut the trigger, fill the template or check permissions.
