---
paths:
  - "src/main/services/history/**"
  - "src/main/events/pages/lives.ts"
  - "src/renderer/src/pages/CoinStats/**"
---

# LIVE history

`HistoryService` (`src/main/services/history`) keeps each profile's LIVEs and the viewers who spent or gifted subs in them, for Gift stats (`/tools/coin-stats`, the route of its old name, Coin stats) and the top gifters overlays get as `tokio:gifters`. It holds the profile's data in memory as Persistence in `AGENTS.md` describes.

## Recording

- A LIVE runs from `CONNECTED` to `DISCONNECTED`, the span of Home's session (`.claude/rules/live-session.md`). Drops the connector recovers from stay in it; a connection lost for good starts a new LIVE on the next connect.
- `start(username)` gets the @username from `ConnectorService.username`, set before the provider connects because `CONNECTED` comes before `connect()` resolves.
- `HISTORY_EVENTS` counts what viewers spend, each platform's in its own currency, and gifted subs (the user's calls):
  - Gifts go through the service's own `GiftStreaks`: `added × max(0, coins)` in the sender's gift currency (`GIFT_CURRENCY`), as Home counts them. That's TikTok's coins and Kick's Kicks; YouTube's Gifts have no price. A treasure chest carries no data and a Super Fan event only the viewer, so neither counts.
  - Twitch's cheers count their Bits, YouTube's Super Chats their `usd`, and gifted subs their `count`.
- A LIVE keeps each platform's part in `platforms` (`{ amount, gifts, giftSubs }`, the amount in `PLATFORM_CURRENCY`), never added together. `coins` stays TikTok's coins and `gifts` every platform's, so an older Tokio still reads a newer file. A LIVE saved without `platforms` was TikTok's alone: every reader goes through `platformParts` (`src/common/util/history.ts`).
- Every platform the LIVE was on gets a part, zeros included, so Gift stats lists the LIVE under it even without gifts: `init.ts` calls `join` for each platform connected at `CONNECTED` and for each one that comes up later.
- **Super Chats before the rates:**
  - A Super Chat whose `usd` is null because the rates hadn't loaded waits for them (`setRates`, `onChange`), then counts in the minute it came in.
  - One still waiting when the LIVE ends is left out of its dollars, logged.
  - An amount that can't be read is left out at once, logged once per text.
  - A currency the rates lack counts 0 once they load (`RatesService` warns once).
- **Gifters:**
  - One record per viewer per platform (`UserData.userId`, namespaced by platform, `.claude/rules/platforms.md`) holds everything they sent there: its amount, gifts and gifted subs. A gifter's `coins` is that amount, in their platform's currency, and a gifter keeps their `platform` (missing is TikTok).
  - A viewer gets a record with an amount or gifted subs. A gift without a price (YouTube's Gifts) adds to a record they already have, else counts in the LIVE only, so no one shows as a gifter with nothing (the user's call: hide the zero). What comes without an id counts in the LIVE only.
  - Name, handle and picture follow the latest event, and one without a picture keeps the last one.
- **Minutes:**
  - Everything also goes in its clock minute (`GiftMinute`), so dates that cut a LIVE count only what came in them.
  - Each key holds `[amount, gifts, giftSubs]`; older files have two numbers, read as no gifted subs.
  - The key is the viewer's id, or without one their platform's (`""` for TikTok, then `"kick:"`, `"twitch:"` and `"youtube:"`). A key's platform comes from its prefix (`keyPlatform`), so the minutes keep the currencies apart with no new field.
  - A Super Chat that waited for the rates goes back to its own minute, which is copied first: a save in flight may still hold it.
- Pictures are saved although TikTok's links expire within days (the user's call): overlays and the page fall back to the initial.
- Nothing is recorded before a load, or for a profile whose index doesn't load.

## The files

- `history/<profile name>/` (`folders.historyFolder`, the profile file's name without `.json`).
- `index.json`: the finished LIVEs' summaries, oldest first, all time's gifters in `byAmount` order, and `newest`, the newest `startedAt` it ever listed (deleted LIVEs included, reset by a clear). Written when a LIVE ends, after a recovery or a delete, and to retry a failed save.
- `<startedAt>.json`: one `LiveRecord` per LIVE, with all its gifters and its minutes, which stay out of the index.
  - The LIVE in progress rewrites only its own file on every save (every `HISTORY_SAVE_MS`, and a delete's, the cap's or a clear's), with `endedAt` set to the save's time, so a quiet LIVE's end keeps up too.
  - A finished LIVE's file is never rewritten, so a periodic save stays small however many LIVEs there are.
- When a LIVE ends, its file is written one last time, then the index with its summary appended and its gifters added to all time. When an ended LIVE's file fails, the index waits for the next save, which writes both.
- `MAX_LIVES` (1,500): past it, the oldest LIVEs go as a delete would, gifts included, after an end (`_cap`, which reads their files after the end's save) and when a profile loads. The user's call: All time always adds up to the LIVEs kept.
- `byAmount` puts the most in a platform's currency first, then the most gifted subs, with ties going to the earlier `giftedAt`. Amounts of two currencies compare as plain numbers, so a list that mixes platforms is in each platform's own order, which is all its readers use: they filter by platform.
- `MAX_GIFTERS` caps each platform's gifters of all time on its own: the fewest go first, then the fewest gifted subs, then the oldest last gift. The page shows only the top `SHOWN_GIFTERS` and each LIVE keeps all its own gifters, so nobody shown is dropped.
- On a quit or crash the next load adds what the last save missed from the LIVE's file.
- Saves run one after another through `_saving`, so an older index can't land after a newer one, as when a LIVE's end races the cap's drop.
- Reading a LIVE (`_readLive`) waits for `_saving` too: a save takes the LIVEs that ended out of `_ended` before their files are written, so a read in between (Gift stats asks again as a LIVE ends) got the older file. A save never waits on a read.

## Loading, recovery, deleting and clearing

- A missing index is an empty history. One that's there but doesn't load (held at startup too) is left as it is and nothing is recorded until another load. `load` then gives false, and startup and a profile switch warn (`HISTORY_LOAD_FAILED`).
- A LIVE file the index doesn't list, newer than its `newest` and every LIVE it lists, was left by a quit or a crash: it's added, ending at its last save, and the index is saved at once. An unlisted older one is a delete's leftover and is removed, and so are `<name>.cleared-<digits>` folders, a clear's leftovers.
- `deleteLive` subtracts the LIVE's gifters, read from its file, from all time, dropping a gifter left with nothing, then saves the index.
  - A gifter all time holds with fewer coins, gifts or gifted subs than the LIVE gave them is left as is: the cap dropped them and later gifts brought them back without it. One whose later gifts reach the LIVE's still loses them, an undercount kept on purpose (a `shortcut:` in `_drop`). An unreadable file still leaves the index, and all time keeps its gifts (logged).
- A dropped LIVE's file (a delete's or the cap's) waits in `_dropped` until an index without it is written, by that save or the retry, and it's removed: one that can't be goes back for the next save, which doesn't count as failed (a held file mustn't refuse a switch). An index on disk must never list a LIVE whose file is gone. A quit before the file goes leaves it, which the index's `newest` makes a delete's leftover on the next load, not a crash's.
- `clear` renames the profile's folder away in one step (`renameWithRetry`), then removes it.
  - A LIVE in progress carries on. Its file and an empty index are written at once, the index over anything a save racing the move wrote.
  - It refuses, changing nothing, when no history is loaded or the rename fails.

## Overlays

- `{ type: "tokio:gifters", data: { live, allTime } }`, each the top `TOP_GIFTERS` as `TopGifter`, with both the `live` and the `allTime` numbers. `live` is `[]` outside a LIVE.
- `allTime` merges a cached top of the finished LIVEs (`_best`) with this LIVE's gifters, so a push never sorts all of all time.
- Each client gets it as it connects, then after each load, a LIVE's start and end, a delete or a clear, and gifts that count, through a `GIFTERS_PUSH_MS` `throttle` that reads the lists when it fires.
- `tokio:gifters` stays as overlays read it:
  - `top()` takes TikTok's and Kick's gifters with coins (`overlaid`) and ranks them together by coins, as before other platforms counted. Overlays tell them apart by `platform`.
  - Twitch's and YouTube's supporters, and Kick's who only gifted subs, stay out of it.
- Home's top gifters (`LIVE_GIFTERS`) go out in the same throttled push as `byPlatform`: each platform's own top (`topByPlatform`) in `byAmount` order, as `Gifter` records with this LIVE's numbers, gifted subs included. Overlays don't get it; Studio's gifters lists and MCP's `get_activity` use it too. `end()` empties them, so the push after a LIVE ends carries none.
- Test sends a sample (see Previews in `.claude/rules/overlays.md`).
- The SDK (`@tokioapp/overlay`) types it as `TOKIO_EVENTS.GIFTERS`. Overlays on an older version log it as an unknown type.

## The page's data

- `GET_LIVES` replies `LIVES`: the finished LIVEs, newest first, and each platform's top gifters of all time, in one list. The LIVE in progress joins when it ends, when main pushes `LIVES` again; Home shows it until then. The page and Tools' list ask again on each `GET_PROFILE` reply (a profile switch), and the page drops its `GIFTERS` replies then, which the same range would still match.
- `GET_LIVE { startedAt }` replies `LIVE` with that LIVE's record, failures with the `startedAt` too. The page drops a reply for another `startedAt`.
- `GET_GIFTERS { from?, to?, query? }` replies `GIFTERS` with the top of the finished LIVEs from `from` (included) to `to` (left out), each with their `rank` among their own platform's gifters (`RankedGifter`), up to `SHOWN_GIFTERS` of each; the page filters by its tab's platform. The reply carries the range and the query, failures included.
  - A LIVE is in the dates when it starts in them or runs into them (`inRange`, `src/common/util/history.ts`). One they cut (not `allInRange`) counts only its gifts in them, from its minutes: a minute counts when any of it is in them.
  - A query matches name or @handle through `viewerMatcher` (`src/common/util/history.ts`), which the Fans page's search uses too.
  - Every LIVE whole reads all time's list. Other dates are added up by `getGifters` one file at a time, so a year of LIVEs isn't held at once, leaving out a file that doesn't load.
  - When another profile loads while `getTotals` or `getGifters` reads, they give null and the handler sends nothing more: the page asks again. With nothing loaded they give zeros and `[]`. A newer `GET_GIFTERS` of the same kind (dates, or a search) aborts the one before it (one `AbortController` per kind in `lives.ts`).
  - Dates without a query get their `totals` (`getTotals`, which reads only the files of the LIVEs they cut) in a first reply, then again with the gifters. They hold TikTok's coins, every gift and each platform's part, with zeros for a platform that a LIVE in them was on.
- `DELETE_LIVE` and `CLEAR_LIVES` reply `LIVES` with what main holds, then send `LIVE_DELETED` or `HISTORY_CLEARED`. A failed save after a delete throws `HISTORY_SAVE_FAILED`, a refused clear `HISTORY_CLEAR_FAILED`.

## The page

- Gift stats (once Coin stats) is a row in Tools' list, not a sidebar entry (the user's call). The layout the user picked: the selected LIVE on the left as Home showed it when it ended, the list on the right.
- Both lists scroll inside the dashboard, so picking a LIVE with more gifters doesn't move the list.
- **Tabs:** there's a tab per platform in the history (`historyPlatforms`, in `PLATFORMS` order, TikTok alone without LIVEs), then All with two or more (`statsTabs`), styled like Home's (the user's call: each platform in its own currency, never added up). With one platform there's no tab row.
- **A platform's tab** (`readout`):
  - Its money tile, then Gifts where it sends gifts (TikTok, YouTube, Kick) and Gifted subs where it sends them (Twitch, YouTube, Kick).
  - The list holds only the LIVEs that were on it, their amounts and bars in its money (`liveValue`), and the summary's count and length are theirs.
  - Its gifters are main's lists filtered by `platformOf`, in main's order and with its ranks, each with their amount and gifted subs.
- **All:** a money tile per platform, every gift and gifted sub, and the list by gift count, whose totals row says so ("1.5K gifts", the user's call) so it isn't read as money. It has no ranking and no search: a line asks to pick a platform. A selected LIVE shows only its own platforms' tiles there.
- A selected LIVE that isn't on the picked tab shows the totals row, and stays selected for when its tab comes back.
- The Tools row shows the newest LIVE's first platform with money, in `PLATFORMS` order (else its first platform), in its currency.
- The bar under each LIVE, in Iron and scaled to the best LIVE in the tab's money (gifts on All), is the page's one bold element. Hovered rows use Field (`--background-secondary`), since Iron would hide the bars.
- Selection: the newest LIVE, or All time when there are none. After a delete, the one that took its place, or the one before when it was the last (`keepSelection`). A LIVE that ends and joins keeps the selection; another profile's `LIVES` starts from its newest.
- The date presets count back from `now`, set with the filter and again when `LIVES` comes, so it doesn't move on every render; 12 months follow the calendar.
  - Custom dates use Tokio's own `DateTimePicker`, the same on every system and in the app's language.
  - `dateRange`: a day without a time is the whole day, which After and Before leave out; Between takes both ends in either order; On is always a whole day. Nothing is filtered until the days are picked.
  - Rows stay all of their LIVE. The first row becomes the dates' totals with main's top gifters (`GET_GIFTERS`, asked again when the LIVEs change), and a new filter selects it. Its amounts and gifts are the LIVEs all in the dates (`allTime` in `helper.ts`) until main's `totals`, read through `platformParts`, add the cut LIVEs' gifts.
- The gifter search goes to main (`GET_GIFTERS`), so it finds anyone, not only the gifters listed. The selected LIVE goes as its own span (`startedAt` to `endedAt`), or the filter's range. The search stays while the selection and the dates change.
- Clear history shows only on All time, since it takes every LIVE.
- A Spanish long date is capitalized for the title (`capitalize`).
