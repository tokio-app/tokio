---
paths:
  - "src/main/services/connector/**"
  - "src/main/events/pages/home.ts"
  - "src/renderer/src/pages/Settings/sections/ProvidersSection.tsx"
---

# Connector

## The Euler Stream key

- The connector's provider key is the user's own Euler Stream API key, which signs the connection. It's set with `SET_PROVIDER`.
- Never log the key or ship a shared one (see Persistence in `AGENTS.md`).
- **Settings → TikTok LIVE** (`ProvidersSection`) always shows the key. Its provider picker shows only while more than one connector is registered.

## The default connector

- It uses `@tokioapp/connector` (our MIT package, `../tokio-connector`): one `TikTokLiveConnection` per connect, with every listener added before `connect()`, so no event of the LIVE is missed. Upgrades go through the `add-dependency` skill; see Licensing in `AGENTS.md` for the code it must never take.
- A connect that comes while one is connecting gets that one, so only one connection opens.
- `isConnected()` is true from the start of a connect, so the profile can't be switched mid-connect.
- `CONNECTED` comes only for a connect that worked. The `CONNECTED` reply's `success` is that profile lock; its `live` is true once the LIVE session has started (see `.claude/rules/live-session.md`).
- It reconnects on its own: a drop it recovers from calls `onReconnect` and keeps the LIVE session.
- `DISCONNECTED` only comes once the connection stops: `reason: "ended"`, `"lost"`, or none when the user disconnected.
- A failed connect's `error.kind` (`ConnectErrorKind`, `services/connector/common`) picks the message `home.ts` shows.
- The library's warnings and errors go to `connector.log` through its `logger` option, with the error they carry; its info and debug lines are dropped. An error with the same code is logged once per `LOG_REPEAT_MS`.
- A new live event is mapped in `_listen`: see the `live-event` skill.
