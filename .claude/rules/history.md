---
paths:
  - "src/main/services/history/**"
  - "src/main/events/pages/lives.ts"
  - "src/renderer/src/pages/Lives/**"
---

# LIVE history

`HistoryService` (`src/main/services/history`) keeps each profile's LIVEs and the viewers who sent gifts in them, for the LIVEs page (`/lives`) and the top gifters overlays get as `tokio:gifters`.

## Recording

- A LIVE runs from `CONNECTED` to `DISCONNECTED`, the span of Home's session (`.claude/rules/live-session.md`). Drops the connector recovers from stay in it; a connection lost for good starts a new LIVE on the next connect.
- `start(username)` gets the @username from `TikTokConnectorService.username`, the last `connect()`'s, set before the provider connects because `CONNECTED` comes before `connect()` resolves.
- `HISTORY_EVENTS`:
  - gifts, through the service's own `GiftStreaks`: `added` gifts and `added × max(0, coins)` coins, as Home counts them
  - follows and shares, 1 each
  - likes: the highest `totalLikes` seen
  - views and peak viewers: the highest ROOM_USER `views` and `viewers`
- Only gifts count as coins: Tokio's treasure chest event carries no data, and a Super Fan event only the viewer.
- Gifters are keyed by `UserData.userId`. A gift without one counts in the totals only. Name, handle and picture follow the latest gift, and a gift without a picture keeps the last one.
- Pictures are saved although TikTok's links expire within days (the user's call): overlays and the page fall back to the initial.
- Nothing is recorded before a load, or for a profile whose index doesn't load.

## The files

- `history/<profile name>/` (`folders.historyFolder`, the profile file's name without `.json`), outside the profile like the fans (Persistence in `AGENTS.md`).
- `index.json`: the finished LIVEs' summaries, oldest first, and all time's gifters, the most coins first with ties to the earlier `giftedAt`. Written when a LIVE ends, after a recovery or a delete, and to retry a failed save.
- `<startedAt>.json`: one `LiveRecord` per LIVE, with all its gifters.
  - The LIVE in progress rewrites only its own file, every `HISTORY_SAVE_MS` (30 s, `registerHistory`) while it changes, with `endedAt` set to the save's time.
  - A finished LIVE's file is never rewritten, which is why there's no LIVE limit.
- When a LIVE ends, its file is written one last time, then the index with its summary appended and its gifters added to all time.
- `MAX_GIFTERS` (10,000) caps all time: the fewest coins go first, then the oldest last gift. The page shows the top `SHOWN_GIFTERS` (100) and each LIVE keeps all of its own gifters, so nobody shown is dropped.
- No save on quit (`shortcut:`), like the fans and the timer: a quit or a crash loses at most 30 s, and the next load adds the rest from the LIVE's file.

## Loading, recovery, deleting and clearing

- `load(file)` runs at startup and on `SET_PROFILE`, which saves first and refuses the switch when that fails. A later load wins over an earlier one still reading.
- A missing index is an empty history. One that's there but doesn't load is left as it is, nothing is recorded, and the log has a warning.
- A LIVE file the index doesn't list, newer than every LIVE it does, was left by a quit or a crash: it's added, ending at its last save, and the index is saved at once. An unlisted older one is a delete's leftover and is removed, and so are `<name>.cleared-<digits>` folders, a clear's leftovers.
- `deleteLive` subtracts the LIVE's gifters, read from its file, from all time, dropping a gifter left with nothing. Then it saves the index and removes the file. An unreadable file still leaves the index, and all time keeps its gifts (logged).
- `clear` renames the profile's folder away in one step (`renameWithRetry`), then removes it.
  - A LIVE in progress carries on. Its file and an empty index are written at once, the index over anything a save racing the move wrote.
  - It refuses, changing nothing, when no history is loaded or the rename fails.

## Overlays

- `{ type: "tokio:gifters", data: { live, allTime } }`, each the top `TOP_GIFTERS` (10) as `TopGifter`, with both the `live` and the `allTime` numbers. `live` is `[]` outside a LIVE.
- `allTime` merges a cached top 10 of the finished LIVEs (`_best`) with this LIVE's gifters, so a push never sorts all of all time.
- Each client gets it as it connects, then after each load, on a LIVE's start and end, a delete or a clear, and on gifts that count. Pushes go through a 1 s `throttle` (`GIFTERS_PUSH_MS`) that reads the lists when it fires, and `ServerService.sendToAll` sends them.
- Test sends a sample (see Previews in `.claude/rules/overlays.md`).
- The SDK (`@tokioapp/overlay`) types it as `TOKIO_EVENTS.GIFTERS`. Overlays on an older version log it as an unknown type.

## The page's data

- `GET_LIVES` replies `LIVES`: the finished LIVEs, newest first, and all time's top 100. The LIVE in progress joins when it ends, when main pushes `LIVES` again; Home shows it until then. The page asks again on each `GET_PROFILE` reply, a profile switch.
- `GET_LIVE { startedAt }` replies `LIVE` with that LIVE's record. Failures carry the `startedAt` too.
- `DELETE_LIVE` and `CLEAR_LIVES` reply `LIVES` with what main holds, then send `LIVE_DELETED` or `HISTORY_CLEARED`. A failed save after a delete throws `HISTORY_SAVE_FAILED`, a refused clear `HISTORY_CLEAR_FAILED`.

## The page

- `pages/Lives`, second in the sidebar (`LuHistory`), on Home's grid. The layout the user picked: the selected LIVE on the left as Home showed it when it ended, the list on the right.
- The dashboard is as tall as the window leaves it (`--title-bar-height`), and both lists scroll inside it, so picking a LIVE with more gifters doesn't move the list.
- **The list** is a `listbox` with one tab stop (a roving `tabIndex`): Up, Down, Home and End move the selection and the focus, and each option is named by its date, time and coins. All time comes first, then the LIVEs, newest first.
  - Under each LIVE, a 2px coin bar in Iron is scaled to the best LIVE, the page's one bold element. The selected one gets the rose edge, bar and `--accent-soft` wash.
  - Hovered rows use Field (`--background-secondary`), since Iron would hide the bars.
- **The left column** shows the LIVE's long date, its times, length and @username, the readout (Home's: 36px, then 24px) and its gifters, which come with `GET_LIVE` (a `Spinner` until then; a reply for another `startedAt` is dropped).
  - All time sums the LIVEs' numbers in `allTime` (`helper.ts`), with the best peak instead of a sum, and lists the top 100.
- **Selection:** the newest LIVE, or All time when there are none. After a delete, the one that took its place, or the one before when it was the last (`keepSelection`). A LIVE that ends and joins keeps the selection; another profile's `LIVES` starts from its newest.
- Delete and Clear history are icon buttons on the left's title row, which ask first with `DeleteLiveModal` and `ClearHistoryModal` (`components/DeleteModals`). Clear is disabled while there's nothing to clear.
- Dates go through `formatDate` (`helper/format.ts`), and a Spanish long date is capitalized for the title (`capitalize`).
