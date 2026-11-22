---
paths:
  - "src/main/services/history/**"
  - "src/main/events/pages/lives.ts"
  - "src/renderer/src/pages/CoinStats/**"
---

# LIVE history

`HistoryService` (`src/main/services/history`) keeps each profile's LIVEs and the viewers who sent gifts in them, for Gift stats (`/tools/coin-stats`, the route of its old name, Coin stats) and the top gifters overlays get as `tokio:gifters`. It holds the profile's data in memory as Persistence in `AGENTS.md` describes.

## Recording

- A LIVE runs from `CONNECTED` to `DISCONNECTED`, the span of Home's session (`.claude/rules/live-session.md`). Drops the connector recovers from stay in it; a connection lost for good starts a new LIVE on the next connect.
- `start(username)` gets the @username from `ConnectorService.username`, set before the provider connects because `CONNECTED` comes before `connect()` resolves.
- `HISTORY_EVENTS` is only gifts (the user's call), through the service's own `GiftStreaks`: `added × max(0, coins)` in the sender's currency (`GIFT_CURRENCY`), as Home counts them: TikTok's go in a LIVE's `coins`, Kick's in its `kicks` (0 for older files), never added together. A treasure chest carries no data and a Super Fan event only the viewer, so neither counts as coins.
- Gifters are keyed by `UserData.userId`; a gift without one, or without a price (YouTube's Gifts), counts in the totals only, so no one shows as a gifter with nothing. Name, handle and picture follow the latest gift, and a gift without a picture keeps the last one.
- A gifter keeps their `platform` (missing is TikTok). Ids are namespaced by platform (`.claude/rules/platforms.md`), so gifters of two platforms never merge. A gifter's `coins` is in their platform's currency: TikTok's coins or Kick's Kicks.
- Each gift also goes in its clock minute (`GiftMinute`) under its gifter's id (`""` without one or without a price, `"kick:"` for such a Kick gift), so dates that cut a LIVE count only its gifts in them. A key's currency comes from its platform prefix (namespaced ids, `.claude/rules/platforms.md`), so the minutes keep coins and Kicks apart with no new field.
- Pictures are saved although TikTok's links expire within days (the user's call): overlays and the page fall back to the initial.
- Nothing is recorded before a load, or for a profile whose index doesn't load.

## The files

- `history/<profile name>/` (`folders.historyFolder`, the profile file's name without `.json`).
- `index.json`: the finished LIVEs' summaries, oldest first, all time's gifters, the most coins first with ties to the earlier `giftedAt`, and `newest`, the newest `startedAt` it ever listed (deleted LIVEs included, reset by a clear). Written when a LIVE ends, after a recovery or a delete, and to retry a failed save.
- `<startedAt>.json`: one `LiveRecord` per LIVE, with all its gifters and its minutes, which stay out of the index.
  - The LIVE in progress rewrites only its own file on every save (every `HISTORY_SAVE_MS`, and a delete's, the cap's or a clear's), with `endedAt` set to the save's time, so a quiet LIVE's end keeps up too.
  - A finished LIVE's file is never rewritten, so a periodic save stays small however many LIVEs there are.
- When a LIVE ends, its file is written one last time, then the index with its summary appended and its gifters added to all time. When an ended LIVE's file fails, the index waits for the next save, which writes both.
- `MAX_LIVES` (1,500): past it, the oldest LIVEs go as a delete would, gifts included, after an end (`_cap`, which reads their files after the end's save) and when a profile loads. The user's call: All time always adds up to the LIVEs kept.
- `MAX_GIFTERS` caps each currency's gifters of all time on its own: the fewest go first, then the oldest last gift. The page shows only the top `SHOWN_GIFTERS` and each LIVE keeps all its own gifters, so nobody shown is dropped.
- On a quit or crash the next load adds what the last save missed from the LIVE's file.
- Saves run one after another through `_saving`, so an older index can't land after a newer one, as when a LIVE's end races the cap's drop.
- Reading a LIVE (`_readLive`) waits for `_saving` too: a save takes the LIVEs that ended out of `_ended` before their files are written, so a read in between (Gift stats asks again as a LIVE ends) got the older file. A save never waits on a read.

## Loading, recovery, deleting and clearing

- A missing index is an empty history. One that's there but doesn't load (held at startup too) is left as it is and nothing is recorded until another load. `load` then gives false, and startup and a profile switch warn (`HISTORY_LOAD_FAILED`).
- A LIVE file the index doesn't list, newer than its `newest` and every LIVE it lists, was left by a quit or a crash: it's added, ending at its last save, and the index is saved at once. An unlisted older one is a delete's leftover and is removed, and so are `<name>.cleared-<digits>` folders, a clear's leftovers.
- `deleteLive` subtracts the LIVE's gifters, read from its file, from all time, dropping a gifter left with nothing, then saves the index.
  - A gifter all time holds with fewer coins or gifts than the LIVE gave them is left as is: the cap dropped them and later gifts brought them back without it. One whose later gifts reach the LIVE's still loses them, an undercount kept on purpose (a `shortcut:` in `_drop`). An unreadable file still leaves the index, and all time keeps its gifts (logged).
- A dropped LIVE's file (a delete's or the cap's) waits in `_dropped` until an index without it is written, by that save or the retry, and it's removed: one that can't be goes back for the next save, which doesn't count as failed (a held file mustn't refuse a switch). An index on disk must never list a LIVE whose file is gone. A quit before the file goes leaves it, which the index's `newest` makes a delete's leftover on the next load, not a crash's.
- `clear` renames the profile's folder away in one step (`renameWithRetry`), then removes it.
  - A LIVE in progress carries on. Its file and an empty index are written at once, the index over anything a save racing the move wrote.
  - It refuses, changing nothing, when no history is loaded or the rename fails.

## Overlays

- `{ type: "tokio:gifters", data: { live, allTime } }`, each the top `TOP_GIFTERS` as `TopGifter`, with both the `live` and the `allTime` numbers. `live` is `[]` outside a LIVE.
- `allTime` merges a cached top of the finished LIVEs (`_best`) with this LIVE's gifters, so a push never sorts all of all time.
- Each client gets it as it connects, then after each load, a LIVE's start and end, a delete or a clear, and gifts that count, through a `GIFTERS_PUSH_MS` `throttle` that reads the lists when it fires.
- `tokio:gifters` stays as overlays read it: `top()` ranks TikTok's coins and Kick's Kicks together, and overlays tell them apart by `platform`. Home's top gifters (`LIVE_GIFTERS`) go out in the same throttled push as `byPlatform`, each platform's own top (`topByPlatform`), which overlays don't get. Studio's gifters lists use it too, by their `platform`. `end()` empties them, so the push after a LIVE ends carries none.
- Test sends a sample (see Previews in `.claude/rules/overlays.md`).
- The SDK (`@tokioapp/overlay`) types it as `TOKIO_EVENTS.GIFTERS`. Overlays on an older version log it as an unknown type.

## The page's data

- `GET_LIVES` replies `LIVES`: the finished LIVEs, newest first, and each currency's top gifters of all time, in one list. The LIVE in progress joins when it ends, when main pushes `LIVES` again; Home shows it until then. The page and Tools' list ask again on each `GET_PROFILE` reply (a profile switch), and the page drops its `GIFTERS` replies then, which the same range would still match.
- `GET_LIVE { startedAt }` replies `LIVE` with that LIVE's record, failures with the `startedAt` too. The page drops a reply for another `startedAt`.
- `GET_GIFTERS { from?, to?, query? }` replies `GIFTERS` with the top of the finished LIVEs from `from` (included) to `to` (left out), each with their `rank` among their own currency's gifters (`RankedGifter`), up to `SHOWN_GIFTERS` of each; the page filters by its currency. The reply carries the range and the query, failures included.
  - A LIVE is in the dates when it starts in them or runs into them (`inRange`, `src/common/util/history.ts`). One they cut (not `allInRange`) counts only its gifts in them, from its minutes: a minute counts when any of it is in them.
  - A query matches name or @handle through `viewerMatcher` (`src/common/util/history.ts`), which the Fans page's search uses too.
  - Every LIVE whole reads all time's list. Other dates are added up by `getGifters` one file at a time, so a year of LIVEs isn't held at once, leaving out a file that doesn't load.
  - When another profile loads while `getTotals` or `getGifters` reads, they give null and the handler sends nothing more: the page asks again. With nothing loaded they give zeros and `[]`. A newer `GET_GIFTERS` of the same kind (dates, or a search) aborts the one before it (one `AbortController` per kind in `lives.ts`).
  - Dates without a query get their `totals` (`getTotals`, which reads only the files of the LIVEs they cut) in a first reply, then again with the gifters.
- `DELETE_LIVE` and `CLEAR_LIVES` reply `LIVES` with what main holds, then send `LIVE_DELETED` or `HISTORY_CLEARED`. A failed save after a delete throws `HISTORY_SAVE_FAILED`, a refused clear `HISTORY_CLEAR_FAILED`.

## The page

- Gift stats (once Coin stats) is a row in Tools' list, not a sidebar entry (the user's call). The layout the user picked: the selected LIVE on the left as Home showed it when it ended, the list on the right.
- Both lists scroll inside the dashboard, so picking a LIVE with more gifters doesn't move the list.
- A switch (house `Tabs`, `pill`) picks the currency the page counts in, Coins or Kicks, only when the history has both: the LIVE list's amounts and bars, the summary's money tile (Gifts still counts every gift) and the gifters, filtered to that currency's. The Tools row shows the newest LIVE's coins, or its Kicks when it has no coins.
- The bar under each LIVE, in Iron and scaled to the best LIVE in the shown currency, is the page's one bold element. Hovered rows use Field (`--background-secondary`), since Iron would hide the bars.
- Selection: the newest LIVE, or All time when there are none. After a delete, the one that took its place, or the one before when it was the last (`keepSelection`). A LIVE that ends and joins keeps the selection; another profile's `LIVES` starts from its newest.
- The date presets count back from `now`, set with the filter and again when `LIVES` comes, so it doesn't move on every render; 12 months follow the calendar.
  - Custom dates use Tokio's own `DateTimePicker`, the same on every system and in the app's language.
  - `dateRange`: a day without a time is the whole day, which After and Before leave out; Between takes both ends in either order; On is always a whole day. Nothing is filtered until the days are picked.
  - Rows stay all of their LIVE. The first row becomes the dates' totals with main's top gifters (`GET_GIFTERS`, asked again when the LIVEs change), and a new filter selects it. Its amounts and gifts are the LIVEs all in the dates (`allTime` in `helper.ts`) until main's `totals` add the cut LIVEs' gifts.
- The gifter search goes to main (`GET_GIFTERS`), so it finds anyone, not only the gifters listed. The selected LIVE goes as its own span (`startedAt` to `endedAt`), or the filter's range. The search stays while the selection and the dates change.
- Clear history shows only on All time, since it takes every LIVE.
- A Spanish long date is capitalized for the title (`capitalize`).
