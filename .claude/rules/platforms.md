---
paths:
  - "src/main/services/connector/index.ts"
  - "src/main/services/connector/common/**"
  - "src/main/services/connector/providers/twitch/**"
  - "src/common/util/platforms.ts"
  - "src/common/types/connector.ts"
  - "src/renderer/src/components/AlertItem/TriggerSelect.tsx"
  - "src/renderer/src/context/platforms/**"
  - "src/renderer/src/pages/Home/sections/DashboardSection.tsx"
  - "src/renderer/src/pages/Settings/sections/TwitchSection.tsx"
---

# Platforms

Tokio connects to TikTok and Twitch (`PLATFORMS`, `src/common/types/connector.ts`), several at once. TikTok's provider is in `.claude/rules/connector.md`. YouTube and Kick come later (the user's call): YouTube without a key, Kick through its site's socket. YouTube's Gifts and Kick's Kicks will count as `GIFT`, with their price as coins. Twitch's Bits are `CHEER`.

## What the user chose

- One LIVE session spans every platform the profile uses (the user's call): one feed, one Coin stats record, one timer, one Studio, alerts, TTS, music and games for all.
- The profile picks its platforms on Home, by the connect box (`SET_PLATFORMS`, refused while connected). Its `platforms` and `channels` are the profile's own, so each profile can use different ones.
- A trigger row is `[platform] [event]` (the user's call). The platform select shows only once the profile uses two or more platforms, or when the row already has one saved.
- Twitch connects through the streamer's sign-in: Twitch's official EventSub over WebSocket and Helix, the device code flow, a public client. The client ID isn't a secret and ships in `providers/twitch/config`. Nothing else of Twitch's is shipped, and no code is copied from any Twitch, YouTube or Kick library, only MIT, BSD and Apache references are read (Licensing in `AGENTS.md`).
- One Twitch account for every profile; a profile only picks whether to use it.

## The session across platforms

`ConnectorService` (`src/main/services/connector`) owns one `SessionEvents` emitter that consumers (`init.ts`, the services) listen to, and wires each provider to it once. TikTok's backends stay in `ProviderService`'s pool, so Settings' picker and the store never list Twitch; other platforms are added with `_addPlatform`. A pool backend forwards only while it's `_current`.

- First up, last down: the first platform's `CONNECTED` sends the session's `CONNECTED`, the last `DISCONNECTED` sends its `DISCONNECTED`. In between, `onPlatform(platform, "up" | "ended" | "lost" | "stopped")` and `onReconnect(state, platform)` tell the one platform. With TikTok alone nothing changes from before.
- `disconnect()` stops every platform at once and each stop arrives on `setImmediate`, so `_stopping` keeps them from being told one by one ("TikTok disconnected" in the middle of a Disconnect). It clears when the last one is down or at the next `connect()`.
- Notices (`init.ts`): with one platform, the keys and texts it always had. With several, they name the platform and are keyed per platform (`reconnect:<p>`, `connect:<p>`), so one platform's notice doesn't dedupe another's.
- `ROOM_USER` is merged from each platform's last: TikTok's `ranks`, the sum of `viewers` and `views`, sent again when a platform goes down.
- `isConnected()` is any platform (the profile lock). `isReconnecting()` is every platform up reconnecting. `isWaiting()` is no platform up and TikTok looking for its LIVE. `status()` is each platform that's on, `connecting | connected | reconnecting | waiting`, and goes out as `CONNECTED.platforms`.
- `username` is the first platform up's channel, set before `CONNECTED` fires, so `history.start(conn.username)` and the profile's name for the session don't change. Twitch's channel is the signed-in account's.
- `connect(channels, onResult)` connects the platforms in parallel. One already up answers success at once, so a CONNECT while live joins only the platforms that are down. That's Home's **Try again**.
- `CONNECT` with one platform answers as before (the reply and "Connected to @handle" at `CONNECTED`, a thrown failure). With several, the reply comes at the session's first `CONNECTED` with no notice, each platform's result is its own notice, and all of them failing replies the state without throwing, which would add one more notice.
- `shortcut:` one platform going down doesn't clear alerts', games' and Studio's gift streaks; the session's end does.

## Ids

Every provider except TikTok's namespaces the ids it sends: `twitch:<id>` for `UserData.userId`, emote ids and gift ids. TikTok's stay bare, because saved data has them. So history's gifters, fans, streaks, `Profile.emotes`, Emote triggers and picked-gift triggers (`Number(id)` is NaN) can't mix platforms, with no change to their keys. "Any gift" and `min_coins` still work, and `recordGift` drops such ids. A new provider namespaces at the provider, not downstream.

## Contracts

- `UserData.platform` is missing for TikTok (`platformOf`), everything sent or saved before other platforms. `ActivityUser`, `TopGifter` and history's gifters carry it the same way.
- A trigger's `platform` is missing for any platform, and one a newer Tokio saved that this one doesn't know reads as any (`.catch`). `matchesTrigger` skips a row whose platform isn't the event's, and Music change matches only a row for any.
- The profile's top-level `platforms` (default `["tiktok"]`) and `channels` (the name typed for each platform that takes one): unknown platforms are dropped when read, so an older Tokio still loads a newer profile. `connector.username` stays TikTok's.
- `PLATFORM_TRIGGERS` (`src/common/util/platforms.ts`) is one row per platform, so a new platform touches only its own. Every trigger must be on a platform or be Music change (its test). The pickers, the feed kinds, the stat tiles and the timer rows all derive from it through `triggersFor`; don't list triggers by hand.
- `TIMER_TRIGGERS` (`src/common/util/timer.ts`) names the event each timer trigger counts, so a profile's platforms say which timer rows and carousel items apply.
- The feed, Coin stats and the overlays' payloads only add fields.

## What other platforms don't send

- Followers and fan levels: a Twitch chatter's `follower` is false and `fanLevel` missing, so **Followers** and **Minimum fan level** never pass them. Moderators and Super Fans work (Twitch's broadcaster and moderators, subscribers and founders). The permissions section and the website say so in one line.
- Chat language: translation stays TikTok's (the user's call: letting Google detect Twitch's messages would spend its rate limit on the streamer's own language; `.claude/rules/translation.md`).
- Follows: every follow counts, a viewer's repeat follows in one LIVE included (the user's call). Twitch sends one each time a viewer follows again after unfollowing.
- Chat pictures: Twitch chat goes without (`shortcut:` in `providers/twitch/index.ts`), `Avatar` shows the initial. Follows, subs, cheers and redeems look their picture up once and cache it.
- Fans stay TikTok's (`.claude/rules/fans.md`).

## Twitch

- The refresh token works once and rotates. Refreshes are single-flight (`TwitchAuth.refresh`), and the new token is saved through `onAccount` before the access token is used: two refreshes at once, or a lost save, sign the user out. The store encrypts it (`.claude/rules/store.md`).
- Twitch wants the token validated at connect and hourly (`VALIDATE_MS`). A refused refresh or a revocation signs the account out and stops the connection with `lost`.
- EventSub: `session_reconnect` opens the new socket and keeps the subscriptions, and creating them again is a 409. A fresh socket (a drop, a keepalive timeout) subscribes again. Messages are deduped by `metadata.message_id`.
- Only the chat subscription failing fails a connect. A 403 for Bits or points on a channel that isn't affiliate is logged and skipped.
- `stream.offline` ends the connection only when it was seen live (at connect or since): a channel connected to while offline stays connected, so chat works before going live.
- Bits come only from `channel.bits.use`, which also carries Power-ups. Chat's `cheer` field would count them twice, so it's never read, and the cheermotes are taken out of `content` so TTS doesn't read "Cheer100".
- Messages from other channels in a Shared Chat (`source_broadcaster_user_id`) are dropped, with the `shared_chat_*` notices.
- A community gift counts once, from its `community_sub_gift` notice. Each `sub_gift` that carries a `community_gift_id` is dropped.
- A **Redeem** row's keyword is the reward's title, matched in any case, empty for any (`matchesTrigger`).
- Anonymous gifters and cheerers get a user with `platform` and no id.
- The sign-in code stays hidden until **Show** (`TwitchSection`): streamers show their screen, and a viewer who typed it would sign Tokio into their own account. Sign-in and sign-out are never in MCP (`.claude/rules/mcp.md`), since they need the streamer at a browser, and Sign out is refused while Twitch is connected.
- `CLIENT_ID` in `providers/twitch/config` is the Tokio app the user registered on dev.twitch.tv: a public client (no secret), its only redirect `http://localhost`, which the device flow never uses. It isn't a secret.

## The window

- `PlatformsContext` (`src/renderer/src/context/platforms`) gives the trigger pickers the active profile's platforms. A page provides it from `useEditableSettings`' `onLoad(profile)`, or from one page-level `GET_PROFILE` (the Studio editor, Countdown). Never ask `GET_PROFILE` per component: its reply drops the page's unsaved autosave.
- Home keeps its own platforms state (`DashboardSection`): the toggles, a row per platform, **Try again** for one that failed or stopped while the rest are live, and a `SET_PLATFORMS` reply that resyncs the toggles to what main holds.
- Studio overlays are shared by profiles, but their pickers follow the active profile's platforms. A row saved with an event or platform the profile no longer uses keeps showing it.
- Changing a row's platform to one without its event moves it to that platform's first event (`withPlatform`; Studio's rows through `retype`).
