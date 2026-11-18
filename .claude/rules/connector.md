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
- `isConnected()` is true from the start of a connect, through its retries, while reconnecting and while it looks for the LIVE (below), so the profile can't be switched then. `_connect`'s early return checks the connection's own state instead, or a try of the look would answer itself.
- `CONNECTED` comes only for a connect that worked. What its reply's `success` and `live` mean: `.claude/rules/live-session.md`.
- It reconnects on its own: a drop it recovers from calls `onReconnect` and keeps the LIVE session. The drop and each retry (`RECONNECTING`) call `onReconnect("reconnecting")`, and `init.ts`'s 30 s window lets one notice through per window, so a drop that lasts is said again (the user's call) and a flapping one isn't repeated.
  - It never gives up while the user stays connected, and once a drop lasts tries every 7.5 to 15 s (`RECONNECT`, the user's calls). Each attempt costs Euler requests (2 or 3), and Euler's free plan allows 1,500 a day, so think before shortening it.
- Only a first connect that failed on the network is tried again (`canRetry`: a `retryable` `ConnectorError` that isn't a `RateLimitError`), `CONNECT_TRIES` in all, `CONNECT_RETRY_MS` apart; offline, not found and key problems are told at once (the user's call). `disconnect()` ends the wait. A `ROOM_NOT_FOUND` that's `retryable` failed on the network, so it's `"network"`, not `"notFound"`.
- After an abnormal stop, it looks for the LIVE for `WAIT_MS` (2 minutes), a try every `WAIT_TRY_MS`, and a LIVE it finds starts a new session (the user's calls). The notices say 2 minutes: change them with `WAIT_MS`.
  - Abnormal is the connection lost (`signError`, `wsError`, `wsClose`), or the LIVE found ended while away: by a reconnect's live check, or in the batches a reconnect caught up on, which the library dispatches in the same tick as `connected` (`catchingUp`). Not a Disconnect, nor TikTok's end on a working connection, which is how a LIVE ended on purpose looks (the user's call).
  - It's set before the `setImmediate` that emits `DISCONNECTED`, which reads `isWaiting()`. The first try waits `WAIT_TRY_MS`, so the DISCONNECTED handlers run before a try's `CONNECTED`, and a try returns unless the look is still its own: its `connect()` resolves even when that connection ended at once.
  - A stop before the last look's deadline keeps that deadline, so a room that ends as soon as it's joined can't loop, adding empty LIVEs to history. `noKey`, `badKey` and `premium` end it at once; giving up calls `onReconnect("stopped")`. Connect (only MCP can, since Home shows Disconnect) and Disconnect end it.
- `DISCONNECTED` only comes once the connection stops: `reason: "ended"`, `"lost"`, or none when the user disconnected.
  - It's emitted on `setImmediate`: the library emits the stream's end right after its last batch's events, whose handlers first await the profile, so the cleanup must come after them. The listeners are removed and `_connection` cleared at once.
- Gifts come in two kinds of combo, and `GIFT` sends both the same way: a growing `comboCount`, then one event with `repeatEnd`.
  - A streakable gift (type 1, like Rose): TikTok sends the count so far (`repeatCount`, skipping numbers when it batches them) and ends the streak itself 3 to 4 s after its last gift.
  - A gift that isn't streakable but has `gift.combo` (like Hand Heart): TikTok sends one message per gift, each with `repeatCount` 1 and the combo's `groupId`, and never ends it. `_listen` adds them up by sender and gift and ends the combo `COMBO_END_MS` (4 s) after its last gift, waiting 4 s more each time while the connection is `reconnecting`: a reconnect delivers the gap's gifts as it turns `connected`. A new `groupId` ends the last combo first. The end of a connection that stopped is dropped, since its listeners already forgot their streaks.
  - Any other gift ends at once (`isStreakEnd`).
- Chat goes out through `emitChat`, which runs Chat translation's stage first (`.claude/rules/translation.md`). Emitting `CHAT` directly would skip it.
- A comment made only of emotes is its own TikTok message (`emote`, never also a `chat`). `_listen` maps it to `CHAT` with an empty `content` and `lang`, each emote at `index` 0, so Emote alerts and game actions fire and its emotes are saved.
- A failed connect's `error.kind` (`ConnectErrorKind`, `services/connector/common`) picks the message `home.ts` shows.
- The library's warnings and errors go to `connector.log` through its `logger` option, with the error they carry, and so do its info lines (connects with their attempt, reconnect attempts, the LIVE's end, stops with their error), so a connection that stopped says why. Its debug lines go to `Logger.debug`. An error with the same code is logged once per `LOG_REPEAT_MS`.
