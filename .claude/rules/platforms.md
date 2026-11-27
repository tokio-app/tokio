---
paths:
  - "src/main/services/connector/**"
  - "src/common/util/platforms.ts"
  - "src/common/types/connector.ts"
  - "src/renderer/src/context/platforms/**"
  - "src/renderer/src/hooks/useProfilePlatforms*"
  - "src/main/events/pages/home.ts"
---

# Platforms

Tokio connects to TikTok, Twitch, YouTube and Kick (`PLATFORMS`, `src/common/types/connector.ts`), several at once. TikTok's provider is in `.claude/rules/connector.md`, the others' in `twitch.md`, `youtube.md` and `kick.md`. Twitch's Bits are `CHEER`, YouTube's Super Chats and Super Stickers `SUPER_CHAT`, YouTube's Gifts `GIFT` with their price in Jewels as `coins`, and Kick's Kicks `KICKS` (`kicks` and the pinned `message`), like Bits: Kicks are never gifts (the user's call).

## What the user chose

- One LIVE session spans every platform the profile uses (the user's call): one feed, one LIVE history record, one timer, one Studio, alerts, TTS, music and games for all.
- The profile picks its platforms on Home, with the `+` after the tabs and each tab's remove (`SET_PLATFORMS`). A platform can be added while live and connected alone; one that's on stays until it's disconnected (main keeps it). Its `platforms` and `channels` are the profile's own, so each profile can use different ones.

## The session across platforms

`ConnectorService` (`src/main/services/connector`) owns one `SessionEvents` emitter that consumers (`init.ts`, the services) listen to, and wires each provider to it once. TikTok's backends stay in `ProviderService`'s pool, so Settings' picker and the store never list Twitch; other platforms are added with `_addPlatform`. A pool backend forwards only while it's `_current`.

- First up, last down: the first platform's `CONNECTED` sends the session's `CONNECTED`, the last `DISCONNECTED` sends its `DISCONNECTED`. In between, `onPlatform(platform, "up" | "ended" | "lost" | "stopped")` and `onReconnect(state, platform)` tell the one platform. With TikTok alone nothing changes from before.
- `disconnect()` stops every platform at once and each stop arrives on `setImmediate`, so `_stopping` keeps them from being told one by one ("TikTok disconnected" in the middle of a Disconnect). It clears when the last one is down or at the next `connect()`.
- Notices (`init.ts`): with one platform, the keys and texts it always had. With several, they name the platform and are keyed per platform (`reconnect:<p>`, `connect:<p>`), so one platform's notice doesn't dedupe another's.
  - `endedBy()` is the platform whose stop ended the session, set before its `DISCONNECTED`. The end's "away" and "looking" texts are TikTok's look, so only when it's TikTok.
  - Twitch's `lost` is always its sign-out, so it says to sign in again (`twitchBadKey`), and an account saved with no key pushes `TWITCH_ACCOUNT` with no login, so the window shows it signed out.
- `ROOM_USER` is merged from each platform's last: TikTok's `ranks`, the sum of `viewers` and `views`, sent again when a platform goes down. Overlays and Studio get only the sum; `viewers()` gives each platform's for Home's tabs (`.claude/rules/live-session.md`).
- `isConnected()` is any platform (the profile lock). `isReconnecting()` is every platform up reconnecting. `isWaiting()` is no platform up and TikTok looking for its LIVE. `status()` is each platform that's on, `connecting | connected | reconnecting | waiting`, and goes out as `CONNECTED.platforms`. Up is checked first: TikTok's look sends `CONNECTED` while it still waits, and `registerHistory` joins only platforms `connected` then.
- `username` is the first platform up's channel, set before `CONNECTED` fires, so `history.start(conn.username)` and the profile's name for the session don't change. Twitch's channel is the signed-in account's.
- `connect(channels, onResult)` connects the platforms in parallel. One already up answers success at once, so a CONNECT while live joins only the platforms that are down. `CONNECT`'s `platforms` picks which, as a platform tab's Connect sends. `disconnect(platform)` stops one platform alone, outside `_stopping`, so its stop is told as that platform's ("Disconnected from Kick").
- `CONNECT` with one platform answers as before (the reply and "Connected to @handle" at `CONNECTED`, a thrown failure). With several, the reply comes at the session's first `CONNECTED` with no notice, each platform's result is its own notice, and all of them failing replies the state without throwing, which would add one more notice. A failure replies the state main holds, so a tab's failed Connect leaves the others' LIVE on.
- A failed connect's `error.kind` (`ConnectErrorKind`, `connector/common`) picks the message `home.ts` shows.
- A Disconnect while a platform connects cancels it (`canceled`): no socket opens after it, no message, and `CONNECT` replies the state. Kick and YouTube decide it in `_connect`'s catch before `_stop`, since the stop closes the socket or wakes the retry wait, which would read as the network. A stopped connect can still be finishing its requests, so `connect()` reuses one in progress only while its connection is still on (`_conn`): a Connect right after a Disconnect starts over instead of getting its silent `canceled`.
- Every provider sends chat through `emitChat` (`connector/common`), never `emit(CHAT)`: it runs Chat translation's stage first (`.claude/rules/translation.md`).
- `shortcut:` one platform going down doesn't clear alerts', games' and Studio's gift streaks; the session's end does.

## Ids

Every provider but TikTok's namespaces the ids it sends: `twitch:<id>` for `UserData.userId`, emote ids and gift ids. TikTok's stay bare, because saved data has them. So history's gifters, fans, streaks, `Profile.emotes`, Emote triggers and picked-gift triggers (`Number(id)` is NaN) can't mix platforms, with no change to their keys. "Any gift" and `min_coins` still work, and `recordGift` drops such ids. A new provider namespaces at the provider, not downstream.

## Contracts

- `UserData.platform` is missing for TikTok (`platformOf`), everything sent or saved before other platforms. `ActivityUser`, `TopGifter` and history's gifters carry it the same way.
- A trigger's `platform`: `.claude/rules/triggers.md`.
- The profile's top-level `platforms` (default `["tiktok"]`) and `channels` (the name typed for each platform that takes one): unknown platforms are dropped when read, so an older Tokio still loads a newer profile. So are the keys of the permissions' `platforms` records outside their enum (`knownPlatforms`, `src/common/schemas/profile.ts`, which the catalog's `platforms` and LIVE history's parts use too). `connector.username` stays TikTok's.
- `PLATFORM_TRIGGERS` (`src/common/util/platforms.ts`) is one row per platform, so a new platform touches only its own. Every trigger must be on a platform or be Music change (its test). The pickers, the feed kinds, the stat tiles and the timer rows all derive from it through `triggersFor`; don't list triggers by hand.
- `TIMER_TRIGGERS` (`src/common/util/timer.ts`) names the event each timer trigger counts, so a profile's platforms say which timer rows and carousel items apply.
- The feed, LIVE history and the overlays' payloads only add fields.

## Money

- Each platform's currency is named and counted on its own, never added to another or ranked against it (the user's call): TikTok's coins, Kick's Kicks, Twitch's Bits, YouTube's Super Chats in US dollars.
- **What names each currency:**
  - `PLATFORM_CURRENCY` (`src/common/util/platforms.ts`) names each platform's money, which Home, LIVE history and MCP count it in: `coins`, `kicks`, `bits` or `usd`.
  - `GIFT_CURRENCY` says what each platform's gifts cost in: `coins` for TikTok, `jewels` for YouTube, none for Twitch and Kick, which send no gifts. `giftCurrencies(platforms)` gives the ones a profile pays in.
  - Both are `Record`s, so a new platform has to decide.
- A gift without a currency counts as a gift, never as an amount, and makes its sender a gifter only beside money or gifted subs (the user's call: hide the zero, `.claude/rules/history.md`).

## What other platforms don't send

- Followers and fan levels: a Twitch, YouTube or Kick chatter's `follower` is false and `fanLevel` missing. Their chat badges say moderators (the broadcaster too), subscribers and founders (`superfan`), or YouTube's members, and Twitch's and Kick's `vip` badge sets `UserData.vip`. So their Permissions tabs and trigger rows offer only those (`.claude/rules/tts.md`, `.claude/rules/triggers.md`).
- Chat language, so only TikTok's chat is translated (`.claude/rules/translation.md`).
- Follows: every follow counts, a viewer's repeat follows in one LIVE included (the user's call). Twitch sends one each time a viewer follows again after unfollowing. YouTube sends none: new channel subscribers don't show in its chat. Kick has no Follow either (the user's call): no feed Kick's own page joins names a follower (checked in its scripts), its signed-in user feed only carries viewer notices, and named follows come only from Kick's official webhooks, which need a public server. Its follower total moves live (in the lookup, and in a follower goal's `GoalProgressUpdateEvent`), but the user chose not to turn it into follows without names.
- Chat pictures: Twitch chat goes without (`shortcut:` in `providers/twitch/index.ts`), `Avatar` shows the initial. Follows, subs, cheers and redeems look their picture up once and cache it. YouTube's chat carries every author's picture. Kick's chat has none (initials); a Kick's sender comes with theirs.
- A subscriber's or member's months come off their chat badge into `UserData.subMonths`, set only when it reads as a positive number (each provider's rule says which badge).

## The window

- `PlatformsContext` (`src/renderer/src/context/platforms`) gives the trigger pickers the active profile's platforms. A page provides it from `useEditableSettings`' `onLoad(profile)`, or from one page-level `GET_PROFILE` (the Studio editor, Countdown; Settings and Official overlays read them with `useProfilePlatforms`). Never ask `GET_PROFILE` per component: its reply drops the page's unsaved autosave.
- A profile's names are saved by `CONNECT`, and without connecting by `SET_CHANNELS` (the first-start dialog, MCP's `platforms` section), both through `saveNames` in `home.ts`: TikTok's @username through `toUsername`, the channels as typed. `SET_CHANNELS` leaves a platform that's on alone. Home takes its reply like a `GET_PROFILE`, never into a field being typed in.
- **The window shows a platform's settings only while the active profile uses it** (the user's call). Settings shows **TikTok LIVE** (its key) and **Chat translation** with TikTok, and Twitch's sign-in with Twitch; a hidden account stays signed in. The TTS page's **Read translations** and `{translation}` need TikTok too (`.claude/rules/translation.md`).
