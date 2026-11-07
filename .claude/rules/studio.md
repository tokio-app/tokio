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

**Tools → Overlay Studio** (`pages/Studio`, `/tools/studio`) lists the streamer's own overlays, each with its number of elements, built from elements alone or in groups; each opens in the editor (`pages/StudioEditor`, `/tools/studio/$id`). They live in `settings.studio`, shared by every profile like the overlay library, and each is served at `/studio/<id>/` (`STUDIO_PATH`, `getStudioOverlayURL`, `NOTE: DO NOT CHANGE`), one browser source.

## Architecture

- One renderer for the stream and the editor: `src/common/studio/stage.ts` (`createStage(root, { slots, editing })` → `update`, `react`, `slot`, `fit`, `destroy`), in the markup `src/common/studio/overlay.css`'s header describes. `ServerService` inlines both into `studio.html`; the editor mounts the same stage (`StudioStage.tsx`) and imports the stylesheet globally.
- It keeps one node per stage layer (`.studio-layer`, the whole canvas, stacked by `z-index`): a group's, or an element's on its own, whose layer id is the element's own id. Inside it, one node per element id, updated in place. It never moves a node or resets an iframe's `src` unless the element's kind or source changed, or it went into, out of or between groups: Chromium reloads a moved iframe, and views come on every autosave and every numbers push.
- A layer's node lets the pointer through (`pointer-events: none`); its elements catch it. A group's takes the group's `opacity`, over its elements' own.
- An element's node takes its `rotation` as an inline `transform`, around its center, so its entrance and animation (on `.studio-body`) turn with it. Its flips come after it in the same `transform` (`scale(-1, 1)`), so it mirrors along its own sides, then turns.
- `studioView(overlay, deps)` (`src/common/util/studio.ts`) resolves every element into one stage layer per group or standalone element, and leaves hidden groups and elements out; a `z` is the place among all of them, hidden ones included, so hiding one doesn't renumber the rest. Main (`src/main/helper/studio.ts`) and the editor call it with their own `deps`, so the page never fills text or matches triggers.
- The page gets the stage through `stage.ts?script` (`inlineScript` in `electron.vite.config.ts`, also in Vitest's main project, typed in `src/main/env.d.ts`): esbuild compiles the file alone, not bundled, to an IIFE on the global `TokioStage`, `target: "chrome103"`. So `stage.ts` imports only types, and uses nothing newer than Chromium 103 (OBS 30): no `toSorted`, `Object.groupBy` and the like. `overlay.css` has the same limit: no `:has()`, nesting, subgrid, container queries or `color-mix()`.
- `overlay.css` loads globally in the windows, so every class starts with `studio-`. Backgrounds stay transparent and nothing sets `color-scheme`: Chromium paints an iframe opaque when its `color-scheme` differs from its page's.
- In the editor (`slots: true`) each embed is an empty, stable `.studio-slot` that React portals its preview into; `editing: true` keeps the elements that wait for an event on screen (`.studio-waits`) and plays a react in place, with no timer to hide it.

## Data

- An overlay's `items` go back to front: groups (`StudioGroupSchema`, `kind: "group"`) and elements on their own. A group's `elements` go back to front too, and groups don't hold groups. A group has a `name`, `locked` (the editor's canvas can't pick, move or resize its elements), `hidden` (off the canvas and the stream), `folded` (the editor's list), `rotation` (its frame's turn in the editor), `flip_x` and `flip_y` (whether its elements were mirrored as one, for the toggles) and `opacity` (its layer's, on stream too); its elements keep the result of moving, scaling, turning and mirroring it; an element (`StudioElementSchema`) is one of the seven kinds, with its `label` (its name in the editor, `""` for what it shows; not `name`, which is a media element's file name), box, `rotation` (degrees clockwise around its center, -180 to 180), `flip_x` and `flip_y` (mirrored left to right, top to bottom), opacity, its own `locked` and `hidden`, and When. An element is locked or hidden when it or its group is. Ids are unique across groups and elements both.
- `StudioOverlaySchema` (`src/common/schemas/studio.ts`) is the strict schema, for IPC and the store's mutators. It validates without transforming (no trims, clamps, rounding or `.catch`): `useAutosave` settles a save only when main's echo deep-equals what it sent. For the same reason the editor builds only schema-shaped objects, since Zod drops unknown keys.
- `StoredStudioOverlaysSchema`, for `settings.studio` (`.default([])`), drops an element, then a group, then an overlay, that doesn't parse (a newer Tokio's kind after a downgrade, a hand edit) instead of failing the store, which would reset every setting. An overlay saved before groups, with `layers`, loads with each layer as a group (`withItems`).
- Caps: `STUDIO_MAX_GROUPS` (100), `STUDIO_MAX_ELEMENTS` (100, grouped or not), `STUDIO_TEXT_MAX_LENGTH` (500), `STUDIO_NAME_MAX_LENGTH` (60, for groups' and elements' names too), `STUDIO_MAX_SECONDS` (60), `STUDIO_MAX_FONT_SIZE` (400). Each autosave rewrites and flushes the whole `tokio.json`, so keep them tight.
- A media element saves a library basename; the only URL an element saves is an emote's `image`, kept to `https:`. Text goes in with `textContent`, fonts as one `fontFamily` (`JSON.stringify`), colors as CSS variables (hex only).
- The list page picks the id (`crypto.randomUUID()`) and the name ("Overlay N", `newOverlayName`). `addStudioOverlay` refuses an id that isn't a UUID or is taken, since it becomes the URL and the socket id; `saveStudioOverlay` refuses one it doesn't hold. The mutators return whether the store file was written; a false still keeps the change in memory, then `saveFailure()`.
- Handlers in `src/main/events/pages/studio.ts` (`createStack("overlays")`): `GET_STUDIO`, `ADD_STUDIO_OVERLAY`, `SAVE_STUDIO_OVERLAY` (autosave, no notice), `REMOVE_STUDIO_OVERLAY`, `TEST_STUDIO_OVERLAY` (`notify: false`). Every one replies `STUDIO` with the list main holds, failures included.

## Reactions

- Each element reacts on its own: its `when` is `always`, `event` (hidden until its trigger, then `seconds` with its `entrance`) or `animate` (always on screen, plays its `animation` on each trigger). A group doesn't react; it only groups.
- `StudioService.handle` runs `streakOf` once per event, then `matchesTrigger` per element that reacts, both from `@/helper/triggers` like alerts. On Like an element reacts each time the likes from every viewer pass another `likes_every` (default 100, the rest carried over, at most once per event), counted per element.
- A gift or emote element with none picked (`gift: null`, `emote: null`, a new one's default, on a Gift or Emote trigger) shows what its event sent: `sentPicture` reads the gift's `image`, or the message's emote its trigger names (else the first), for the react's `picture` and, from what it kept, for its view (`sent` in `StudioViewDeps`). Emote samples (`generateEmoteChatSample`) always hold an emote.
- It keeps each element's last event values and viewer (picture, name) until Tokio quits, so a reloaded page shows them. `kept(element)` returns them only while the element's trigger type is the one they came from. Before the first event, the trigger's variables read `""`.
- Hidden elements, and those of a hidden group, still react and keep their values: their page ignores reacts for elements it doesn't draw, and they have the latest event when they show again.
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
- An embed moved into, out of or between groups reloads, as its node moves.

## Media sweep

- `REMOVE_MEDIA` (`pages/alerts.ts`) clears the file from every studio media element, grouped or not (`removeFromStudio`: the element stays, empty), before deleting it, re-sends the views, and keeps the file with `saveFailure()` when the store can't be written.
- On `ALERT_FILE_REMOVED` for media the editor clears that file from its elements too, so its next save can't bring it back.

## The editor

- The panel keeps the title **Layers**: the elements are the layers, and groups hold them. Its list is a tree with the front on top: the overlay's items, with a group's elements (unless it's folded) indented under it; the overlay keeps both back to front.
- A row's grip drags it. An element drops among a group's elements, onto a group's row (into it, in front; the row's top quarter puts it in front of the group, on its own, so an element can leave a group between two groups), or onto a standalone element's row (on its own, in its place). A group drops only among the items: over a group's element, it takes that group's place. Only the keyboard puts an element behind the backmost group. ArrowUp and ArrowDown move a row a step (toward the front is up), taking the focus back after a `flushSync` as the games builder does: a group steps past its neighbor, an element steps within its group and out of it past its edge, and an element on its own steps into a group it meets, which unfolds.
- A group's row folds it, locks it and hides it; an element's row locks and hides it, and shows its `label`, or what it shows when that's blank. Lock is the canvas's only: the list and the settings still change a locked group or element (the user's call, as OBS locks).
- The header's **+** menu adds a group ("Group N", in front) or an element, into the selected group or the selected element's group, else on its own in front. At the caps its items are disabled, with a note saying why. Its trash deletes the selection; a group that still holds elements asks first in a `Modal`, since nothing undoes it. The menu sits in the header because the panel scrolls (`overflow-y: auto`), which would clip one per row.
- `selected` is a group's id or an element's: ids are unique across both. The settings pane follows it: `GroupSettings` (the name, and how it moves, or that it's locked or hidden), `ElementSettings` (its **Name**, saved as `label`, with the row's name as placeholder, then the kind's fields, box, flips, opacity and When) or, with none, `OverlaySettings`.
- The stage picks by geometry, not the DOM: the pointer in canvas px (`getBoundingClientRect` and `fit()`), then the front-most element whose box, turned, holds it, skipping locked groups and elements (`locked` holds both ids), so a click goes through them. Picking an element in a folded group unfolds it.
- A standalone element's stage layer has the element's id, so the stage takes a selected id as an element first: only a group is a selected layer, with the group's outline and drag.
- An element selected: drag moves it, a handle on each corner resizes it with the opposite corner kept where it is on the canvas (`resizeBox`, along a turned element's own sides), the round handle above its top turns it around its center (`turnTo`, Shift in steps of 15), arrows nudge 1 px (Shift 10), Escape deselects. None of it on a locked element or group, which keeps the outline, turned with it, but no handles. Boxes are whole px, width and height at least 1 (`roundBox`); turns are whole degrees, never -0, which would come back from main as 0.
- A text's box can't get shorter than its words on the canvas, nor narrower than its longest word, so its height can't run away (both the user's calls). `textHeight` measures the words with a `Range` on the stage, at the width the resize gives and unturned, so wrapped lines count; `textWidth` measures the text at `min-content` with `overflow-wrap: normal`, since on stream a word too long for its box breaks anywhere. A change to a text's words in its settings (`WORDS`: text, font, size, bold) grows its box to them too, once the stage has drawn them (the editor's `fitting` ref, then `fitText` in a layout effect after the stage's update), around where they show so they stay put: across from the side they line up with, and from the middle, where they sit. It never shrinks the box, and Test's samples don't grow it.
- The box fields keep a text to its words too (the user's call): the stage measures the selected text after each change (`onWords`: its longest word, its words' height at its width, and `heightAt` for another width), Width and Height take them as their `min` (a typed number under it isn't reported, a drag stops there), and a narrower Width grows the Height to the words. `BoxFields`' `sizing` keeps the size a run of changes to one field began from, so the Height a narrower Width gave comes back with a wider one, and keystrokes on the way to a number (the 45 of 450) don't leave it tall.
- Under the box's fields, **Flip** (two toggles beside Rotation) mirrors the element, and **Align to the canvas** moves it to an edge or a middle of the canvas (`alignTo`), a turned element by how it shows, its `extent`.
- **Link width and height**, the toggle between Width and Height, makes them change together in proportion, in the fields and on the canvas's corners (`resizeBox`'s `even`, along the box's diagonal; a text still can't get smaller than its words). It's the editor's `linked`, for every element and group until the editor closes, not saved. The fields take the proportions from the size they started at (`linking` in `BoxFields`), so a dragged field doesn't drift by rounding; a size they didn't make (a drag, another element; within a px, as a group's frame comes back from its elements' whole px) starts over.
- The editor's number fields drag (`NumberInput`'s `scrub`; other pages' don't): held a quarter second or dragged, the cursor turns to a double arrow (not on a click, which the user saw flash), and moving right or left raises or lowers the value a step per screen px, 10 with Shift, past 3 px. The press doesn't focus the field: a click without that much movement does, with its number selected, and a field already being typed in selects text as usual.
- A click focuses the stage without the focus ring (`focus({ focusVisible: false })`): Chromium rang the whole canvas after a field had the focus, which the user found meaningless. Tab still rings it, for the arrows.
- The stage cuts what passes its edges (`overflow: clip`), so a selection past the canvas can't stretch the page, and the canvas and the selection sit 40 px inside them (`.stage_area`), so the handles of an element at the canvas's edge stay in view, the rotate handle 32 px past its side.
- The rotate handle has its own cursor, a clockwise arrow (`src/renderer/src/assets/rotate-cursor.svg`, black on a white halo like the system's), and the whole stage keeps it while an element turns (`.turning`), since the pointer leaves the handle. The corner handles' resize cursors don't turn with the element.
- A group selected (from the list) outlines its frame (`groupFrame`: the smallest box, turned by its `rotation`, around its shown elements) with an element's handles. Dragging inside it, after 3 screen px, moves its elements by one rounded delta, and so do the arrows; a click without that much movement picks what's under it. A locked one's outline picks at once, past it, with no handles, and an empty or hidden one has no outline, so the arrows move nothing.
- Its corners and rotate handle, and its settings' box fields (`BoxFields`, shared with elements), move, scale and turn its elements into the new frame (`reframe`: each keeps its place in the frame, its sides scaled as the frame's are along them). Changes go on from the elements and frame the first one began from while the group still holds the elements the last one made (`reframing`, compared deeply), so rounding doesn't add up over a drag or a dragged field: without it, small elements stalled at their rounded size. Its flips mirror them across it (`flipInFrame`), Align moves them, and Opacity fades its layer. Scaling a group can squash a text below its words.
- An element that waits for an event (`when: "event"`) gets a dashed hairline (`.studio-waits`), so it can be placed. Hairlines inside the scaled canvas divide by `--canvas-scale` to stay one screen px.
- The editor's body mounts only once the `STUDIO` list holds its id; the list page opens a new overlay only then, so a failed add opens nothing. A deleted id shows an `EmptyState` with the way back.
- `.stage .stage_root` takes two classes on purpose: the stream stylesheet's `.studio-stage` on the same element sets `position: relative`, which left the root as tall as its absolute canvas (0) and the canvas scaled to 0, whatever order the two stylesheets load in.
- The editor's page uses `<Page width="full">`.

## The user's calls

- Test plays on stream too, like the Overlays page's and the games overlay's.
- An event while an element shows restarts it with the newest values.
- Like elements react every N likes from all viewers, as game actions count them.
- Groups hold elements, and elements can also stand on their own; elements are the layers, so the panel stays **Layers**. When stays on each element: a group orders, names, locks, hides and folds its elements, and moves them as one, locked ones included.
- Elements take names of their own, like groups.
- Elements lock and hide like groups, and turn by a handle on the canvas or the Rotation field, like their size.
- A group resizes, turns, flips, lines up and fades like an element, and its elements take the change.
- Elements flip horizontally and vertically, and line up with the canvas's edges and middles.
- Width and height can be linked to change together, and number fields change by dragging across them while pressed.
- A text's box grows to its words when its size, font, text or bold changes, as a corner drag would, and its Width and Height fields can't make it smaller than its words.
- No ring around the whole canvas when it's clicked.
- A Like offers no viewer or count: its likes come from every viewer (`countedVariables`). Alerts keep them, as they play each viewer's batch.
- A viewer's picture offers only the triggers a viewer sends (not Envelope, Super Fan Box or Music change) and the event Whens. Gift and emote elements show what a viewer sends or one you pick (an emote from the saved ones); the first offers only the Gift or Emote trigger and the event Whens, and choosing it sets both.
- A shape has a fill and a border inside its edge, each on or off (`fill`, `color`; `border`, `border_color`, `border_width` up to `STUDIO_MAX_BORDER`). Its view's `color` is null without a fill and `border` null without one, drawn as `--studio-color` and `--studio-border`.
- A text's variables are in two rows under it: **LIVE numbers** (`STUDIO_NUMBERS`), always, and **From the event** (`studioEventVariables`), only while it reacts to one.
- Lock blocks only the canvas, clicks going through to what's under, as OBS's lock does.
- The editor's timer and games previews are close to the stream, not exact.
