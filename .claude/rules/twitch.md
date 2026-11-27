---
paths:
  - "src/main/services/connector/providers/twitch/**"
  - "src/renderer/src/pages/Settings/sections/TwitchSection.tsx"
  - "src/renderer/src/components/TwitchSignIn/**"
---

# Twitch

Builds on `.claude/rules/platforms.md`.

- Twitch connects through the streamer's sign-in: Twitch's official EventSub over WebSocket and Helix, the device code flow, a public client.
- `CLIENT_ID` in `providers/twitch/config` is the Tokio app the user registered on dev.twitch.tv: a public client, no secret, so it ships. Its only redirect is `http://localhost`, which the device flow never uses.
- One Twitch account for every profile; a profile only picks whether to use it.

## The provider

- The refresh token works once and rotates. Refreshes are single-flight (`TwitchAuth.refresh`) and a quit waits for one (`track`), and the new token is saved through `onAccount` before the access token is used: two refreshes at once, or a lost save, sign the user out. The store encrypts it (`.claude/rules/store.md`).
- Twitch wants the token validated at connect and hourly (`VALIDATE_MS`). A refused refresh or a revocation signs the account out and stops the connection with `lost`.
- On a Disconnect while connecting (`canceled`), `_start` checks after the token check that the connection is still its own, so it opens no socket nothing would close. A sign-out during a connect keeps its own failure (`auth.lost`).
- EventSub: `session_reconnect` opens the new socket and keeps the subscriptions, and creating them again is a 409. A fresh socket (a drop, a keepalive timeout) subscribes again. Messages are deduped by `metadata.message_id`. Chat comes as soon as its subscription exists, before the live check ends: what `_notify` gets before `CONNECTED` (`early`) goes out right after it, so it lands in the LIVE session. `stream.online` and `stream.offline` act at once. A fresh socket gets `REQUEST_TIMEOUT_MS` for its welcome, or the try fails on the network; the keepalive watchdog only starts at the first message.
- Only the chat subscription failing fails a connect. A 403 for Bits or points on a channel that isn't affiliate, or a 429 on any other, is logged and skipped; the network still fails the try.
- `stream.offline` ends the connection only when it was seen live (at connect or since): a channel connected to while offline stays connected, so chat works before going live.
- A live check (`/streams`) that fails at connect or after a reconnect is neither live nor offline: the LIVE stays as it was and `_recheck` asks every `STREAMS_POLL_MS` until Twitch answers. A `stream.online` meanwhile wins (`conn.poll` is taken), since Helix lags behind EventSub.
- Bits come only from `channel.bits.use`, which also carries Power-ups. Chat's `cheer` field would count them twice, so it's never read, and the cheermotes are taken out of `content` so TTS doesn't read "Cheer100". A message of cheermotes alone isn't a chat (`toChat` gives null).
- Messages from other channels in a Shared Chat (`source_broadcaster_user_id`) are dropped, with the `shared_chat_*` notices.
- A community gift counts once, from its `community_sub_gift` notice. Each `sub_gift` that carries a `community_gift_id` is dropped.
- Anonymous gifters and cheerers get a user with `platform` and no id.
- Pictures (follows, subs, cheers, redeems) are looked up at most `PICTURE_LOOKUPS` a minute, so a follow train can't spend Helix's 800 a minute; past it an event goes out without one, cached pictures still apply. An event waiting for its picture is held on the connection (`held`), and a stop sends it without one before `DISCONNECTED`.
- A subscriber's months (`subMonths`) are the `subscriber` or `founder` badge's `info`, which Twitch documents as the months (not yet seen on a real subscriber's chat).

## Sign-in

- The sign-in code stays hidden until **Show** (`TwitchSignIn`, which Settings and the first-start dialog share): a viewer who typed it would sign Tokio into their own account.
- Sign-in and sign-out are never in MCP (`.claude/rules/mcp.md`), and Sign out is refused while Twitch is connected.
