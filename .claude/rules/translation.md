---
paths:
  - "src/main/services/translation/**"
  - "src/renderer/src/pages/Settings/sections/TranslationSection.tsx"
  - "src/renderer/src/hooks/useVariables.ts"
  - "src/renderer/src/hooks/useTranslationLanguage.ts"
---

# Chat translation

## The user's calls

- Each chat message is translated once, as it arrives, before any listener gets it. Only that message waits; the others go on at once.
- Google's free endpoint only. DeepL was built and taken out (the user's call): its free API plan is now a one-time 1,000,000 characters, then a paid plan streamers wouldn't pay for.
- One picker, **Settings → Chat translation** (`settings.translation.language`, `""` is off), for every feature. An English voice may end up reading Spanish.
- `{comment}` stays as the viewer typed it. `comment.translation` and `{translation}` carry the translation, and the windows offer `{translation}` only while a language is picked (`useVariables`). TTS's **Read translations** (`tts.format.translate`) puts the translation in `{comment}`'s place.
- Commands stay as typed: music controls' (the song name after one too), overlays' (registered in their own files), and the keywords of chat triggers. The TTS trigger stays at the start and the rest is translated.
- Mentions never reach the engine.
- A tester in Settings (`TEST_TRANSLATION`).

## The pipe

- `ConnectorProvider.emitChat` runs the stage `init.ts` sets (`setChatStage`, `TranslationService.forChat`). Chat must go through `emitChat`, never `emit(CHAT)`.
- `forChat` returns null synchronously for a chat it won't translate, which then goes out in the same tick, keeping its order with the batch's other events. Keep that null synchronous.
- A staged chat goes out alone when its promise settles, if its connection is still current: a stopped connection's is dropped, like a combo's end (`.claude/rules/connector.md`). The promise never rejects; a failure gives back the chat as typed.
- Fake chats emitted on the connector's inner emitter (drive-app's RECIPES) skip the stage, so the real app's tester is the end-to-end check.

## What's translated

- Only messages TikTok tagged (`comment.lang` not empty) with another base language than the target's, with a letter, while translation isn't paused. That gate reads nothing else; `chatCommands` (`commands.ts`) is read only past it.
- `chatCommands`: the active profile's TTS trigger and enabled music commands (`startsWithCommand`), the keywords of the alerts, game actions and Studio elements that are on with a Chat trigger (any row of an alert's or a Studio item's; `matchesTrigger` reads no keyword on Emote), the timer's while chat adds time (`hasKeyword`), and `OverlayService.chatCommands()`.
- Overlays register commands with `command: true` on an `input` field or table column, and `info.yaml`'s `commands`. `OverlayService` keeps them per overlay, refreshed whenever it reads or writes an overlay's files.
- Mentions at the ends are cut and put back; middle ones become `<n>` stand-ins, swapped back. A lost stand-in, or typed text that looks like one, drops the translation. A handle confuses detection: Google read `@kenji hi` as Japanese.
- A translation is dropped when Google detects the target language. Promises are cached by target and text (`CACHE_SIZE`); a failed one leaves the cache.

## Google

- Its endpoint is undocumented, like Edge's Read Aloud. The URL, the 3 s timeout and the code map sit in `providers/google/config`; the reply's shape is checked.
- A failure pauses translation for `PAUSE_MS`, and chat goes on as typed meanwhile. `test()` skips the language gate, the cache, the pause and the turns.
- Requests take turns (the user asked for a delay when there are too many): `RATE_PER_SECOND` after a burst of `RATE_BURST`, and a message that would wait over `MAX_WAIT_MS` goes on as typed, with no request and no notice. Measured on 2026-11-15: Google answered 429 ("Sorry...") to 3 requests a second after about 60, recovered within 20 s, and took 1 a second for minutes, bursts of 10 included. Measure again before raising them (`rate-test.mjs`'s method: rising steady rates, stopping at the first refusal).
- `TRANSLATION_LANGUAGES` are the languages the picker offers, all of them Google's.

## Errors and notices

- `TranslationError` holds only the status and a code: never a cause, the request or the chat text, which Google's URL carries.
- `init.ts` warns under `translation` once per `REPEAT_NOTICE_MS`, logging to `translation.log` only when the notice goes out.

## Contract

`ChatEvent.comment.translation` (`{ text, from, to }`, lowercase BCP 47 tags) is public. The overlay SDK's `ChatData` and the website's events docs describe it, and emotes' `index` still points into `content`. Change them together.
