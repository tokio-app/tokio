---
paths:
  - "src/main/services/tts/**"
  - "src/renderer/src/pages/TTS/**"
  - "src/renderer/src/components/VoiceSelect/**"
  - "src/renderer/src/pages/Settings/sections/VoiceKeysSection.tsx"
  - "scripts/edge-tts/**"
---

# TTS engines

- A provider extends `TTSProvider` (`src/main/services/tts/common`). Set `keyLabel` if it takes a key, and override `dispose` (runs on `will-quit`) if it holds resources such as child processes.
- Providers aren't picked: each is an engine, its `addProvider` name the engine id. `getVoices` lists every engine's voices as `VoiceData` (`{ engine, name, lang }`), leaving out a failing engine, and `generateBuffer` speaks with the voice's engine.
- Voices saved before engines existed have `engine: ""`. Those, and voices of an engine that isn't registered (Windows on macOS), go to `settings.activeTTSProvider`, set by the store at startup. `generateBuffer` must still fall back to a default when given another engine's voice name.
- Engines with a `keyLabel` get a field in **Settings → Voice engines**. Their keys are saved in `settings.providers.tts` and applied to every engine at startup; `setEngineKey` trims them, saved ones too.
- `default` (the TikTok voices) sends the session ID as a cookie. A failed request, or a failed read of a 200's body, is rethrown as a new `Error` with only `formatError`'s message and no cause, so the request headers never reach `Logger`, which prints errors whole. Without a session ID it uses the third-party proxy `API_URL_ALT`, listed under Services in `THIRD_PARTY_NOTICES.md`.
- `windows` drives SAPI and OneCore voices through a long-lived 32-bit PowerShell helper, so 32-bit-only voices such as Loquendo show. Its script (`common/script.ts`) must not contain backticks, and answers `{ name, lang, engine }` per voice.
- The helper starts on the first request and exits `IDLE_TIMEOUT_MS` after the last, so it doesn't hold memory between uses. `getVoices` lists the voices once a run; a failed or empty list isn't kept, and a voice installed meanwhile shows after a restart.
- `common/script.test.ts` runs that script in a real PowerShell on Windows (CI's Windows job) with whatever voices are installed, with a raised `START_TIMEOUT_MS`, since a busy runner is slow to start the host.
- `edge` uses Microsoft's unofficial Read Aloud protocol. Read `providers/edge/README.md` before changing it. Volatile values live in its `config/index.ts`. It fetches the voice list before its first message (one shared fetch), so the default-voice fallback for a retired voice works without the TTS page.

## Chat TTS

- `TTSService.talk` checks a chat message and makes its audio on a `TaskQueue` (the TTS page's cooldown and queue length). A message a full queue would drop isn't checked (`TaskQueue.full()`).
- With a trigger other than "any", the comment must start with it, in any case (phones capitalize the first letter), and it's cut off and not read. A blank command reads nothing, since it would match every message.
- A message that's empty once the trigger is cut, or only invisible characters (`isBlank`, `src/main/helper/chat.ts`), is skipped. So is one whose filled text has no letter, number or emoji, since Edge sends no audio for punctuation alone; `prepareText` refuses it, so the page's tester warns.
- Replacements match whole words in any case (`wholeWord`, `src/main/helper/chat.ts`): an end that isn't a letter, digit or `_` (":)") matches anywhere, and so does one next to scripts written without spaces (Han, Kana, Thai, Lao, Khmer, Myanmar).
- Banned words are checked in the comment, the name and the handle, not in the template's own words.
- Both sides are folded first (NFKD without marks, without `INVISIBLE`'s characters, lowercased, look-alike letters and small capitals mapped to Latin by `LOOKALIKES`), so accents, styled letters, look-alikes, zero-width spaces and fillers can't hide a word. Look-alikes are mapped only in words with a Latin letter, so Russian or Greek is kept. An entry that folds to nothing matches nothing.
- The template is filled once with `formatAlertMessage`, so a comment or name that looks like a variable is read as written.
- `hasPermission` (`src/main/helper/permissions.ts`, shared with music requests): with the lists on, a handle on the block list is refused and a non-empty allow list decides alone; otherwise Allow everyone, then the roles. Its block-list check, `isBlocked`, is also what drops a blocked viewer's alert message.
- **Special users** (`tts.user_voices`): a message from a listed handle (`sameHandle`, first match wins) is read in that user's voice. Only the voice changes: the trigger, permissions, protection and the page's speed, pitch and volume still apply.
- Main sends each message with `TTS_AUDIO` to the window's `tts_data` queue, with speed and pitch per message, so a change spares the queued ones.
- The window answers `TTS_PLAYED { id }` when a message ends or is dropped. Main makes the next message only while fewer than min(2, queue length) are held, so nothing is made just to be dropped. A hold ends after `HOLD_TIMEOUT_MS`, and a repeat `LOAD_APP` (a reloaded window) calls `releaseHeld()`.
- `TTS_CLEAR` (on disconnect, and when TTS is turned off, with `clearTalk()`) stops `tts_data`. `clearTalk()` drops the waiting messages, the one being made and the held ids.
- A chat message's failed audio warns under its own key (`tts:chat`): the TTS page's tester and the voice previews show their failures only through their notice, which a shared key would drop during an outage.
- The page's tester (`GET_TTS_TEST`) runs `prepareText` only: no trigger cut, template or permissions.
