---
paths:
  - "src/main/services/history/**"
  - "src/main/events/pages/lives.ts"
  - "src/renderer/src/pages/CoinStats/**"
---

# LIVE history

`HistoryService` (`src/main/services/history`) keeps each profile's LIVEs and the viewers who sent gifts in them, for Coin stats (`/tools/coin-stats`) and the top gifters overlays get as `tokio:gifters`. It holds the profile's data in memory as Persistence in `AGENTS.md` describes.

## Recording

- A LIVE runs from `CONNECTED` to `DISCONNECTED`, the span of Home's session (`.claude/rules/live-session.md`). Drops the connector recovers from stay in it; a connection lost for good starts a new LIVE on the next connect.
- `start(username)` gets the @username from `TikTokConnectorService.username`, set before the provider connects because `CONNECTED` comes before `connect()` resolves.
- `HISTORY_EVENTS` is only gifts (the user's call), through the service's own `GiftStreaks`: `added × max(0, coins)` coins, as Home counts them. A treasure chest carries no data and a Super Fan event only the viewer, so neither counts as coins.
- Gifters are keyed by `UserData.userId`; a gift without one counts in the totals only. Name, handle and picture follow the latest gift, and a gift without a picture keeps the last one.
- Each gift also goes in its clock minute (`GiftMinute`) under its gifter's id (`""` without one), so dates that cut a LIVE count only its gifts in them.
- Pictures are saved although TikTok's links expire within days (the user's call): overlays and the page fall back to the initial.
- Nothing is recorded before a load, or for a profile whose index doesn't load.

## The files

- `history/<profile name>/` (`folders.historyFolder`, the profile file's name without `.json`).
- `index.json`: the finished LIVEs' summaries, oldest first, and all time's gifters, the most coins first with ties to the earlier `giftedAt`. Written when a LIVE ends, after a recovery or a delete, and to retry a failed save.
- `<startedAt>.json`: one `LiveRecord` per LIVE, with all its gifters and its minutes, which stay out of the index.
  - The LIVE in progress rewrites only its own file on every save (every `HISTORY_SAVE_MS`, and a delete's, the cap's or a clear's), with `endedAt` set to the save's time, so a quiet LIVE's end keeps up too.
  - A finished LIVE's file is never rewritten, so a periodic save stays small however many LIVEs there are.
- When a LIVE ends, its file is written one last time, then the index with its summary appended and its gifters added to all time.
- `MAX_LIVES` (1,500): past it, the oldest LIVEs go as a delete would, gifts included, after an end (`_cap`, which reads their files after the end's save) and when a profile loads. The user's call: All time always adds up to the LIVEs kept.
- `MAX_GIFTERS` caps all time: the fewest coins go first, then the oldest last gift. The page shows only the top `SHOWN_GIFTERS` and each LIVE keeps all its own gifters, so nobody shown is dropped.
- On a quit or crash the next load adds what the last save missed from the LIVE's file.
- Saves run one after another through `_saving`, so an older index can't land after a newer one, as when a LIVE's end races the cap's drop.
- Reading a LIVE (`_readLive`) waits for `_saving` too: a save takes the LIVEs that ended out of `_ended` before their files are written, so a read in between (Coin stats asks again as a LIVE ends) got the older file. A save never waits on a read.

## Loading, recovery, deleting and clearing

- A missing index is an empty history. One that's there but doesn't load is left as it is, nothing is recorded, and the log has a warning.
- A LIVE file the index doesn't list, newer than every LIVE it does, was left by a quit or a crash: it's added, ending at its last save, and the index is saved at once. An unlisted older one is a delete's leftover and is removed, and so are `<name>.cleared-<digits>` folders, a clear's leftovers.
- `deleteLive` subtracts the LIVE's gifters, read from its file, from all time, dropping a gifter left with nothing, then saves the index. An unreadable file still leaves the index, and all time keeps its gifts (logged).
- A dropped LIVE's file (a delete's or the cap's) waits in `_dropped` until an index without it is written, by that save or the retry, and it's removed: one that can't be goes back for the next save, which doesn't count as failed (a held file mustn't refuse a switch). A load would take back a file newer than every listed LIVE as a crash's leftover, and an index on disk must never list a LIVE whose file is gone.
- `clear` renames the profile's folder away in one step (`renameWithRetry`), then removes it.
  - A LIVE in progress carries on. Its file and an empty index are written at once, the index over anything a save racing the move wrote.
  - It refuses, changing nothing, when no history is loaded or the rename fails.

## Overlays

- `{ type: "tokio:gifters", data: { live, allTime } }`, each the top `TOP_GIFTERS` as `TopGifter`, with both the `live` and the `allTime` numbers. `live` is `[]` outside a LIVE.
- `allTime` merges a cached top of the finished LIVEs (`_best`) with this LIVE's gifters, so a push never sorts all of all time.
- Each client gets it as it connects, then after each load, a LIVE's start and end, a delete or a clear, and gifts that count, through a `GIFTERS_PUSH_MS` `throttle` that reads the lists when it fires.
- Test sends a sample (see Previews in `.claude/rules/overlays.md`).
- The SDK (`@tokioapp/overlay`) types it as `TOKIO_EVENTS.GIFTERS`. Overlays on an older version log it as an unknown type.

## The page's data

- `GET_LIVES` replies `LIVES`: the finished LIVEs, newest first, and all time's top gifters. The LIVE in progress joins when it ends, when main pushes `LIVES` again; Home shows it until then. The page and Tools' list ask again on each `GET_PROFILE` reply (a profile switch), and the page drops its `GIFTERS` replies then, which the same range would still match.
- `GET_LIVE { startedAt }` replies `LIVE` with that LIVE's record, failures with the `startedAt` too. The page drops a reply for another `startedAt`.
- `GET_GIFTERS { from?, to?, query? }` replies `GIFTERS` with the top of the finished LIVEs from `from` (included) to `to` (left out), each with their `rank` among them (`RankedGifter`). The reply carries the range and the query, failures included.
  - A LIVE is in the dates when it starts in them or runs into them (`inRange`, `src/common/util/history.ts`). One they cut (not `allInRange`) counts only its gifts in them, from its minutes: a minute counts when any of it is in them.
  - A query matches name or @handle through `viewerMatcher` (`src/common/util/history.ts`), which the Fans page's search uses too.
  - Every LIVE whole reads all time's list. Other dates are added up by `getGifters` one file at a time, so a year of LIVEs isn't held at once, leaving out a file that doesn't load.
  - When another profile loads while `getTotals` or `getGifters` reads, they give null and the handler sends nothing more: the page asks again. With nothing loaded they give zeros and `[]`. A newer `GET_GIFTERS` of the same kind (dates, or a search) aborts the one before it (one `AbortController` per kind in `lives.ts`).
  - Dates without a query get their `totals` (`getTotals`, which reads only the files of the LIVEs they cut) in a first reply, then again with the gifters.
- `DELETE_LIVE` and `CLEAR_LIVES` reply `LIVES` with what main holds, then send `LIVE_DELETED` or `HISTORY_CLEARED`. A failed save after a delete throws `HISTORY_SAVE_FAILED`, a refused clear `HISTORY_CLEAR_FAILED`.

## The page

- Coin stats is a row in Tools' list, not a sidebar entry (the user's call). The layout the user picked: the selected LIVE on the left as Home showed it when it ended, the list on the right.
- Both lists scroll inside the dashboard, so picking a LIVE with more gifters doesn't move the list.
- The coin bar under each LIVE, in Iron and scaled to the best LIVE, is the page's one bold element. Hovered rows use Field (`--background-secondary`), since Iron would hide the bars.
- Selection: the newest LIVE, or All time when there are none. After a delete, the one that took its place, or the one before when it was the last (`keepSelection`). A LIVE that ends and joins keeps the selection; another profile's `LIVES` starts from its newest.
- The date presets count back from `now`, set with the filter and again when `LIVES` comes, so it doesn't move on every render; 12 months follow the calendar.
  - Custom dates use Tokio's own `DateTimePicker`, the same on every system and in the app's language.
  - `dateRange`: a day without a time is the whole day, which After and Before leave out; Between takes both ends in either order; On is always a whole day. Nothing is filtered until the days are picked.
  - Rows stay all of their LIVE. The first row becomes the dates' totals with main's top gifters (`GET_GIFTERS`, asked again when the LIVEs change), and a new filter selects it. Its coins and gifts are the LIVEs all in the dates (`allTime` in `helper.ts`) until main's `totals` add the cut LIVEs' gifts.
- The gifter search goes to main (`GET_GIFTERS`), so it finds anyone, not only the gifters listed. The selected LIVE goes as its own span (`startedAt` to `endedAt`), or the filter's range. The search stays while the selection and the dates change.
- Clear history shows only on All time, since it takes every LIVE.
- A Spanish long date is capitalized for the title (`capitalize`).
