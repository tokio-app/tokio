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
  - "src/renderer/src/components/TwitchSignIn/**"
  - "src/main/events/pages/home.ts"
---

# Platforms

Tokio connects to TikTok, Twitch, YouTube and Kick (`PLATFORMS`, `src/common/types/connector.ts`), several at once. TikTok's provider is in `.claude/rules/connector.md`. Twitch's Bits are `CHEER`, YouTube's Super Chats and Super Stickers `SUPER_CHAT`, YouTube's Gifts `GIFT` with 0 coins, and Kick's Kicks `KICKS` (`kicks` and the pinned `message`), like Bits: Kicks are never gifts (the user's call).

## What the user chose

- One LIVE session spans every platform the profile uses (the user's call): one feed, one LIVE history record, one timer, one Studio, alerts, TTS, music and games for all.
- The profile picks its platforms on Home, with the `+` after the tabs and each tab's remove (`SET_PLATFORMS`). A platform can be added while live and connected alone; one that's on stays until it's disconnected (main keeps it). Its `platforms` and `channels` are the profile's own, so each profile can use different ones.
- A trigger row is `[platform] [event]` (the user's call). The platform select shows only once the profile uses two or more platforms, or when the row already has one saved.
- Twitch connects through the streamer's sign-in: Twitch's official EventSub over WebSocket and Helix, the device code flow, a public client. The client ID isn't a secret and ships in `providers/twitch/config`. Nothing else of Twitch's is shipped, and no code is copied from any Twitch, YouTube or Kick library, only MIT, BSD and Apache references are read (Licensing in `AGENTS.md`).
- One Twitch account for every profile; a profile only picks whether to use it.
- YouTube connects with no key and no sign-in (the user's call): Tokio reads the LIVE's public chat the way youtube.com does, accepting YouTube's terms and that a change to its site can break it. The profile's `channels.youtube` is the handle or link typed on Home.
- Kick connects with no key and no sign-in, through our own provider rather than the `kicksdk-js` package (the user's call): Kick's website API and its chat feed, read the way kick.com's page does. The profile's `channels.kick` is the channel's name or kick.com link.

## The session across platforms

`ConnectorService` (`src/main/services/connector`) owns one `SessionEvents` emitter that consumers (`init.ts`, the services) listen to, and wires each provider to it once. TikTok's backends stay in `ProviderService`'s pool, so Settings' picker and the store never list Twitch; other platforms are added with `_addPlatform`. A pool backend forwards only while it's `_current`.

- First up, last down: the first platform's `CONNECTED` sends the session's `CONNECTED`, the last `DISCONNECTED` sends its `DISCONNECTED`. In between, `onPlatform(platform, "up" | "ended" | "lost" | "stopped")` and `onReconnect(state, platform)` tell the one platform. With TikTok alone nothing changes from before.
- `disconnect()` stops every platform at once and each stop arrives on `setImmediate`, so `_stopping` keeps them from being told one by one ("TikTok disconnected" in the middle of a Disconnect). It clears when the last one is down or at the next `connect()`.
- Notices (`init.ts`): with one platform, the keys and texts it always had. With several, they name the platform and are keyed per platform (`reconnect:<p>`, `connect:<p>`), so one platform's notice doesn't dedupe another's.
- `ROOM_USER` is merged from each platform's last: TikTok's `ranks`, the sum of `viewers` and `views`, sent again when a platform goes down. Overlays and Studio get only the sum; `viewers()` gives each platform's for Home's tabs (`.claude/rules/live-session.md`).
- `isConnected()` is any platform (the profile lock). `isReconnecting()` is every platform up reconnecting. `isWaiting()` is no platform up and TikTok looking for its LIVE. `status()` is each platform that's on, `connecting | connected | reconnecting | waiting`, and goes out as `CONNECTED.platforms`.
- `username` is the first platform up's channel, set before `CONNECTED` fires, so `history.start(conn.username)` and the profile's name for the session don't change. Twitch's channel is the signed-in account's.
- `connect(channels, onResult)` connects the platforms in parallel. One already up answers success at once, so a CONNECT while live joins only the platforms that are down. `CONNECT`'s `platforms` picks which, as a platform tab's Connect sends. `disconnect(platform)` stops one platform alone, outside `_stopping`, so its stop is told as that platform's ("Disconnected from Kick").
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
- The feed, LIVE history and the overlays' payloads only add fields.

## What other platforms don't send

- Followers and fan levels: a Twitch, YouTube or Kick chatter's `follower` is false and `fanLevel` missing. Their chat badges say moderators (the broadcaster too), subscribers and founders (`superfan`), or YouTube's members, and Twitch's and Kick's `vip` badge sets `UserData.vip`. So their Permissions tabs and alert rows offer only those (`.claude/rules/tts.md`, `.claude/rules/alerts.md`).
- Chat language: translation stays TikTok's (the user's call: letting Google detect Twitch's messages would spend its rate limit on the streamer's own language; `.claude/rules/translation.md`).
- Follows: every follow counts, a viewer's repeat follows in one LIVE included (the user's call). Twitch sends one each time a viewer follows again after unfollowing. YouTube sends none: new channel subscribers don't show in its chat. Kick has no Follow either (the user's call): no feed Kick's own page joins names a follower (checked in its scripts), its signed-in user feed only carries viewer notices, and named follows come only from Kick's official webhooks, which need a public server. Its follower total moves live (in the lookup, and in a follower goal's `GoalProgressUpdateEvent`), but the user chose not to turn it into follows without names.
- Chat pictures: Twitch chat goes without (`shortcut:` in `providers/twitch/index.ts`), `Avatar` shows the initial. Follows, subs, cheers and redeems look their picture up once and cache it. YouTube's chat carries every author's picture. Kick's chat has none (initials); a Kick's sender comes with theirs.
- Fans lists each platform's (2026-11-23): TikTok's fan club, Twitch's and Kick's subscribers and YouTube's members, with All by last seen. Overlays' `tokio:fans` stays TikTok's (`.claude/rules/fans.md`).
- A subscriber's or member's months come off their chat badge into `UserData.subMonths`, set only when it reads as a positive number:
  - Twitch: the `subscriber` or `founder` badge's `info`, which Twitch documents as the months (not yet seen on a real subscriber's chat).
  - Kick: the same badges' `count` (checked on kick.com's chat, 2026-11-23).
  - YouTube: the member badge's tooltip, in English since requests ask `hl=en`. "Member (1 year)" is 12, and "New member" sets none.

## Twitch

- The refresh token works once and rotates. Refreshes are single-flight (`TwitchAuth.refresh`) and a quit waits for one (`track`), and the new token is saved through `onAccount` before the access token is used: two refreshes at once, or a lost save, sign the user out. The store encrypts it (`.claude/rules/store.md`).
- Twitch wants the token validated at connect and hourly (`VALIDATE_MS`). A refused refresh or a revocation signs the account out and stops the connection with `lost`.
- EventSub: `session_reconnect` opens the new socket and keeps the subscriptions, and creating them again is a 409. A fresh socket (a drop, a keepalive timeout) subscribes again. Messages are deduped by `metadata.message_id`. A fresh socket gets `REQUEST_TIMEOUT_MS` for its welcome, or the try fails on the network; the keepalive watchdog only starts at the first message.
- Only the chat subscription failing fails a connect. A 403 for Bits or points on a channel that isn't affiliate, or a 429 on any other, is logged and skipped; the network still fails the try.
- `stream.offline` ends the connection only when it was seen live (at connect or since): a channel connected to while offline stays connected, so chat works before going live.
- Bits come only from `channel.bits.use`, which also carries Power-ups. Chat's `cheer` field would count them twice, so it's never read, and the cheermotes are taken out of `content` so TTS doesn't read "Cheer100".
- Messages from other channels in a Shared Chat (`source_broadcaster_user_id`) are dropped, with the `shared_chat_*` notices.
- A community gift counts once, from its `community_sub_gift` notice. Each `sub_gift` that carries a `community_gift_id` is dropped.
- A **Redeem** row's keyword is the reward's title, matched in any case, empty for any (`matchesTrigger`).
- Anonymous gifters and cheerers get a user with `platform` and no id.
- The sign-in code stays hidden until **Show** (`TwitchSignIn`, which Settings and the first-start dialog share): streamers show their screen, and a viewer who typed it would sign Tokio into their own account. Sign-in and sign-out are never in MCP (`.claude/rules/mcp.md`), since they need the streamer at a browser, and Sign out is refused while Twitch is connected.
- `CLIENT_ID` in `providers/twitch/config` is the Tokio app the user registered on dev.twitch.tv: a public client (no secret), its only redirect `http://localhost`, which the device flow never uses. It isn't a secret.

## YouTube

- Everything comes from YouTube's public pages, as youtube.com reads them: `/@handle/live` finds the LIVE (a 404 is `notFound`; a canonical link to `/channel/…`, or `isUpcoming`, is `offline`), the chat page gives the **Live chat** continuation (Top chat filters messages), `get_live_chat` is polled, and `updated_metadata` gives the viewers every 30 s. Bare input is a handle, since an 11-character handle looks like a video id; only links give a video id.
- Every request sends a desktop Chrome user agent, `hl=en&gl=US` and the `SOCS` cookie. The mapping reads English text ("Sent 20 … gift memberships", "sent Vice City heart", "Member for 6 months") and amounts as en-US shows them ("$4.99", "MX$100.00"), and the cookie answers the EU consent page, which would otherwise come instead of the LIVE.
- The first `get_live_chat` answer is the chat's recent history and is dropped whole: Gifts carry no timestamp, so a time filter would let old ones through.
- The end shows first in `updated_metadata`: within 30 s its viewership renderer loses `isLive` (it doesn't turn false) and counts the video's views ("72,481 views", "Streamed live …"), while the chat keeps answering for minutes. A missing `isLive` ends the connection with `ended`, and its count is never sent as viewers; a chat answer without a continuation ends it too.
- Gifts (`giftMessageViewModel`) carry no price and no channel id. They arrive as `GIFT` with `coins: 0` (`shortcut:` in `providers/youtube`) and a gift id from the picture's file name.
  - Everyone else's id is `youtube:<channel id>`. The provider remembers each handle's channel id from this LIVE's other events (the chat history at connect included), and sends a Gift under `youtube:<channel id>` when it knows it.
  - A handle it hasn't seen keeps `youtube:@handle`, with no lookup, since a Gift has no price and they come in bursts. That viewer then has two ids.
- Each platform's currency is named and counted on its own, never added to another or ranked against it (the user's call): TikTok's coins, Kick's Kicks, Twitch's Bits, YouTube's Super Chats in US dollars.
- **What names each currency:**
  - `PLATFORM_CURRENCY` (`src/common/util/platforms.ts`) names each platform's money, which Home, LIVE history and MCP count it in: `coins`, `kicks`, `bits` or `usd`.
  - `GIFT_CURRENCY` says what each platform's gifts cost in: `coins` for TikTok, none for the others (YouTube's Gifts have no price; Twitch and Kick send no gifts). `giftCurrencies(platforms)` gives the ones a profile pays in.
  - Both are `Record`s, so a new platform has to decide.
- A gift without a currency counts as a gift, never as an amount, and makes its sender a gifter only beside money or gifted subs (the user's call: hide the zero, `.claude/rules/history.md`).
- A gifted membership counts once, from its purchase announcement, with the count read from its text; each recipient's redemption is dropped.
- Super Chat amounts stay as YouTube shows them (`amount`), and `LiveService` adds them up in US dollars (`.claude/rules/live-session.md`). The timer adds the same seconds per Super Chat whatever it cost. `ConnectorService` gives each one its own `usd`, which history and alert minimums use.
- Placeholder items (`liveChatPlaceholderItemRenderer`) are messages held from readers and never filled in: ignored.

## Kick

- Everything goes through kick.com's own API and chat feed, as a guest: `GET kick.com/api/v2/channels/<slug>` gives the channel id, the chatroom id (a different number) and whether it's live; `web.kick.com/api/v1/realtime` gives the feed's server and a 45-minute guest token; the socket is Kick's Centrifugo server. Kick's notes come from kicksdk's `docs/KICK.md` (Apache-2.0, read as a reference, never copied).
- Every request and the socket send `User-Agent: Tokio/<version>`. Kick answers a non-browser that sends a browser's user agent with 403 "Request blocked by security policy", so never make Tokio pretend to be a browser. The socket also has to send `Origin: https://kick.com`, or its handshake gets a 403.
- The feeds are `chatrooms.<chatroom>.v2` (chat, subs, hosts), `chatroom_<chatroom>` (gifted subs, reward redemptions), `channel.<channel>` (live and offline) and `channel_<channel>` (Kicks). Never `chatrooms.<chatroom>`: it repeats every host. A publication's `data` is a JSON string inside the JSON.
- The token is refreshed at 80% of its life for the same client id. Closes coded 3500-3999 and 4500-4999 are terminal: wait 5 minutes, doubling up to 30, then come back as a new client id. Any other drop reconnects from 1 s, doubling up to 30 s, never giving up; a reconnect redoes the lookup, which is how it learns the stream ended while away.
- It connects while the channel is offline (the chat is the channel's), like Twitch, and `StopStreamBroadcast` ends the connection only for a stream seen live. Viewers come from the lookup every 60 s while live.
- A viewer's Kicks are one `KICKS`, the amount picked on Kick's slider in `kicks` and the message pinned with them in `message` (the user's call: Kicks are like Bits, not gifts). Kick's feed calls it `KicksGifted` with a gift for the amount's tier, which Tokio ignores. A row saved while Kicks were gifts (`GIFT` on Kick) loads as a Kicks row (`kicksRow`, `src/common/schemas/profile.ts`). Hosts and redemptions name the viewer only by username, so they have no `userId`. Chat has no pictures; a Kick's sender has one.
- Subs and gifted subs name their viewer only by username too, so the provider finds their id (`_withId`) (`kick:<id>`) in this LIVE's chat and Kicks, by username in any case, else with one lookup of their channel by `slugOf` (lowercase, `_` as `-`; the raw username is a 404). The lookup's `user_id` is chat's `sender.id` (checked 2026-11-22).
  - The answer is kept for the connection, failures included, each failure logged once per name. After a failed lookup the event goes out without an id.
  - A lookup holds that event back by its round trip, so it can come after events that arrived behind it.
- The feed is unofficial and changed from Pusher to Centrifugo in October 2026. An event Tokio can't read is dropped and logged once per name, never thrown out of the socket's listener.

## The window

- `PlatformsContext` (`src/renderer/src/context/platforms`) gives the trigger pickers the active profile's platforms. A page provides it from `useEditableSettings`' `onLoad(profile)`, or from one page-level `GET_PROFILE` (the Studio editor, Countdown; Settings and Official overlays read the platforms the same way). Never ask `GET_PROFILE` per component: its reply drops the page's unsaved autosave.
- A profile's names are saved by `CONNECT`, and without connecting by `SET_CHANNELS` (the first-start dialog, MCP's `platforms` section), both through `saveNames` in `home.ts`: TikTok's @username through `toUsername`, the channels as typed. `SET_CHANNELS` leaves a platform that's on alone. Home takes its reply like a `GET_PROFILE`, never into a field being typed in.
- **The window shows a platform's settings only while the active profile uses it** (the user's call). Settings shows **TikTok LIVE** (its key) and **Chat translation** (only TikTok's chat is translated) with TikTok, and Twitch's sign-in with Twitch; a hidden account stays signed in. The TTS page's **Read translations** and `{translation}` need TikTok too (`.claude/rules/translation.md`).
- Home's top is a tab per platform, one platform included (the user's calls), in Home's order (`DashboardSection`). A platform's tab holds its connection: a normal field (Twitch's account or its sign-in) with its state under it and its own Connect or Disconnect; alone, its Connect is Home's, rose until it's on. Removing a platform is closing its tab, with a muted × like a browser tab's (`Tabs`' `onClose`), never on one that's on or the only one (the user found a × beside Connect clunky). A `+` after the tabs lists the platforms the profile doesn't use and opens the one added. With two or more, Connect all or Disconnect all sits beside the status above the tabs, at full height, not squeezed into the tab row (the user's call). The tab's logo is rose while it's connected. A `SET_PLATFORMS` reply resyncs the tabs to what main holds.
- Connect never does nothing: a platform missing its channel, or Twitch without its sign-in, says so in its tab (`needs`), whose name turns red, the ready ones connect, and Home opens the first one that needs something with its field focused. The message goes once it's given.
- Studio overlays are shared by profiles, but their pickers follow the active profile's platforms: the triggers, the top gifters' platform, the live numbers texts and goals are offered (`studioNumbersFor`, as Home's tiles: `{kicks}` with Kick, `{bits}` with Twitch), the Gift element (only with TikTok or YouTube, whose gifts have pictures), a gift element's picked gift (TikTok's catalog), an emote element's emotes (by `idPlatform`), and the list sources New followers (`FOLLOW`) and Latest gifts (`GIFT`). A row, platform or goal number saved that the profile no longer uses keeps showing, and a text keeps any number it has.
- A new alert, game action or Studio element starts on Follow where the profile's platforms send follows, else a subscription (`newRowTrigger`), a new Studio counter on gifts where they come, and a new list ranks the profile's first platform's gifters. MCP's new alerts and actions do the same.
- Changing a row's platform to one without its event moves it to that platform's first event (`withPlatform`; Studio's rows through `retype`).
