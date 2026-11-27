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
- Providers aren't picked: each is an engine, its `addProvider` name the engine id, which saved voices and keys hold. `getVoices` lists every engine's voices, leaving out a failing engine, and `generateBuffer` speaks with the voice's engine.
- `id` is the engine's own id for a voice whose name can repeat or change (the keyed engines'); the engine gets `id || name`, and `voiceKey` and the spoken-alert cache key read it the same way. `getVoices` gives every voice one, `""` for the other engines: profile saves deep-merge (`updateFile`), so a pick must replace the last voice's id, or Edge would get an ElevenLabs id.
- Voices saved before engines existed have `engine: ""`. Those, and voices of an engine that isn't registered (Windows on macOS), go to `settings.activeTTSProvider`, set by the store at startup. `generateBuffer` must still fall back to a default when given another engine's voice name, except in an engine that's never the active provider: the keyed engines fail on an id they don't know (`voiceGone`).
- Engines with a `keyLabel` get a field in **Settings → Voice engines**. TikTok's always shows; the others show once they have a key or are added from the section's + menu, so no field sits empty, and stay until their remove button clears the key (the user's call).
  - An empty key for an engine whose voices need it (`needsKey`: the keyed engines, not TikTok's, whose voices work without a session ID) puts the default voice in place of that engine's voices in every profile (`removeVoices`, the user's call), even a key cleared to paste another. `SET_VOICE_KEY` then sends the fresh profile, so the pickers stop showing a voice that can't speak.
  - Keys are saved in `settings.providers.tts` and applied to every engine at startup; `setEngineKey` trims them, saved ones too.
- `default` (the TikTok voices) sends the session ID as a cookie. A failed request, or a failed read of a 200's body, is rethrown as a new `Error` with only `formatError`'s message and no cause, so the request headers never reach `Logger`, which prints errors whole. Without a session ID it uses the third-party proxy `API_URL_ALT`, listed under Services in `THIRD_PARTY_NOTICES.md`.
- `windows` drives SAPI and OneCore voices through a long-lived 32-bit PowerShell helper, so 32-bit-only voices such as Loquendo show. Its script (`common/script.ts`) must not contain backticks.
- The helper starts on the first request and exits `IDLE_TIMEOUT_MS` after the last, so it doesn't hold memory between uses. `getVoices` lists the voices once a run; a failed or empty list isn't kept, and a voice installed meanwhile shows after a restart.
- `common/script.test.ts` runs that script in a real PowerShell on Windows (CI's Windows job) with whatever voices are installed, with a raised `START_TIMEOUT_MS`, since a busy runner is slow to start the host.
- `edge` uses Microsoft's unofficial Read Aloud protocol. Read `providers/edge/README.md` before changing it. Volatile values live in its `config/index.ts`. It fetches the voice list before its first message (one shared fetch), so the default-voice fallback for a retired voice works without the TTS page.

## Keyed engines

- `elevenlabs`, `fishaudio`, `cartesia` and `inworld` work only with the user's own API key. They extend `KeyedTTSProvider` (`common/keyed.ts`), which holds the key, the list's cache, the deadlines and the errors; each adds its requests (`_list`, `_speak`, `_clone`), its headers and how its API words a failure (`_reason`, the body typed as the API documents it).
- ElevenLabs' voices and the account's own Fish Audio voices are `lang: MULTILINGUAL` (`"mul"`): their models speak every language with any voice, so the picker shows them under every language and previews them in the language its filter has, else the window's. Cartesia's, Inworld's and Fish Audio's library voices carry the language each was made for.
- Cartesia lists the account's voices (`is_owner=true`) as well as its whole library, about 900 voices, near the pages' cap, which would otherwise leave a clone out.
- Fish Audio lists the account's voices and the library's licensed ones (`licensed=true`: rights secured from the voice's owner), the `LIBRARY_PAGES` most used. The rest of its library is anyone's uploads, often of people who didn't agree, so it isn't listed.
- `languageName` names `mul` from the locale files: Electron's trimmed Intl shows it as is, while Node's names it, so only the real app shows the difference.
- Cartesia speaks in the voice's language, since its docs don't say it detects the text's, and clones in the app's (a `shortcut:`); the others detect it. Cartesia needs its `Cartesia-Version` header on every request, Fish Audio takes the model in a `model` header, and Inworld's key is the Base64 credentials its Portal shows, sent after `Basic` as is.
- Without a key they list `[]` with no request. Every `VoiceSelect` mount lists voices, so the list is kept `VOICES_TTL_MS`, and calls at once share one request under one deadline. `setKey` comes on every autosave pause in Settings, so it only drops the list; a clone does too.
- Their errors are `TTSRequestError`s holding only the status and the API's code and message, never a cause or the request, so the key can't reach `Logger`.
- `failureKey` turns one into the notice's text for chat TTS, the tester and previews, and cloning. It reads the code before the status:
  - Older ElevenLabs errors send an empty quota as a 401, and an ElevenLabs key without a permission gets a 401 "unauthorized" that only its message tells apart from a wrong key, so the provider makes that code `missing_permissions`.
  - Cartesia's free plan gets a 402 that only its message tells apart from no credits, so the provider makes that code `plan_required` (`notAllowed`).
  - The other engines' codes are their HTTP statuses, and a clone they refuse after a 200 (Fish Audio's failed training, Inworld's reply without a voice) is a 422, so it reads as unusable samples.
- `GET_VOICES` warns when an engine with a saved key fails to list (`tts:voices:<engine>`), so a wrong key shows. Engines without a key fail quietly.

## Voice cloning

- **Clone a voice** sits on the TTS page's Voice section title row, not in Settings (the user's call). It shows when an engine with `cloneVoice` (`VoiceEngine.cloning`) has a key, from `GET_VOICE_KEYS`, which main answers at once: `GET_VOICES` waits for every engine's list. Its consent box is required and never saved.
- An engine's `cloning` limits come from its provider: how many samples it takes, how long they're best in all, and where a recording stops. Cartesia and Inworld take one clip, so the window decodes the samples, mixes them to mono, joins them and sends one 16-bit WAV cut at `maxSeconds` (`joinedWav`, `src/renderer/src/helper/wav.ts`) (Inworld takes only WAV and MP3); `CLONE_VOICE` refuses more samples than an engine takes. The others get the samples as they are.
- A successful clone also replies `GET_VOICES`, and every `VoiceSelect` takes any `GET_VOICES` reply, so the new voice shows in the pickers on screen.
- Samples travel as bytes: main reads files from its own picker (`PICK_VOICE_SAMPLES`), and recordings come from the window, so main never reads a path the window names. `CLONE_VOICE` checks them (extension with `Object.hasOwn`, size, count), and they upload as `sample-<n>.<ext>`, so the user's file names stay on their computer.
- Recordings are WebM/Opus without echo cancellation, noise suppression or gain control, up to the engine's `maxSeconds`. macOS asks for the microphone in main first (`ASK_MICROPHONE`), as it does for the camera.
- The dialog plays a sample from a copy of its bytes: `AudioQueue` decodes the bytes it gets without copying, which detaches them, and the sample would go out empty.

## Chat TTS

- `TTSService.talk` makes a chat message's audio on a `TaskQueue` (the TTS page's cooldown and queue length), and doesn't check a message a full queue would drop (`TaskQueue.full()`).
- With a trigger other than "any", the comment must start with it, in any case (phones capitalize the first letter), and it's cut off and not read. A blank command reads nothing, since it would match every message.
- A message that's empty once the trigger is cut, or only invisible characters (`isBlank`, `src/main/helper/chat.ts`), is skipped. So is one whose filled text has no letter, number or emoji, since Edge sends no audio for punctuation alone; `prepareText` refuses it, so the page's tester warns.
- Replacements match whole words in any case, as keywords do (`wholeWord`, `.claude/rules/triggers.md`).
- Banned words are checked in the comment, the name and the handle, not in the template's own words.
- Both sides are folded first (NFKD without marks, without `INVISIBLE`'s characters, lowercased, look-alike letters and small capitals mapped to Latin by `LOOKALIKES`), so accents, styled letters, look-alikes, zero-width spaces and fillers can't hide a word. Look-alikes are mapped only in words with a Latin letter, so Russian or Greek is kept. An entry that folds to nothing matches nothing.
- The template is filled once with `formatAlertMessage`, so a comment or name that looks like a variable is read as written.
- **Read translations** (`format.translate`, `.claude/rules/translation.md`) fills `{comment}`, and a template without variables, with the chat's translation, its trigger cut like the comment's, since the translation keeps it at the start. `{translation}` gets the same cut text, or the comment without one. Banned words are checked in the translation too, and a message is skipped when the typed text or its translation is over **Max message length** (`protection.comment_length`, the user's call), since either can be read.
- `hasPermission` (`src/main/helper/permissions.ts`, shared with music requests): with the lists on, a handle on the block list is refused and a non-empty allow list decides alone; otherwise Allow everyone, then the roles. Its block-list check, `isBlocked`, is also what drops a blocked viewer's alert message.
  - The roles are the viewer's platform's. `PermissionsSchema`'s own fields are TikTok's, which an older Tokio still reads, and `platforms` holds Twitch's, YouTube's and Kick's: `{ all, superfans, moderators, vips }`, `superfans` their subscribers or members.
  - A platform without an entry allows everyone (`defaultPlatformPermissions`, the user's call).
  - The lists are one set for every platform (the user's call), so a handle matches on any of them.
  - `PermissionsSection` (TTS and Music) has a tab per profile platform, each offering only what its chat says.
  - Its rule lines (`components.permissions.rule`, `ruleLevel`, `allowListRule`) say in words how `hasPermission` combines them: any one role or the fan level passes, none checked passes everyone, and a named allow list decides alone. Change them with it. Allow everyone disables the roles, since it overrides them.
- **Special users** (`tts.user_voices`): a message from a listed handle (`sameHandle`, first match wins) is read in that user's voice. Only the voice changes: the trigger, permissions, protection and the page's speed, pitch and volume still apply.
- Main sends each message with `TTS_AUDIO` to the window's `tts_data` queue, with speed and pitch per message, so a change spares the queued ones.
- The window answers `TTS_PLAYED { id }` when a message ends or is dropped. Main makes the next message only while fewer than min(2, queue length) are held, so nothing is made just to be dropped. A hold ends after `HOLD_TIMEOUT_MS`, and a repeat `LOAD_APP` (a reloaded window) calls `releaseHeld()`.
- `TTS_CLEAR` (on disconnect, and when TTS is turned off) stops `tts_data`, and `clearTalk()` drops the waiting messages, the one being made and the held ids.
- A chat message's failed audio warns under its own key (`tts:chat`): the TTS page's tester and the voice previews show their failures only through their notice, which a shared key would drop during an outage.
- An engine that refuses its key or account (`failureKey` gives `keyMissing`, `keyRejected`, `noCredits`, `keyPermissions` or `notAllowed`) on live speech is paused `PAUSE_MS` (60 s, as chat translation is), so each chat message doesn't ask again.
  - Live speech is chat and live spoken alerts (`generateBuffer`'s `live`): while the engine `_engineOf` picks is paused it fails at once with the error that paused it, and `talk` skips the message before the queue, so it takes no slot or cooldown.
  - A new key (`setEngineKey`) ends the pause. The tester and previews never pass `live`, so they always ask; Edge's errors have no `failureKey` and never pause it.
- The page's tester (`GET_TTS_TEST`) runs `prepareText` only: no trigger cut, template or permissions.
