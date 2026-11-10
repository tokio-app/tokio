---
paths:
  - "src/renderer/src/pages/StudioEditor/**"
---

# Overlay Studio's editor

Builds on `.claude/rules/studio.md` (the stage and the data).

## The Elements panel

- The panel is **Elements** (the user's call). Its list is a tree with the front on top, each group a tray around its row and its elements; the overlay keeps both back to front.
- Its look is the user's call: a thumbnail per element (`LayerThumb`, from the element itself, so hidden ones keep theirs), the event under an element or a group only while it reacts, and a row's grip, lock and eye only on hover, focus and the selection, or while that lock or eye is on.
- A camera's thumbnail is an icon: a live one would open another stream.
- A row's grip drags it. Dropped behind an element of a group from that row's lower half, an element reaches the group's back (the user found no way there); on a group row's top quarter, it goes in front of the group, on its own. Off the rows, in a gap or under the last, a drop leaves it on its own: that's how an element leaves a group (the user's call). A group drops only among the items.
- ArrowUp and ArrowDown move a row a step, an element into or out of a group at its edge; the focus goes back to the row's grip.
- Lock is the canvas's only: the list and the settings still change a locked group or element (the user's call, as OBS locks).
- The **+** menu adds into the selected group or the selected element's group, else on its own in front. It sits in the header because the panel scrolls (`overflow-y: auto`), which would clip one per row.
- The trash deletes the selection at once, a group with its elements, since Undo brings it back (the user's call). So do Delete and Backspace (a Mac's delete key; Supr on a Spanish keyboard): on the canvas not on a locked one, in the list (its `ul`'s `onKeyDown`) a locked one too. From the list, the focus goes on to the row after it, or before it at the end (`data-select`). Fields never see the key.
- Ctrl+C, Ctrl+X and Ctrl+V (Cmd too) copy, cut and paste a group or element with new ids (`copyItem`), where the **+** menu adds, each paste `PASTE_STEP` further. The clipboard is the editor module's own, not the system's, kept until Tokio quits, so a copy pastes into another overlay too (the user's call). Fields keep their own (`TYPED_FIELDS`), and so does selected text.
- `selected` is a group's id or an element's. A click in the list past the items clears it (the user's call), as Escape and a click on the empty canvas do.
- A text's variables are in two rows: **LIVE numbers** (`STUDIO_NUMBERS`), always, and **From the event** (`studioEventVariables`), only while it reacts to one (the user's call).

## The canvas

- The stage picks by geometry, not the DOM: the pointer in canvas px (`getBoundingClientRect` and `fit()`), then the front-most element whose turned box holds it, skipping locked groups and elements (`locked` holds both ids), so a click goes through them (the user's call, as OBS's lock). Picking an element in a folded group unfolds it.
- A standalone element's stage layer has the element's id, so the stage takes a selected id as an element first: only a group is a selected layer.
- A locked element or group keeps its outline but no handles. Boxes are whole px, at least 1 (`roundBox`); turns are whole degrees, never -0, which would come back from main as 0.
- **Flip** mirrors an element, and **Align to the canvas** moves it to an edge or a middle (`alignTo`), a turned one by how it shows (`extent`) (the user's call).
- A group resizes, turns, flips, aligns and fades like an element, its elements taking the change, locked ones included (the user's call). Its outline is `groupFrame`; `reframe` and `flipInFrame` move its elements into a new frame.
- Every step of a group's drag, or of a run of its field changes (`run` in `GroupSettings`, while the frame is still the one the last change asked for, within a px), goes from the elements the first step found (`reframing`, keyed by the frame it began from), so rounding doesn't add up: small elements stalled at their rounded size. Not keyed by the elements it last made: StrictMode runs the updater twice, and each run added a turn, so a group spun past the pointer.
- The rotate cursor is a curved arrow turned with the element in 5° steps, so it follows the turn (the user's call). It's an SVG `data:` URL in `image-set` (`rotateCursor`), so the CSP's `img-src` keeps `data:`. A drag keeps its cursor on the whole stage while the pointer leaves what it holds (`held`).
- A click focuses the stage without the focus ring (`focus({ focusVisible: false })`): Chromium rang the whole canvas after a field had the focus (the user's call). Tab still rings it, for the arrows.
- The stage cuts what passes its edges (`overflow: clip`), so a selection past the canvas can't stretch the page, and `.stage_sizer` does too, so an element far off the canvas can't stretch the scroll. The sizer keeps the canvas 40 px inside its edges, so an edge element's handles stay in view.
- `.stage .stage_root` takes two classes on purpose: the stream stylesheet's `.studio-stage` on the same element sets `position: relative`, which left the root as tall as its absolute canvas (0) and the canvas scaled to 0, whatever order the stylesheets load in.
- Hairlines inside the scaled canvas divide by `--canvas-scale` to stay one screen px.
- The editor's body mounts only once the `STUDIO` list holds its id.

## Text fitting

- `textHeight` and `textWidth` measure inside `still()`, which puts `.measuring` on the root: `transform: none !important` on every mover beats a loop's or a group's running motion without restarting it (`animation: none` would), since a rect counts its parents' transforms and fitting never shrinks a box. The crop view draws the cropped element and its group always on screen, so no motion moves the picture from under the frame.
- A text's box can't get shorter than its words on the canvas, nor narrower than its longest word, so its height can't run away (the user's call). `textHeight` measures the words with a `Range` on the stage, at the resize's width and unturned, so wrapped lines count; `textWidth` measures at `min-content` with `overflow-wrap: normal`, since on stream a word too long for its box breaks anywhere.
- A change to its words in its settings (`WORDS`: text, font, size, bold) grows its box to them too, as a corner drag would (the user's call), once the stage has drawn them (`fitting`, then `fitText` in a layout effect after the stage's update), around where they show so they stay put. It never shrinks the box, and Test's samples don't grow it.
- The box fields keep a text to its words too (the user's call): Width and Height take the stage's measures (`onWords`, `heightAt`) as their `min`, and a narrower Width grows the Height. `BoxFields`' `sizing` keeps the size a run of changes to one field began from, so the Height a narrower Width gave comes back with a wider one, keystrokes on the way to a number (the 45 of 450) don't leave it tall, and linked proportions don't drift by rounding. A size the fields didn't make (a drag, another element; within a px) starts over.
- Scaling a group can still squash a text below its words.

## Fields

- **When** is `ReactionFields`, an element's and a group's alike. A group offers every When and trigger; an element's kind rules (a viewer, a gift or emote showing what's sent) stay in `ElementSettings`.
- **Link width and height** makes them change together in proportion, in the fields and on the canvas's corners (`resizeBox`'s `even`) (the user's call). It's the editor's `linked`, until the editor closes, not saved.
- The editor's number fields drag (`NumberInput`'s `scrub`) (the user's call). The double-arrow cursor shows only once a press is held a quarter second or drags, not on a click, which the user saw flash. The press doesn't focus the field; a click without movement does.
- **Cropping** (`PictureFields`) never moves or scales a media, gift or emote picture: its box becomes the part it keeps (`recrop`, from `Stage.picture`). A viewer's picture fills its circle, so its crop picks what shows there, its box kept, with fields only (the user's call). Another file, gift or emote starts uncropped (`pictureSource`); its corners stay.
- On the canvas, a double-click or **Crop on the canvas** starts it (`cropping`), drawing the whole picture unrounded (`pictureFrames`, `boxOn`) under the crop frame. Keeping it is one step (`cropOf`); Escape cancels. Undo, Redo, copy and paste wait meanwhile. The thumbnails show the crop through `object-view-box`, which the app's own Chromium has.
- **A video's settings** (`VideoFields`, keyed by its file): the canvas is its preview, with no second player (the user's call). **Cut** is the alerts' `CutTrack` (see `.claude/rules/alerts.md`), shown once a hidden player has read the length.
  - While a cut handle moves, the canvas holds the video on that frame (`Stage.hold`), and `HOLD_MS` after the last move plays its cut again. The stage lets go on its own, so a selection that changes mid-drag can't leave it frozen.
  - Without **Loop**, **Play again** plays the cut once more (`Stage.replay`) (the user's call: the canvas's video stops at its end).
  - The length stays in the component's state: an effect writing the overlay would make an undo step and drop Redo.
- **Shape** tiles (`ShapeFields`) are native radios, so the arrow keys move through them.
- **A camera's settings** (`CameraFields`) list the window's cameras (`enumerateDevices`, again on `devicechange`). A saved camera shows by its id, else by its name, else as "(not connected)"; picking one saves this build's id. The canvas shows the camera from the window's own capture (`previewCamera`, see `.claude/rules/studio.md`), with the overlay server off too.
- **Canvas sound** plays the canvas's videos with their sound (`Stage.sound`), Test's included. It's off each time the editor opens (the user's call), isn't saved or an undo step.

## Embed previews

- An installed overlay previews from disk in an `Iframe` with `transparent` (see `.claude/rules/overlays.md`), with its own sample data. The countdown timer and the games overlay show their pages' previews (`TimerPreview`, `OverlayPreview` with `bare`) in a `FitBox`: close to the stream, not exact (the user's call). An alert's overlay is a labeled box, since it shows media only while its alert plays.
- Previews can't frame the real pages live: the app's session cancels every WebSocket to the overlay server (`initSession` in `src/main/handler/app.ts`, `URL_FILTER`).
- The games column picker keeps a column an element saved after the games overlay dropped it.

## Undo and redo

- `useHistory` keeps up to 100 steps while the editor is open, with no list of the changes (the user's call). Every edit goes through its `change`; the autosave saves an undo or a redo like any change, so the stream follows.
- A step is a canvas drag, press to release, pauses included (`hold`, from `onHold`), or else a run of changes less than 500 ms apart from one control (`document.activeElement`) with one selection.
- It records in the event, not in a state updater, so StrictMode's double updaters can't push a step twice.
- Folding a group and showing the rulers aren't steps (`fold` and `onRulers` go around the history, through the autosave's own setter), and an undo or redo keeps the folds and the rulers as they are now (`withView`). The selection, the zoom, Link and Test aren't steps either; each change to the guides is one.
- Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z (Cmd too) on the window. Text fields keep their own (`TEXT_FIELDS`); a dialog takes none. The listener prevents what it takes: Electron's default Edit menu, which the app keeps, gets only the keys the page didn't handle.

## Zoom, rulers and guides

- `zoom` in `StudioStage` is the canvas's scale, `null` while it fits. The stage's `fit()` reads the scale from the root's size, so picking, dragging, text measuring and hairlines work unchanged zoomed. `stage.ts` knows nothing of it.
- The menu's zoom is off (`lockMenu`, see `.claude/rules/app-lifecycle.md`), so the zoom keys reach the editor on any layout.
- Ctrl or Cmd with the wheel, and a pinch, zoom through a native `wheel` listener with `passive: false`, since React's can't prevent the scroll. Every zoom keeps the canvas point under the pointer in place (`anchor`, scrolled back in a layout effect that also calls `setFit`, so the outline doesn't lag a frame), in a `flushSync`, so the wheel's next step starts from this one.
- A press on the scrollbars (its target is `.stage_scroll` itself) picks nothing. Space held makes a drag pan (`held` is `"pan"`); a field or a button keeps its own Space.
- The rulers (`Rulers.tsx`) are each overlay's own, off until turned on, with Ctrl+R (the user's call). A packaged app never reloads (`lockMenu`); in development the page prevents Ctrl+R before the menu's reload sees it.
- The rulers' state follows the scroll (in a `flushSync`, so they move in the canvas's frame) and the fit, so a scroll redraws only them: `StudioStage`'s layout effects measure text on every render.
- A guide is saved as `{ x, y, locked }`: where a vertical one crosses the top edge, a horizontal one the left, in canvas px. Guides show only with the rulers.
- Ctrl or Cmd and a press on a ruler drags out a guide, and on a guide (`nearGuide`) moves it; off the view, it goes (the user's call). `start` captures the pointer on the stage element, so the stage's handlers take a ruler's drag. A dragged guide sticks to the canvas's and the elements' edges and middles (`guideAt`). A drop saves once (`withGuide`), when it changed.
- Guides are drawn in `.stage_area`, so they follow the zoom and the scroll natively.
- Locked (`guides.locked`), the canvas can't change them; the list still does, as an element's lock works.
- `OverlaySettings` lists them under **Guides**, each place typed, with a lock and **Remove all guides** (the user's call).

## Sticking

- A drag on the canvas always sticks, with no setting, to the guides, the canvas and other elements (the user's call): edges and middles, within `SNAP_REACH`, the nearest line on each axis (`snapBox`, lines from `snapLines` at the press). A group moves by the frame it began with, before the shared delta is rounded, and never sticks to its own elements.
- A dragged corner sticks the same way (`stickCorner`), with Link on too (the user's call): it keeps to the diagonal, so it sticks on the closer axis only.
- Alt (Option), held during a drag, turns sticking off for moves, corners and guides (the user's call). On Linux desktops that move a window with Alt and a drag, Alt has to go down after the press.
- Arrows, fields, Align and turning never stick (the user's call), so a box can still sit a few px off a line.

## Media sweep

- On `ALERT_FILE_REMOVED` for media the editor clears that file from its elements, so its next save can't bring it back, and from every step of its history (`sweep`), so an undo can't either. Main's half is in `.claude/rules/studio.md`.
