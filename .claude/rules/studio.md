---
paths:
  - "src/renderer/src/pages/Studio/**"
  - "src/renderer/src/pages/StudioEditor/**"
  - "src/common/studio/**"
  - "src/main/services/studio/**"
  - "src/main/helper/studio*"
  - "src/main/events/pages/studio*"
  - "src/main/services/server/studio*"
  - "src/common/schemas/studio*"
  - "src/common/types/studio.ts"
  - "src/common/util/studio*"
---

# Overlay Studio

**Tools → Overlay Studio** (`pages/Studio`, `/tools/studio`) lists the streamer's own overlays, built from layers that hold elements; each opens in the editor (`pages/StudioEditor`, `/tools/studio/$id`). They live in `settings.studio`, shared by every profile like the overlay library, and each is served at `/studio/<id>/` (`STUDIO_PATH`, `getStudioOverlayURL`, `NOTE: DO NOT CHANGE`), one browser source.

## Architecture

- One renderer for the stream and the editor: `src/common/studio/stage.ts` (`createStage(root, { slots, editing })` → `update`, `react`, `slot`, `fit`, `destroy`), in the markup `src/common/studio/overlay.css`'s header describes. `ServerService` inlines both into `studio.html`; the editor mounts the same stage (`StudioStage.tsx`) and imports the stylesheet globally.
- It keeps one node per layer id (`.studio-layer`, the whole canvas, stacked by `z-index`) and one per element id inside it, updated in place. It never moves a node or resets an iframe's `src` unless the element's kind or source changed, or it went to another layer: Chromium reloads a moved iframe, and views come on every autosave and every numbers push.
- A layer's node lets the pointer through (`pointer-events: none`), its elements catch it, as before layers held them.
- `studioView(overlay, deps)` (`src/common/util/studio.ts`) resolves every element, and leaves hidden layers out; a layer's `z` is its place among all of them, so hiding one doesn't renumber the rest. Main (`src/main/helper/studio.ts`) and the editor call it with their own `deps`, so the page never fills text or matches triggers.
- The page gets the stage through `stage.ts?script` (`inlineScript` in `electron.vite.config.ts`, also in Vitest's main project, typed in `src/main/env.d.ts`): esbuild compiles the file alone, not bundled, to an IIFE on the global `TokioStage`, `target: "chrome103"`. So `stage.ts` imports only types, and uses nothing newer than Chromium 103 (OBS 30): no `toSorted`, `Object.groupBy` and the like. `overlay.css` has the same limit: no `:has()`, nesting, subgrid, container queries or `color-mix()`.
- `overlay.css` loads globally in the windows, so every class starts with `studio-`. Backgrounds stay transparent and nothing sets `color-scheme`: Chromium paints an iframe opaque when its `color-scheme` differs from its page's.
- In the editor (`slots: true`) each embed is an empty, stable `.studio-slot` that React portals its preview into; `editing: true` keeps the elements that wait for an event on screen (`.studio-waits`) and plays a react in place, with no timer to hide it.

## Data

- An overlay's `layers` go back to front, and each layer's `elements` too. A layer (`StudioLayerSchema`) has a `name`, `locked` (the editor's canvas can't pick, move or resize its elements), `hidden` (off the canvas and the stream) and `folded` (the editor's list); an element (`StudioElementSchema`) is one of the seven kinds, with its box, opacity and When. Ids are unique across layers and elements both.
- `StudioOverlaySchema` (`src/common/schemas/studio.ts`) is the strict schema, for IPC and the store's mutators. It validates without transforming (no trims, clamps, rounding or `.catch`): `useAutosave` settles a save only when main's echo deep-equals what it sent. For the same reason the editor builds only schema-shaped objects, since Zod drops unknown keys.
- `StoredStudioOverlaysSchema`, for `settings.studio` (`.default([])`), drops an element, then a layer, then an overlay, that doesn't parse (a newer Tokio's kind after a downgrade, a hand edit) instead of failing the store, which would reset every setting.
- Caps: `STUDIO_MAX_LAYERS` (100), `STUDIO_MAX_ELEMENTS` (100, in all layers), `STUDIO_TEXT_MAX_LENGTH` (500), `STUDIO_NAME_MAX_LENGTH` (60, for layer names too), `STUDIO_MAX_SECONDS` (60), `STUDIO_MAX_FONT_SIZE` (400). Each autosave rewrites and flushes the whole `tokio.json`, so keep them tight.
- A media element saves a library basename; the only URL an element saves is an emote's `image`, kept to `https:`. Text goes in with `textContent`, fonts as one `fontFamily` (`JSON.stringify`), colors as CSS variables (hex only).
- The list page picks the id (`crypto.randomUUID()`) and the name ("Overlay N", `newOverlayName`). `addStudioOverlay` refuses an id that isn't a UUID or is taken, since it becomes the URL and the socket id; `saveStudioOverlay` refuses one it doesn't hold. The mutators return whether the store file was written; a false still keeps the change in memory, then `saveFailure()`.
- Handlers in `src/main/events/pages/studio.ts` (`createStack("overlays")`): `GET_STUDIO`, `ADD_STUDIO_OVERLAY`, `SAVE_STUDIO_OVERLAY` (autosave, no notice), `REMOVE_STUDIO_OVERLAY`, `TEST_STUDIO_OVERLAY` (`notify: false`). Every one replies `STUDIO` with the list main holds, failures included.

## Reactions

- Each element reacts on its own: its `when` is `always`, `event` (hidden until its trigger, then `seconds` with its `entrance`) or `animate` (always on screen, plays its `animation` on each trigger). A layer doesn't react; it only groups.
- `StudioService.handle` runs `streakOf` once per event, then `matchesTrigger` per element that reacts, both from `@/helper/triggers` like alerts. On Like an element reacts each time the likes from every viewer pass another `likes_every` (default 100, the rest carried over, at most once per event), counted per element.
- It keeps each element's last event values and viewer (picture, name) until Tokio quits, so a reloaded page shows them. `kept(element)` returns them only while the element's trigger type is the one they came from. Before the first event, the trigger's variables read `""`.
- The elements of a hidden layer still react and keep their values: their page ignores reacts for elements it doesn't draw, and the layer has the latest event when it shows again.
- `forget(id)` on remove; `clear()` on `DISCONNECTED` drops the gift streaks and like counts, not the kept values.
- Another react while an element shows restarts its entrance and its `seconds` with the newest values; an `animate` element plays its animation again from the start.
- Test (the editor's play button) plays every element that reacts once, with samples: the editor on its own stage (fresh `Samples`), and `TEST_STUDIO_OVERLAY` on stream (`StudioService.test`, `generateTikTokEventSample`). Test's samples are never kept, so a reload shows the real last event.

## Live numbers

- `{likes}`, `{viewers}`, `{followers}`, `{shares}`, `{coins}` in any text, compact in the app's language (`formatStat`, now in `src/common/util/format.ts`). `fillStudioText` fills them first (names checked with `Object.hasOwn`), then the trigger's values in one `formatAlertMessage` pass, so a viewer's comment that says `{likes}` stays as typed.
- `registerStudio` (`src/main/events/init.ts`) is registered after `registerConnectorEvents`: the connector runs listeners in order, synchronously, so the stats and the LIVE session already hold the event when the studio reads them.
- One listener per trigger serves both the reacts and the numbers (GIFT and CHAT have many listeners already; Node warns past 10). Emote triggers are matched on chat; `MUSIC_CHANGE` comes from `music.onSongChange`, once per song as alerts take it.
- On `LIKE`, `ROOM_USER`, the `ACTIVITY_EVENTS` and `CONNECTED`, a throttle (`STATS_THROTTLE_MS`) re-sends the views of the overlays whose texts use a number (`showsNumbers`), built when it fires. `DISCONNECTED` cancels it, so a late push can't show the LIVE's numbers over the zeros, and sends them at once.
- `liveNumbers`: `likes` and `viewers` from `getLiveStats()`, the rest from `live.getSession().totals`, 0 while `startedAt === null`. The editor shows `SAMPLE_NUMBERS`, never the LIVE's.
- Views are also re-sent on `SAVE_STUDIO_OVERLAY` (that one, even when the write failed), on `onLanguage`, after a gift refresh and after `recordGift` saves a gift TikTok's list misses, after `REMOVE_MEDIA`, and after `REMOVE_OVERLAY` and `INSTALL_OVERLAY`, since an embed's resolution changes.

## Messages and connections

- The page connects with the socket id `studio:<id>` (`studioSocketId`, `STUDIO_SOCKET_PREFIX`); `onConnect` sends it its view. It reconnects after 2 s and ignores the LIVE events every overlay gets.
- Two messages, private to the page like `tokio:timer` (not in `TokioPayload`): `tokio:studio` (`{ view: StudioView | null }`) and `tokio:studio:react` (`{ element, text?, picture?, name? }`).
- A removed overlay, or an id main doesn't hold, gets `{ view: null }`, which clears the page.

## Embeds

- On stream each is an iframe at its real path: `/<id>/` for an installed overlay, `/alerts/<id>/`, `/timer/`, `/games/minecraft/`, or one column's `/games/minecraft/<column>/`. An installed overlay that isn't served gets `src: null` and draws nothing; reinstalling it (official overlays keep their id) re-sends the views and it shows again.
- A games embed's `column` (1 to `GAMES_OVERLAY_MAX_COLUMNS`) places one column on its own, `null` all of them. The picker offers each column once the games overlay has more than one, "row" when its layout is horizontal as the Games page says it, plus one an element kept after the columns dropped. The editor's preview then draws only that column's rows, as its only column.
- `StudioSource` has one union member per `type`, so a chain of `if`s on `type` narrows to the last.
- In the editor (`Embed.tsx`): an installed overlay previews from disk in a named `Iframe` with `transparent` (`?transparent`, see `.claude/rules/overlays.md`), with its own sample data. The countdown timer and the games overlay show their pages' previews (`TimerPreview` and `OverlayPreview` with `bare`) in a `FitBox` scaled to the element's box. An alert's overlay is a labeled box, since it shows media only while its alert plays.
- Previews can't frame the real pages live: the app's session cancels every WebSocket to the overlay server (`initSession` in `src/main/handler/app.ts`, `URL_FILTER`).
- An overlay embedded twice, in one studio overlay or two, shares its settings and saved state, as two browser sources of it do.
- An embed moved to another layer reloads, as its node moves.

## Media sweep

- `REMOVE_MEDIA` (`pages/alerts.ts`) clears the file from every studio media element, in every layer (`removeFromStudio`: the element stays, empty), before deleting it, re-sends the views, and keeps the file with `saveFailure()` when the store can't be written.
- On `ALERT_FILE_REMOVED` for media the editor clears that file from its elements too, so its next save can't bring it back.

## The editor

- The layers list is a tree with the front on top: each layer, then (unless it's folded) its elements, front on top, indented under it; the overlay keeps both back to front. A row's grip drags it; ArrowUp and ArrowDown move it a step (toward the front is up), taking the focus back after a `flushSync` as the games builder does. An element past its layer's edge moves into the next layer, which unfolds.
- A layer's row folds it, locks it and hides it. Lock is the canvas's only: the list and the settings still change a locked layer's elements (the user's call, as OBS locks).
- The header's **+** menu adds a layer ("Layer N", in front) or an element, to the selected layer, the selected element's layer, else the front one (a new layer when there's none). At the caps its items are disabled, with a note saying why. Its trash deletes the selection; a layer that still holds elements asks first in a `Modal`, since nothing undoes it. The menu sits in the header because the panel scrolls (`overflow-y: auto`), which would clip one per row.
- `selected` is a layer's id or an element's: ids are unique across both. The settings pane follows it: `LayerSettings` (the name, and how it moves, or that it's locked or hidden), `ElementSettings` (the kind's fields, box, opacity and When) or, with none, `OverlaySettings`.
- The stage picks by geometry, not the DOM: the pointer in canvas px (`getBoundingClientRect` and `fit()`), then the front-most element whose box holds it, skipping locked layers, so a click goes through them. Picking an element in a folded layer unfolds it.
- An element selected: drag moves it, the corner handle resizes it, arrows nudge 1 px (Shift 10), Escape deselects; none of it on a locked layer, which keeps the outline but no handle. Boxes are whole px, width and height at least 1 (`roundBox`).
- A layer selected (from the list) outlines its elements' bounding box with no handle: dragging inside it, after 3 screen px, moves them all by one rounded delta, and so do the arrows; a click without that much movement picks what's under it. A locked one's outline picks at once, past it, and an empty or hidden one has no outline, so the arrows move nothing.
- An element that waits for an event (`when: "event"`) gets a dashed hairline (`.studio-waits`), so it can be placed. Hairlines inside the scaled canvas divide by `--canvas-scale` to stay one screen px.
- The editor's body mounts only once the `STUDIO` list holds its id; the list page opens a new overlay only then, so a failed add opens nothing. A deleted id shows an `EmptyState` with the way back.
- `.stage .stage_root` takes two classes on purpose: the stream stylesheet's `.studio-stage` on the same element sets `position: relative`, which left the root as tall as its absolute canvas (0) and the canvas scaled to 0, whatever order the two stylesheets load in.
- The editor's page uses `<Page width="full">`.

## The user's calls

- Test plays on stream too, like the Overlays page's and the games overlay's.
- An event while an element shows restarts it with the newest values.
- Like elements react every N likes from all viewers, as game actions count them.
- Layers hold elements, and When stays on each element: a layer groups, orders, names, locks, hides and folds them, and moves them as one.
- Lock blocks only the canvas, clicks going through to what's under, as OBS's lock does.
- The editor's timer and games previews are close to the stream, not exact.
