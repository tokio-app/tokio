---
paths:
  - "src/main/services/connector/**"
  - "src/main/events/pages/home.ts"
  - "src/renderer/src/pages/Settings/sections/ProvidersSection.tsx"
---

# Connector

## The Euler Stream key

- The connector's provider key is the user's own Euler Stream API key, which signs the connection (`SET_PROVIDER`).
- **Settings → TikTok LIVE** (`ProvidersSection`) always shows the key. Its provider picker shows only while more than one connector is registered.

## The default connector

- It uses `@tokioapp/connector` (our MIT package, `../tokio-connector`): one `TikTokLiveConnection` per connect, with every listener added before `connect()`, so no event of the LIVE is missed.
- A connect that comes while one is connecting gets that one, so only one connection opens.
- `isConnected()` is true from the start of a connect, so the profile can't be switched mid-connect.
- `CONNECTED` comes only for a connect that worked. What its reply's `success` and `live` mean: `.claude/rules/live-session.md`.
- It reconnects on its own: a drop it recovers from calls `onReconnect` and keeps the LIVE session.
- `DISCONNECTED` only comes once the connection stops: `reason: "ended"`, `"lost"`, or none when the user disconnected.
  - It's emitted on `setImmediate`: the library emits the stream's end right after its last batch's events, whose handlers first await the profile, so the cleanup must come after them. The listeners are removed and `_connection` cleared at once.
- Gifts come in two kinds of combo, and `GIFT` sends both the same way: a growing `comboCount`, then one event with `repeatEnd`.
  - A streakable gift (type 1, like Rose): TikTok sends the count so far (`repeatCount`, skipping numbers when it batches them) and ends the streak itself 3 to 4 s after its last gift.
  - A gift that isn't streakable but has `gift.combo` (like Hand Heart): TikTok sends one message per gift, each with `repeatCount` 1 and the combo's `groupId`, and never ends it. `_listen` adds them up by sender and gift and ends the combo `COMBO_END_MS` (4 s) after its last gift. A new `groupId` ends the last combo first. The end of a connection that stopped is dropped, since its listeners already forgot their streaks.
  - Any other gift ends at once (`isStreakEnd`).
- A comment made only of emotes is its own TikTok message (`emote`, never also a `chat`). `_listen` maps it to `CHAT` with an empty `content` and `lang`, each emote at `index` 0, so Emote alerts and game actions fire and its emotes are saved.
- A failed connect's `error.kind` (`ConnectErrorKind`, `services/connector/common`) picks the message `home.ts` shows.
- The library's warnings and errors go to `connector.log` through its `logger` option, with the error they carry; its info and debug lines are dropped. An error with the same code is logged once per `LOG_REPEAT_MS`.
