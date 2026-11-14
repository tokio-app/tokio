---
paths:
  - "src/main/services/tts/**"
  - "src/renderer/src/pages/TTS/**"
  - "src/renderer/src/components/VoiceSelect/**"
  - "src/renderer/src/pages/Settings/sections/VoiceKeysSection.tsx"
  - "src/main/events/pages/tts.ts"
  - "scripts/edge-tts/**"
---

# TTS engines

- A provider extends `TTSProvider` (`src/main/services/tts/common`). Set `keyLabel` if it takes a key, and override `dispose` (runs on `will-quit`) if it holds resources such as child processes.
- Providers aren't picked: each is an engine, its `addProvider` name the engine id, which saved voices and keys hold. `getVoices` lists every engine's voices as `VoiceData` (`{ engine, name, lang, id }`), leaving out a failing engine, and `generateBuffer` speaks with the voice's engine.
- `id` is the engine's own id for a voice whose name can repeat or change (ElevenLabs'); the engine gets `id || name`, and `voiceKey` and the spoken-alert cache key read it the same way. `getVoices` gives every voice one, `""` for the other engines: profile saves deep-merge (`updateFile`), so a pick must replace the last voice's id, or Edge would get an ElevenLabs id.
- Voices saved before engines existed have `engine: ""`. Those, and voices of an engine that isn't registered (Windows on macOS), go to `settings.activeTTSProvider`, set by the store at startup. `generateBuffer` must still fall back to a default when given another engine's voice name, except in an engine that's never the active provider: ElevenLabs fails on an id it doesn't know (`voiceGone`).
- Engines with a `keyLabel` get a field in **Settings → Voice engines**. Their keys are saved in `settings.providers.tts` and applied to every engine at startup; `setEngineKey` trims them, saved ones too.
- `default` (the TikTok voices) sends the session ID as a cookie. A failed request, or a failed read of a 200's body, is rethrown as a new `Error` with only `formatError`'s message and no cause, so the request headers never reach `Logger`, which prints errors whole. Without a session ID it uses the third-party proxy `API_URL_ALT`, listed under Services in `THIRD_PARTY_NOTICES.md`.
- `windows` drives SAPI and OneCore voices through a long-lived 32-bit PowerShell helper, so 32-bit-only voices such as Loquendo show. Its script (`common/script.ts`) must not contain backticks, and answers `{ name, lang, engine }` per voice.
- The helper starts on the first request and exits `IDLE_TIMEOUT_MS` after the last, so it doesn't hold memory between uses. `getVoices` lists the voices once a run; a failed or empty list isn't kept, and a voice installed meanwhile shows after a restart.
- `common/script.test.ts` runs that script in a real PowerShell on Windows (CI's Windows job) with whatever voices are installed, with a raised `START_TIMEOUT_MS`, since a busy runner is slow to start the host.
- `edge` uses Microsoft's unofficial Read Aloud protocol. Read `providers/edge/README.md` before changing it. Volatile values live in its `config/index.ts`. It fetches the voice list before its first message (one shared fetch), so the default-voice fallback for a retired voice works without the TTS page.
- `elevenlabs` works only with the user's own API key, and Tokio never ships one. Its voices are the account's, all `lang: MULTILINGUAL` (`"mul"`): its models speak every language with any voice, so the picker shows them under every language and previews them in the language its filter has, else the window's. `languageName` names `mul` from the locale files: Electron's trimmed Intl shows it as is, while Node's names it, so only the real app shows the difference.
  - Without a key it lists `[]` with no request. Every `VoiceSelect` mount lists voices, so the list is kept `VOICES_TTL_MS`, and calls at once share one request under one deadline for every page. `setKey` comes on every autosave pause in Settings, so it only drops the list; a clone does too.
  - Its errors are `TTSRequestError`s holding only the status and ElevenLabs' code and message, never a cause or the request, so the key can't reach `Logger`.
  - `failureKey` turns one into the notice's text for chat TTS, the tester and previews, and cloning. It reads the code before the status: older errors send an empty quota as a 401, and a key without a permission gets a 401 "unauthorized" that only its message tells apart from a wrong key, so the provider makes that code `missing_permissions`.
  - `GET_VOICES` warns when an engine with a saved key fails to list (`tts:voices:<engine>`), logging it only when the warning goes out, so a wrong key shows. Engines without a key fail quietly, as before.

## Voice cloning

- **Clone a voice** sits on the TTS page's Voice section title row, not in Settings (the user's call). It shows when an engine with `cloneVoice` (`VoiceEngine.clones`) has a key, from `GET_VOICE_KEYS`, which main answers at once: `GET_VOICES` waits for every engine's list (ElevenLabs' over the network, the Windows helper starting). It opens `CloneVoiceModal`, whose consent box is required and never saved.
- A successful clone also replies `GET_VOICES`, and every `VoiceSelect` takes any `GET_VOICES` reply, so the new voice shows in the pickers on screen.
- Samples travel as bytes: main reads files from its own picker (`PICK_VOICE_SAMPLES`), and recordings come from the window, so main never reads a path the window names. `CLONE_VOICE` checks them (extension with `Object.hasOwn`, size, count), and they upload as `sample-<n>.<ext>`, so the user's file names stay on their computer.
- Recordings are WebM/Opus without echo cancellation, noise suppression or gain control, up to 3 minutes. macOS asks for the microphone in main first (`ASK_MICROPHONE`), as it does for the camera.
- The dialog plays a sample from a copy of its bytes: `AudioQueue` decodes the bytes it gets without copying, which detaches them, and the sample would go out empty.

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
