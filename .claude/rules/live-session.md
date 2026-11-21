---
paths:
  - "src/main/services/live/**"
  - "src/common/types/live.ts"
  - "src/renderer/src/pages/Home/**"
---

# Live session

- `LiveService` keeps the connected LIVE in memory for Home (`LiveSession`): when it started, its totals, and its last `ACTIVITY_LIMIT` events. `registerConnectorEvents` starts it on `CONNECTED` and ends it on `DISCONNECTED`.
- Every `CONNECTED` reply and push comes from `connectionState` (`src/main/helper/events.ts`), with `platforms`, how each platform that's on is doing (`ConnectorService.status()`, `.claude/rules/platforms.md`). Its `live` is true once the session has started (`startedAt !== null`), so a reconnect stays live and a connect in progress isn't. Home and the title bar's tally show LIVE from it, and Home keeps its spinner while `success` is true without `live` or `waiting`. `success` (connecting, connected, reconnecting or looking for the LIVE) is the profile lock.
  - `reconnecting`: the connection dropped and is coming back, and the session goes on. Home's status line says Reconnecting… in place of the timer (the user's call).
  - `waiting`: the connector looks for a LIVE that stopped on its own (`.claude/rules/connector.md`), with no session. Home says Waiting for the LIVE…, and its Disconnect ends the look.
- With several platforms the session is the first one up's to the last one down. Home shows a row per platform with its state, and **Try again** (a `CONNECT`, which joins only the platforms that are down) on one that failed or stopped while the rest are live. The title bar's tally and the profile lock follow the session.
- Layout asks `IS_CONNECTED` itself, next to `GET_SETTINGS`, since main pushes `CONNECTED` on its own only as the connection changes (a stop, a drop, a reconnect, the look for the LIVE ending). A window reloaded mid-LIVE (`reloadWhenGone`) then knows on any page, for the tally, the profile lock and Update's confirm.
- The gift and coin totals count gifts as they come, through `GiftStreaks` (see `.claude/rules/alerts.md`), reset when a LIVE starts. The feed lists a combo once, on `repeatEnd`, like gift alerts, with the streak's total.
- A chat item carries the translation its event came with: Chat translation translates before any listener gets the chat (`.claude/rules/translation.md`), so items still never change once recorded, as `ActivitySection`'s memo expects.
- Joins in a row share one item, each handle once (`_joined`), up to `JOIN_LIMIT` viewers, then a new item starts. Likes and room updates stay out of the feed; the stats show them.
- The likes stat is the highest `totalLikes` seen (`registerConnectorEvents`), since TikTok sometimes lowers its total for 30–50 s. It goes back to 0 with the other stats on `DISCONNECTED`.
- `viewers` holds each minute's highest viewer count from `ROOM_USER` since `startedAt`, index = whole minutes since it (`recordViewers`). A minute without a reading repeats the last count, a clock set back stays in the minute it reached, and it stops at `VIEWER_MINUTES` (24 h).
  - Minute 0's counts push nothing. The first count of each later minute pushes the session once, through its throttle, and `DISCONNECTED` cancels a push still waiting.
  - Home draws every minute but the last, then the live `VIEWS` count, so the chart's end moves with the readout.
- The feed and the viewers stay after the LIVE ends, until the next one starts.
- Home shows the chart, the numbers and the top gifters only while LIVE (the user's call), each only with a platform that has it (`liveStats`, `sendsGifts` in `pages/Home/helper.ts`). Offline it's the connect box and the feature switches, beside the feed.
- Home also asks `GET_LIVE_GIFTERS` (this LIVE's top gifters, `[]` outside one) and `GET_SONGS` (the queue as overlays get it), and `init.ts` pushes `LIVE_GIFTERS` with the overlays' `tokio:gifters` (see `.claude/rules/history.md`) and `SONGS` on every `MUSIC_CHANGE`, unthrottled. Now playing is the queue's playing song, while Music is connected.
- The stat tiles follow the profile's platforms (`liveStats`): likes, total views and shares only with TikTok (Twitch has no total views and sends 0), gifts and coins only with a platform that sends gifts. Feed rows show the platform's icon once the profile uses two or more, and the feed's kinds are the ones its platforms send (`feedKinds`). Twitch adds the kinds `sub`, `giftsub`, `cheer`, `raid` and `redeem`.
- `settings.activityFeed` picks the kinds of events the feed keeps, for every profile, saved from Home's `FeedModal` with `SET_ACTIVITY_FEED`. `LiveService.setFeed` applies it when the app loads and on save, dropping the items it now hides.
- Hidden events aren't kept but still count toward the totals.
- Past LIVEs are kept by `HistoryService`, which counts the same span on its own: see `.claude/rules/history.md`.
