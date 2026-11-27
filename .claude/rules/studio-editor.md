---
paths:
  - "src/renderer/src/pages/StudioEditor/**"
---

# Overlay Studio's editor

Builds on `.claude/rules/studio.md` (the data) and `.claude/rules/studio-stage.md` (the stage). Overlay Studio's editor tests are in six files, their helpers in `@test/studio`.

## The Elements panel

- The panel is **Elements** (the user's call). Its list is a tree with the front on top; the overlay keeps both back to front.
- Its look is the user's call: a thumbnail per element (`LayerThumb`, from the element itself, so hidden ones keep theirs), the event under an element or a group only while it reacts, and a row's grip, lock and eye only on hover, focus and the selection, or while that lock or eye is on.
- A camera's thumbnail is an icon: a live one would open another stream.
- A row's grip drags it. Dropped behind an element of a group from that row's lower half, an element reaches the group's back (the user found no way there); on a group row's top quarter, it goes in front of the group, on its own. A drop off the rows leaves it on its own: that's how an element leaves a group (the user's call). A group drops only among the items.
- The list is one Tab stop (a roving `tabIndex`, `roam`): ArrowUp and ArrowDown (Home, End) select and focus a row, as LIVE history's list does; ArrowLeft and ArrowRight go through a row's own buttons. On the grip, ArrowUp and ArrowDown move its row a step instead, an element into or out of a group at its edge.
- Lock is the canvas's only: the list and the settings still change a locked group or element (the user's call, as OBS locks).
- The **+** menu adds into the selected group or the selected element's group, else on its own in front, **New group** last, since a first overlay needs an element first. It sits in the header because the panel scrolls, which would clip one per row.
- Shift, Ctrl or Cmd and a click on a row toggles it in or out of the selection (`pick`). No range selection. An element toggled in takes its selected group's place, since its row doesn't show as selected and a toggle that did nothing would look broken. The rows' names have `user-select: none`, or a Shift-click selects the names between and Ctrl+C copies them as text.
- The trash, Delete and Backspace (a Mac's delete key) delete the selection at once, a group with its elements, since Undo brings it back (the user's call). The keys skip a locked one on the canvas, not in the list. Fields never see them.
- Ctrl+C, Ctrl+X and Ctrl+V (Cmd too) copy, cut and paste the selection with new ids (`copyItem`), pasting where the **+** menu adds, each paste `PASTE_STEP` further. The clipboard is the editor's own (`clipboard.ts`), kept until Tokio quits, so a copy pastes into another overlay too (the user's call). Fields keep their own keys (`TYPED_FIELDS`), and so does selected text.
- Several selected, the settings panel is `MultiSettings` (`alignEach`, `spaceEvenly`, a new group, delete), each one step. Locked items don't move (`moveItems`, which `nudge` uses too). The new group (`groupElements`) goes where the front-most was, or in front of its group, since groups don't nest.
- An element whose group is selected too leaves the selection (`select`). The history joins a run of changes only with the same selection. A click in the list past the items clears it (the user's call), as Escape and a click on the empty canvas do.
- A text's variables are in two rows: **LIVE numbers** (`STUDIO_NUMBERS` and the overlay's counters), always, and **From the event** (`studioEventVariables`), only while it reacts to one (the user's call). Both take the text's cap (`VariableList`'s `maxLength`): the input's own `maxLength` only stops typing, and past `STUDIO_TEXT_MAX_LENGTH` main refuses every save of the overlay.

## The canvas

- The stage picks by geometry, not the DOM: the pointer in canvas px (`fit()`), then the front-most element whose turned box holds it, skipping locked groups and elements, so a click goes through them (the user's call, as OBS's lock). Picking an element in a folded group unfolds it.
- A standalone element's stage layer has the element's id, so the stage takes a selected id as an element first: only a group is a selected layer.
- Shift and a press add or take out the item under it (`selectedAt`), or on empty canvas start a box select that adds. Without Shift, a press on the selection drags all of it, and a click that doesn't move picks only the one it was on.
- A drag from empty canvas is a box select of the elements whose extents touch it (`touching`), never a locked, hidden or locked group's one. It picks elements, not groups. The press clears the selection first, so a click on empty canvas still does.
- With several, the arrows move the ones not locked (`onNudge`), with the selection's outline and no handles, since several can't be resized or turned, and a fainter outline around them all (`selection_around`).
- A locked element or group keeps its outline but no handles. Boxes are whole px, at least 1 (`roundBox`); turns are whole degrees, never -0, which would come back from main as 0.
- **Flip** mirrors an element, and **Align to the canvas** moves it to an edge or a middle (`alignTo`), a turned one by how it shows (`extent`) (the user's call).
- A group resizes, turns, flips, aligns and fades like an element, its elements taking the change, locked ones included (the user's call). Its outline is `groupFrame`; `reframe` and `flipInFrame` move its elements into a new frame.
- Every step of a group's drag, or of a run of its field changes (`run` in `GroupSettings`), goes from the elements the first step found (`reframing`, keyed by the frame it began from), so rounding doesn't add up: small elements stalled at their rounded size. Not keyed by the elements it last made: StrictMode runs the updater twice, which spun a group past the pointer.
- The rotate cursor is a curved arrow turned with the element in 5° steps (the user's call). It's an SVG `data:` URL (`rotateCursor`), so the CSP's `img-src` keeps `data:`. A drag keeps its cursor on the whole stage (`held`).
- The stage is `role="application"`, since it takes the arrows, Space and Delete, with its keys in `aria-description` (`canvasHelp`).
- A click focuses the stage without the focus ring (`focus({ focusVisible: false })`): Chromium rang the whole canvas after a field had the focus (the user's call). Tab still rings it, for the arrows.
- The stage and `.stage_sizer` cut what passes their edges (`overflow: clip`), so a selection or an element off the canvas can't stretch the page or the scroll. The sizer keeps the canvas 40 px inside its edges, so an edge element's handles stay in view.
- `.stage .stage_root` takes two classes on purpose: the stream stylesheet's `.studio-stage` on the same element sets `position: relative`, which left the root as tall as its absolute canvas (0) and the canvas scaled to 0, whatever order the stylesheets load in.
- Hairlines inside the scaled canvas divide by `--canvas-scale` to stay one screen px.
- The editor's body mounts only once the `STUDIO` list holds its id.

## Text fitting

- `textHeight` and `textWidth` measure inside `still()`, which puts `.measuring` on the root: `transform: none !important` on every mover beats a running motion without restarting it (`animation: none` would), since a rect counts its parents' transforms and fitting never shrinks a box. The crop view draws the cropped element and its group always on screen, so no motion moves the picture from under the frame.
- A text's box can't get shorter than its words on the canvas, nor narrower than its longest word, so its height can't run away (the user's call). `textHeight` measures the words with a `Range`, at the resize's width and unturned, so wrapped lines count; `textWidth` measures at `min-content` with `overflow-wrap: normal`, since on stream a word too long for its box breaks anywhere.
- `textHeight`'s `Range` selects `.studio-words`' contents: over `.studio-text` it would count the span's line boxes, about 0.06 em taller.
- A change to its words in its settings (`WORDS`) grows its box to them too, as a corner drag would (the user's call), once the stage has drawn them (`fitting`, then `fitText` in a layout effect), around where they show so they stay put. It never shrinks the box, and Test's samples don't grow it.
- The box fields keep a text to its words too (the user's call): Width and Height take the stage's measures (`onWords`, `heightAt`) as their `min`, and a narrower Width grows the Height. `BoxFields`' `sizing` keeps the size a run of changes to one field began from, so a wider Width gives the Height back, keystrokes on the way to a number (the 45 of 450) don't leave it tall, and linked proportions don't drift by rounding. A size the fields didn't make starts over.
- Scaling a group can still squash a text below its words.

## Fields

- **When** (`ReactionFields`) comes right after **Name**: it decides which variables a text offers.
- **Test** is off while no element or shown group reacts to an event, when it would show nothing. A group offers every When and trigger, a goal too; an element's kind rules (a viewer, a gift or emote showing what's sent) stay in `ElementSettings` and hold for every trigger row.
- Both event Whens have a **Delay** (`STUDIO_MAX_DELAY`), kept to hundredths: a scrub's 0.1 steps add up to 0.30000000000000004. Test plays each item after its own, as main plays it on stream, with timeouts cleared by the next Test and on unmount.
- **Triggers** are the rows Alerts has (`TriggerRows`, `.claude/rules/triggers.md`). A row's new type goes through `retype`, never a spread: Zod strips what another type left, so main's echo differs and the autosave never settles. `likes_every` is one for every Like row, shown with the first.
- A viewer's picture offers no goal in any row. A gift or emote showing what's sent keeps one trigger: `onSent` clears `also_triggers`.
- **Goal reached** (`GOAL_TRIGGER`, Studio only) counts a LIVE number but `uptime`, or a named counter, up to a whole number of at least 1. A goal bar's number takes the same choices (`goalNumbers`), so one on a removed counter shows no number in either.
- A goal bar's **Vertical** swaps its width and height around its center in the same change, so one undo puts it back.
- **Counters** (`CountersFields`), named per overlay (the user's call), are in **Overlay settings**, `STUDIO_MAX_COUNTERS` at most. A name drops anything but word characters as it's typed, so the schema never refuses it. An empty, repeated or reserved one (a `STUDIO_NUMBERS` or `ALERT_MESSAGE_VARIABLES` name) is warned about under it (`counterWarning`), never refused (the user's call): a name is half typed on every autosave, and main would refuse each save of the overlay.
- Overlays are shared by every profile, but the editor offers what the active profile's platforms send (`PlatformsContext`, from one page-level `GET_PROFILE`): the triggers, the live numbers (`studioNumbersFor`, as Home's tiles: `{kicks}` with Kick, `{bits}` with Twitch) and goals, the Gift element (only with TikTok or YouTube, whose gifts have pictures), a gift element's picked gift (TikTok's catalog), an emote element's emotes (by `idPlatform`), a list's top's Platform select (`ListFields`), and on a YouTube gifters list a second top in **Shows**, Top gifters this LIVE by Jewels beside Top Super Chats this LIVE (its `rank`), and the lists New followers (`FOLLOW`) and Latest gifts (`GIFT`). A row, platform or goal number saved that the profile no longer uses keeps showing, and a text keeps any number it has.
- **Link width and height** (`resizeBox`'s `even`) holds in the fields and on the canvas's corners (the user's call). It's the editor's `linked`, until the editor closes, not saved.
- The editor's number fields drag (`NumberInput`'s `scrub`) (the user's call). The double-arrow cursor shows only once a press is held a quarter second or drags, not on a click, which the user saw flash. The press doesn't focus the field; a click without movement does.
- **Cropping** (`PictureFields`) never moves or scales a media, gift or emote picture: its box becomes the part it keeps (`recrop`). A viewer's picture fills its circle, so its crop picks what shows there, its box kept, with fields only (the user's call). Another file, gift or emote starts uncropped (`pictureSource`).
- On the canvas, a double-click or **Crop on the canvas** starts it (`cropping`), drawing the whole picture unrounded under the crop frame. Keeping it is one step; Escape cancels. Undo, Redo, copy and paste wait meanwhile. The thumbnails show the crop through `object-view-box`, which the app's own Chromium has.
- **A video's settings** (`VideoFields`): the canvas is its preview, with no second player (the user's call). **Cut** is the alerts' `CutTrack` (see `.claude/rules/alerts.md`).
  - While a cut handle moves, the canvas holds the video on that frame (`Stage.hold`), and `HOLD_MS` after the last move plays its cut again. The stage lets go on its own, so a selection that changes mid-drag can't leave it frozen.
  - Without **Loop**, **Play again** plays the cut once more (`Stage.replay`) (the user's call: the canvas's video stops at its end).
  - The length stays in the component's state: an effect writing the overlay would make an undo step and drop Redo.
- **A camera's settings** (`CameraFields`): a saved camera shows by its id, else by its name, else as "(not connected)"; picking one saves this build's id. The canvas shows the window's own capture (`previewCamera`, `.claude/rules/studio-camera.md`), with the overlay server off too.
- **Canvas sound** (`Stage.sound`) is off each time the editor opens (the user's call), and isn't saved or an undo step.

## Embed previews

- An installed overlay previews from disk in an `Iframe` with `transparent` (see `.claude/rules/overlays.md`). The countdown timer and the games overlay show their pages' previews in a `FitBox`: close to the stream, not exact (the user's call). An alert's overlay is a labeled box, since it shows media only while its alert plays.
- Previews can't frame the real pages live: the app's session cancels every WebSocket to the overlay server (`initSession` in `src/main/handler/app.ts`, `URL_FILTER`).
- The games column picker keeps a column an element saved after the games overlay dropped it.

## Undo and redo

- `useHistory` keeps steps while the editor is open, with no list of the changes (the user's call). Every edit goes through its `change`; the autosave saves an undo or a redo like any change, so the stream follows.
- A step is a canvas drag, press to release (`hold`), or else a run of quick changes from one control with one selection.
- It records in the event, not in a state updater, so StrictMode's double updaters can't push a step twice.
- Folding a group and showing the rulers aren't steps (`fold` and `onRulers` go through the autosave's own setter), and an undo or redo keeps the folds and the rulers as they are now (`withView`). Nor are the selection, the zoom, Link and Test; each change to the guides is one.
- Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z (Cmd too) on the window. Text fields keep their own (`TEXT_FIELDS`); a dialog takes none. The listener prevents what it takes: Electron's default Edit menu, which the app keeps, gets only the keys the page didn't handle.

## Zoom, rulers and guides

- `zoom` in `StudioStage` is the canvas's scale, `null` while it fits. The stage's `fit()` reads the scale from the root's size, so picking, dragging, text measuring and hairlines work unchanged zoomed. The menu's zoom is off (`lockMenu`, `.claude/rules/app-lifecycle.md`), so the zoom keys reach the editor on any layout.
- Ctrl or Cmd with the wheel, and a pinch, zoom through a native `wheel` listener with `passive: false`, since React's can't prevent the scroll. Every zoom keeps the canvas point under the pointer in place (`anchor`, whose layout effect also calls `setFit`, so the outline doesn't lag a frame), in a `flushSync`, so the wheel's next step starts from this one.
- Space held makes a drag pan; a field or a button keeps its own Space.
- The rulers (`Rulers.tsx`) are each overlay's own, off until turned on, with Ctrl+R (the user's call). In development the page prevents Ctrl+R before the menu's reload sees it.
- The rulers' state follows the scroll (in a `flushSync`, so they move in the canvas's frame) and the fit, so a scroll redraws only them: `StudioStage`'s layout effects measure text on every render.
- A guide is saved as `{ x, y, locked }`: where a vertical one crosses the top edge, a horizontal one the left, in canvas px. Guides show only with the rulers.
- Ctrl or Cmd and a press on a ruler drags out a guide, and on a guide (`nearGuide`) moves it; off the view, it goes (the user's call). A dragged guide sticks to the canvas's and the elements' edges and middles (`guideAt`), and a drop saves once (`withGuide`).
- Locked (`guides.locked`), the canvas can't change them; the list still does, as an element's lock works. `OverlaySettings` lists them under **Guides**, each place typed, with a lock and **Remove all guides** (the user's call).

## Sticking

- A press moves, resizes or turns what it holds only once the pointer has gone `DRAG_START`, so a click that slips can't move it, stick it to a line or clear Redo.
- A drag on the canvas always sticks, with no setting, to the guides, the canvas and other elements (the user's call): edges and middles, the nearest line on each axis (`snapBox`, `SNAP_REACH`). A group moves by the frame it began with, before the shared delta is rounded, and never sticks to its own elements. Several stick by the box around the ones that move (`unionBox`), to lines that leave those out; a locked one stays and is still a line.
- A dragged corner sticks the same way (`stickCorner`), with Link on too (the user's call): it keeps to the diagonal, so it sticks on the closer axis only.
- Alt (Option), held during a drag, turns sticking off for moves, corners and guides (the user's call). On Linux desktops that move a window with Alt and a drag, Alt has to go down after the press.
- Arrows, fields, Align and turning never stick (the user's call), so a box can still sit a few px off a line.

## Media sweep

- On `ALERT_FILE_REMOVED` for media the editor clears that file from its elements (`withoutMedia`), so its next save can't bring it back, and from every step of its history (`sweep`), so an undo can't either. Main's half is in `.claude/rules/studio.md`.
- `Layout` clears it from the clipboard (`forgetMedia`), since that outlives the editor. Not a module-level `window.api.on`: tests get a fresh `window.api` each, so a listener added once would hear only the first test's.
