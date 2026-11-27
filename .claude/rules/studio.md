---
paths:
  - "src/renderer/src/pages/Studio/**"
  - "src/main/services/studio/**"
  - "src/main/helper/studio*"
  - "src/main/events/pages/studio*"
  - "src/common/schemas/studio*"
  - "src/common/types/studio.ts"
  - "src/common/util/studio*"
---

# Overlay Studio

**Tools → Overlay Studio** (`pages/Studio`) lists the streamer's own overlays; each opens in the editor (`pages/StudioEditor`, `.claude/rules/studio-editor.md`). They live in `settings.studio`, shared by every profile like the overlay library, and each is served at `/studio/<id>/` (`STUDIO_PATH`, `getStudioOverlayURL`, `NOTE: DO NOT CHANGE`), one browser source. The stage that draws them is in `.claude/rules/studio-stage.md`, the cameras in `.claude/rules/studio-camera.md`.

- `studioView(overlay, deps)` (`src/common/util/studio.ts`) resolves the elements into one stage layer per group or standalone element, hidden ones left out; a `z` counts them too, so hiding one doesn't renumber the rest. Main (`src/main/helper/studio.ts`) and the editor pass their own `deps`, so the page never fills text or matches triggers.

## Data

- An overlay's `items` go back to front: groups (`StudioGroupSchema`, `kind: "group"`) and standalone elements; a group's `elements` too. Groups don't hold groups, and ids are unique across groups and elements.
- A group reacts as one, with an element's reaction fields (`REACTION`), while its elements keep their own When inside it (the user's call). Its `rotation`, `flip_x` and `flip_y` are its frame's in the editor: its elements save the result of moving, scaling, turning and mirroring it. Its `opacity` is its layer's, on stream too.
- The loop is `idle`, not `loop`, which a media element's video has. Exits pick from the entrances' list (`STUDIO_ENTRANCES`), whose `slide` slides up, as older files saved it.
- An element's (`StudioElementSchema`) name is `label` (`""` for what it shows; not `name`, a media element's file name): elements take names of their own, like groups (the user's call). It locks and hides like a group (the user's call), and is locked or hidden when it or its group is. `rotation` is degrees clockwise, -180 to 180.
- `StudioOverlaySchema` (`src/common/schemas/studio.ts`) is the strict schema, for IPC and the store's mutators. It validates without transforming (no trims, clamps, rounding or `.catch`): `useAutosave` settles a save only when main's echo deep-equals what it sent. For the same reason the editor builds only schema-shaped objects, since Zod drops unknown keys.
- `StoredStudioOverlaysSchema`, for `settings.studio` (`.default([])`), drops an element, then a group, then an overlay that doesn't parse (a newer Tokio's kind after a downgrade, a hand edit) instead of failing the store, which would reset every setting. Guides it can't read are dropped (`.catch`), not the overlay, and a group's reaction field it can't read takes its default (`orDefault`), so a newer Tokio's animation doesn't drop the group's elements. An overlay saved before groups, with `layers`, loads with each layer as a group (`withItems`).
- Every picture kind (`StudioPictureKind`) crops and rounds up to a circle (the user's call): `crop` is the fractions cut from each side, which can't meet, and `rounding` a % of the shorter side of what shows (50 is round, a viewer's default). Its view's `crop` is null when it keeps all of the picture.
- The shapes (`STUDIO_SHAPES`) are the user's picks, each filling its box; a rectangle is the default, and older files'. A polygon's `sides` and a star's `points` go 3 to `STUDIO_MAX_CORNERS` (12, the user's call); each shape keeps its own count, so switching back finds it. Fill and border are each on or off, the border inside the edge (the user's call); the view's `color` is null without a fill and `border` null without one.
- A list shows rows of one `source`:
  - `gifters`: this LIVE's top gifters on its `platform` (TikTok's by default, so older overlays stay as they were), in its money and only those who sent some (`historyService.topByPlatform()`). Each currency ranks on its own.
  - `giftsubs`: its top sub gifters on Twitch, YouTube or Kick (`topSubGifters()`), money and gifted subs topped apart, as Home does. Picking it moves a list on a platform without gifted subs to the profile's first that has them.
  - The newest followers, gifts or chat messages, which `StudioService.handle()` keeps, `STUDIO_MAX_LIST_ROWS` of each, newest first, one set for every overlay (they're the LIVE's). Not read from Home's feed, whose settings hide kinds of events. A gift goes in once, when its streak ends (`repeatEnd`), with the streak's total; a chat of emotes alone (blank `content`, as the connector sends it) doesn't. A viewer who follows again moves up instead of taking a second row, matched by the name shown, since TikTok's picture links change.
  - Every list is empty while not LIVE, as top gifters are.
- Its rows have one fixed layout, no templates (the user's call): the picture or initial, the name, a chat's message after it, and on the right the value (`listRow`), a gifter's amount in their platform's currency (YouTube's in US dollars through `listInUsd`, Bits as a count) or a gift's picture and count (×12), compact in the app's language. The editor's sample rows follow the same rule. Chat's newest is at the bottom, the others' newest or biggest on top (`elementView` turns chat's over).
- A media element has its video's cut (spreads the alerts' `CUT`), `loop` (on by default) and `volume`; an image ignores them. Another file (`setMedia`) starts uncut and keeps its volume and loop, as alerts do.
- An overlay also saves the editor's `rulers` and `guides`. The stream never gets either.
- The caps (`STUDIO_MAX_ELEMENTS`, `STUDIO_MAX_GROUPS` and the rest) stay tight: each autosave rewrites and flushes the whole `tokio.json`.
- A media element saves a library basename; the only URL an element saves is an emote's `image`, kept to `https:`.
- The list page picks the id (`crypto.randomUUID()`) and opens a new overlay only once the `STUDIO` list holds it, so a failed add opens nothing.
- Duplicate sends `ADD_STUDIO_OVERLAY` with `copy`, the source's id, and stays on the list (the user's call). `copyName` names the copy. `addStudioOverlay` copies everything the source holds, element ids too, so an element id is unique only within its overlay: key anything per element by its overlay too. A source main no longer holds gets `main.studio.missing`.
- `addStudioOverlay` refuses an id that isn't a UUID or is taken, since it becomes the URL and the socket id; `saveStudioOverlay` and `removeStudioOverlay` refuse one they don't hold, and the handler warns `main.studio.missing`. Every handler in `src/main/events/pages/studio.ts` replies `STUDIO` with the list main holds, failures included.

## Reactions

- Each element and group reacts on its own. Its `when` is `always`, `event` (hidden until its trigger, then `seconds` with its `entrance`, then its `exit`), `animate` (shown, plays its `animation` on each trigger) or `loop` (shown, plays its `idle` forever, no trigger). `reactsToEvents` is the one check for a trigger, so a loop never counts as reacting.
- `StudioService.handle` runs `streakOf` once per event, counts the counters, then `matchesTrigger` per reacting group and element, each group just before its elements, as alerts do (`.claude/rules/triggers.md`). An item reacts when any of `triggersOf(item)` matches; it matches a row's `platform` as alerts do. The first that matches wins; a goal never matches an event. A group's react carries only its id (`StudioReact.element` names either) and keeps nothing.
- On Like an element reacts each time the likes from every viewer pass another `likes_every`, the rest carried over, at most once per event, counted per element of each overlay, as game actions count them (the user's call). That counting applies only when the trigger that matched is a Like, the only kind that can match `LIKE`; a Like offers no viewer or count variables (`countedVariables`, `.claude/rules/triggers.md`).
- A viewer's picture offers only the triggers a viewer sends (not Envelope, Super Fan Box or Music change) and the event Whens (the user's call).
- A gift or emote element shows one picked (an emote from the saved ones) or, with none (`gift: null`, `emote: null`, a new one's default), what its event sent; that choice offers only the Gift or Emote trigger and the event Whens, and sets both (the user's call). `sentPicture` reads the gift's `image`, or the emote its trigger names (else the first), for the react and, kept, for the view (`sent` in `StudioViewDeps`). Emote samples (`generateEmoteChatSample`) always hold an emote, in their platform's ids.
- It keeps each element's last event values and viewer until Tokio quits, so a reloaded page shows them, with the type of the trigger that matched. `kept(overlay, element)` returns them only while that type is still one of the element's triggers. What it keeps (values, Test samples, like counts) goes by overlay id, then element id: a duplicate holds its source's element ids. Before the first event, the trigger's variables read `""`.
- Hidden elements, and those of a hidden group, still react and keep their values: their page ignores reacts for elements it doesn't draw, and they have the latest event when they show again.
- **Delay** (`delay`, 0 to 10 s) waits in main, not on the stage: views come with every numbers push, so if main kept the event at once, a wait on the stage would show an animate text's new words before it moves. A match schedules the react per overlay and item (`_schedule`); 0 plays in the same tick. When it plays it keeps the event, sends the react and reads the numbers then.
  - A match during the wait changes the event it will show but never restarts the wait (the user's call: a busy chat would hold it back for good). A react with no event (a group's, a goal's) doesn't replace one waiting.
  - Its timer catches and logs its errors (`<Studio>`, the service's log file): services don't know the notifier.
- `clear()` on `DISCONNECTED` drops the gift streaks, like counts, counters, goals reached, the lists' rows and the reacts waiting, not the kept values. `startLive()` on `CONNECTED` drops the counters, goals reached and the lists' rows. A drop the connector recovers from sends neither (`onReconnect`), so it keeps them.
- Another react while an element shows restarts its entrance and its `seconds` with the newest values, and an `animate` element's animation from the start (the user's call). One during its exit enters again.
- Test plays every reacting element and group once, elements with their first trigger's sample (a goal's has none), on the editor's stage (fresh `Samples`) and on stream too (`TEST_STUDIO_OVERLAY`, `StudioService.test`), like the Overlays page's and the games overlay's (the user's call).
  - `Samples` takes the active profile's platforms (the handler reads them) and keeps one sample per trigger type and platform (`samplePlatform`), so the elements one event sets off show the same viewer. A gifters list samples its own platform's gifters; the other lists take turns among the profile's platforms that send their event. The editor makes new ones when the profile's platforms change.
  - On stream it waits each item's delay like an event, so `onReact` sends its reacts, not the handler.
  - Each element keeps its sample (`_tests`) for its seconds and a second for its exit, or until a real event reacts it (the user's call): views come on every numbers push, which would show the real last event at once. Then a reload shows the real last event.

## Live numbers

- Any text shows the LIVE's numbers (`STUDIO_NUMBERS`: `{coins}` is TikTok's, `{kicks}` Kick's `KICKS`, `{giftsubs}` Twitch's, YouTube's gifted memberships and Kick's), compact in the app's language (`formatStat`), `{superchats}` as US dollars (`formatMoney`, a dash until the rates load) and `{uptime}` as 01:02:03. `fillStudioText` fills them, then the counters, then the event's values in one pass (names checked with `Object.hasOwn`), so a viewer's comment that says `{likes}` stays as typed.
- **Counters** (the user's call): up to 10 per overlay (`counters`, `{ name, trigger }`), which texts show as `{name}`. `handle()` counts them right after `streakOf`, per overlay and name, in memory: a gift adds `added` with `every_gift`, else `total` (without it a streak matches only at its end, where `added` is just the last increment), a Like its likes, any other event 1. They read 0 while not LIVE, like `{coins}`. The schema takes any name of word characters, since the editor saves one while it's typed and only warns; MCP's save refuses an empty, repeated or taken one.
- **Goals**: a `GOAL_TRIGGER` trigger (Studio's only) watches `number`, a LIVE number but uptime, else the overlay's counter of that name, else 0. `goals(overlays, numbers)` runs in the numbers throttle, before the views go: it reacts each item once per LIVE per overlay, item, number and goal (a changed goal can be reached again), the first time the number is at or past it, through the same delay. It takes a function, so a delayed goal reads the numbers when it plays. It shows the item's kept event again, so a `{username}` text doesn't empty.
- `registerStudio` (`src/main/events/init.ts`) is registered after `registerConnectorEvents`: the connector runs listeners in order, synchronously, so the stats and the LIVE session already hold the event when the studio reads them.
- One listener per trigger serves the reacts, the counters and the numbers (GIFT and CHAT have many listeners already; Node warns past 10). Emote triggers are matched on chat; `MUSIC_CHANGE` comes from `music.onSongChange`, once per song as alerts take it.
- On every trigger (a counter can count any), `ROOM_USER` and `CONNECTED`, a throttle (`STATS_THROTTLE_MS`) runs the goals, then re-sends the views of the overlays whose texts use a number or one of their counters (`showsNumbers`), built when it fires. `DISCONNECTED` cancels it, so a late push can't show the LIVE's numbers over the zeros, and sends them at once.
- `{uptime}` ticks from main: once a second while the LIVE session has started, only the overlays whose texts show it get their view again (`showsUptime`). Not a clock on the page: OBS on another PC has its own.
- The editor shows `SAMPLE_NUMBERS`, never the LIVE's (`liveNumbers`).
- Lists get every numbers push too (`showsNumbers`): chat, gifts and follows send one, and so does `history.onChange`, for a new top gifter.
- Views are also re-sent on `SAVE_STUDIO_OVERLAY` (even when the write failed), on `onLanguage`, after a gift refresh and after `recordGift` saves a gift TikTok's list misses, after `REMOVE_MEDIA`, and after `REMOVE_OVERLAY` and `INSTALL_OVERLAY`, since an embed's resolution changes.

## Messages

- The page connects with the socket id `studio:<id>` (`studioSocketId`, `STUDIO_SOCKET_PREFIX`); `onConnect` sends it its view.
- Two messages, private to the page like `tokio:timer` (not in `TokioPayload`): `tokio:studio` (`{ view: StudioView | null }`) and `tokio:studio:react` (`{ element, text?, picture?, name? }`).
- A removed overlay, or an id main doesn't hold, gets `{ view: null }`, which clears the page.

## Embeds

- On stream each is an iframe at its real path: `/<id>/` for an installed overlay, `/alerts/<id>/`, `/timer/`, `/games/minecraft/`, or one column's `/games/minecraft/<column>/`. An installed overlay that isn't served gets `src: null` and draws nothing; reinstalling it (official overlays keep their id) re-sends the views and it shows again.
- A games embed's `column` (1 to `GAMES_OVERLAY_MAX_COLUMNS`) places one column on its own, `null` all of them.
- `StudioSource` has one union member per `type`, so a chain of `if`s on `type` narrows to the last.
- An overlay embedded twice, in one studio overlay or two, shares its settings and saved state, as two browser sources of it do.

## Media sweep

- `REMOVE_MEDIA` (`pages/alerts.ts`) clears the file from every studio media element, grouped or not (`removeFromStudio`: the element stays, empty), before deleting it, re-sends the views, and keeps the file with `saveFailure()` when the store can't be written. The editor's half is in `.claude/rules/studio-editor.md`.
