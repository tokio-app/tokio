---
paths:
  - "src/main/services/live/**"
  - "src/common/types/live.ts"
  - "src/renderer/src/pages/Home/**"
---

# Live session

- `LiveService` (`src/main/services/live`) keeps the connected LIVE in memory for the Home page (`LiveSession`, `src/common/types/live.ts`): when it started, the new followers, shares, gifts and coins since then, and its last 100 events.
- `registerConnectorEvents` records the `ACTIVITY_EVENTS`, starts the session on `CONNECTED` (which comes only for a connect that worked) and ends it on `DISCONNECTED`, and pushes `LIVE_SESSION` with the stats' 250ms throttle. Home asks for it with `GET_LIVE_SESSION`. The `CONNECTED` reply carries `live`, true once the session has started (`IS_CONNECTED` reads `startedAt !== null`, so a reconnect stays live and a connect in progress isn't): Home and the title bar's tally show LIVE from it, and Home keeps its spinner while `success` is true without `live`. `success` (connecting or connected) is the profile lock.
- The gift and coin totals count gifts as they come, through `GiftStreaks` (`src/main/helper/streaks.ts`, shared with alerts, reset when a LIVE starts). The feed lists a combo once, on `repeatEnd`, like gift alerts, with the streak's total. Joins in a row share one item, which names the first two viewers and counts the rest, each handle once (`_joined`), up to `JOIN_LIMIT` (1000) viewers, then a new item starts. Likes and room updates stay out of the feed; the stats show them.
- The feed stays after the LIVE ends, until the next one starts. Viewers, likes, views and the totals show only while connected.
- `settings.activityFeed` picks the kinds of events the feed keeps, for every profile. The gear on Home's Activity opens `FeedModal`, which saves it with `SET_ACTIVITY_FEED`. `LiveService.setFeed` applies it when the app loads and on save, dropping the items it now hides.
- Hidden events aren't kept but still count toward the totals, so the 100 items are all ones the feed shows.
