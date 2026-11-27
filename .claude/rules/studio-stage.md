---
paths:
  - "src/common/studio/**"
  - "src/main/services/server/studio*"
---

# Overlay Studio's stage

Builds on `.claude/rules/studio.md` (the data and main's side). A camera's player (`playCamera`) is in `.claude/rules/studio-camera.md`.

## The stage

- One renderer for the stream and the editor: `src/common/studio/stage.ts` (`createStage(root, { slots, editing })`), in the markup `src/common/studio/overlay.css`'s header describes.
- `ServerService` inlines `stage.ts` (through `?script`, on the global `TokioStage`) and `overlay.css` into `studio.html`; the editor mounts the same stage (`StudioStage.tsx`) and imports the stylesheet globally. `stage.ts` imports only types (`.claude/rules/served-pages.md`), so `partOf` copies `cutPart`'s rule.
- Backgrounds stay transparent and nothing sets `color-scheme`: Chromium paints an iframe opaque when its `color-scheme` differs from its page's.
- It keeps one node per stage layer (`.studio-layer`): a group's, or a standalone element's, whose layer id is the element's own id. An id that goes from a group's to an element's, or back, gets a new node, so the wrapper comes and goes with it. Inside it, one node per element id, updated in place: it never moves a node or resets an iframe's `src` unless the element's kind or source changed or it changed groups, since Chromium reloads a moved iframe and views come on every autosave and every numbers push. So an embed that changes groups reloads.
- A group's layer holds one `.studio-group`, the group's mover, at the box around its elements' turned boxes; its elements are placed from that box's corner. The stage computes the box itself (`groupBox`, from the `extent` and `unionBox` the editor imports from `stage.ts`), and the layer keeps the z-index and the group's opacity, which `.studio-hidden` couldn't beat. The box is axis-aligned, so a group's motion doesn't turn with the group's editor-only rotation.
- An element's `rotation` is an inline `transform` on its node, so its motion (on `.studio-body`) turns with it; its flips come after it, so it mirrors along its own sides, then turns.
- In the editor, `slots: true` makes each embed an empty, stable `.studio-slot` that React portals its preview into, and `editing: true` keeps the elements and groups that wait for an event on screen (`.studio-waits`, on a group's wrapper too).
- A cropped or rounded picture is laid out by the stage from its own size (`layoutPicture`), since Chromium 103 has no `object-view-box`, and clipped with `clip-path: inset(… round …)`. It's hidden until its size is read, so it never shows uncut, and laid out again on `load` or `loadedmetadata` (a sent gift, a new file), and a camera's on `resize` too. A viewer's crop covers its circle instead (`layoutAvatar`).
- Shapes other than a rectangle or an ellipse draw as `svg.studio-figure`, one path from `shapePath` in px of the box, so nothing scales its stroke; the editor's thumbnails draw it the same way. A star's inner corners sit at Figma's ratio (`STAR_RATIO`).
  - Their border is a stroke at twice the width, cut to the inside by `clip-path: path()` with the same path: a border inside the edge for any shape, convex or not, with no ids to keep unique.
  - Their gradient is the svg's own CSS background (`.studio-gradient`), under a path filled `none`, cut by the same clip-path: no `<linearGradient>`, so no ids either. A rectangle's or an ellipse's is its body's background. The variables (`--studio-angle`, `--studio-color`, `--studio-color-2`) are the text gradient's too.
- An element's blur and shadow are one `filter` on its node (`effects`), never on `.studio-body`, whose blur entrance and exit animate `filter` and whose wipe sets `clip-path`, nor on a clipped figure or cropped picture, whose clip-path would cut the shadow off. A filter works before the node's transform, so the offset is turned back by the rotation and mirrored by the flips to fall the same way on screen.
- A text's outline is an underlay, `.studio-text::before` with its words (`data-text`) in the same grid cell under `.studio-words`, stroked at twice the width: Chromium 103 has no `paint-order` for HTML text, so a stroke on the words would cover half of each letter. Its halo is on the underlay too: on the words it would paint over a gradient and darken the outline. Every text style goes on `.studio-text`, never the span, so both copies inherit it and break their lines alike.
- A text's gradient is on `.studio-words` (`-webkit-background-clip: text`, unprefixed only from Chrome 120), a grid item sized to its lines, so it spans the words, not the box.
- A goal bar's body is its track, clipping its one child, `.studio-bar-fill`, to its corners. The fill's width (its height when vertical, from the bottom) eases, not a clip-path, so resizing the box in the editor doesn't lag its corners. A new fill has no style to ease from, so a reloaded page draws it at once instead of filling from empty. Its gradient is sized to the whole track in px (`background-size`), so the second color shows only as it fills. The editor and MCP's preview show every bar at `SAMPLE_FILL`, whatever its number: the sample numbers would fill most bars and hide the track.
- A list's rows are `.studio-rows` (the element node already has `.studio-list`). Each keeps its node by viewer as rows move, so a new row on top doesn't load every picture again. Its values are in Tokio's readout, Archivo at 75% width whatever the list's font. Chat's rows sit at the bottom of the box, the oldest cut off at its top edge.
- The page inlines Archivo's italic file as well, and the editor imports its stylesheet: without them Chromium slants the upright letters.

## Motion

Motion runs on movers, an element's `.studio-body` or a group's `.studio-group`, each with its own timer.

- An exit plays for `EXIT_MS`, every `studio-exit-*`'s length in `overlay.css` (they change together), held by its forwards fill until the timer hides the mover and pauses the videos under it (`hidden` checks the group's wrapper too). `.studio-hidden` has no transition: the fade-out is the `fade` exit.
- Views come on every autosave and numbers push, so a view leaves a mover alone mid-exit or mid-loop, and a loop's class is added only when it's missing, never restarted. Only a new When resets a mover, with no class left behind.
- A video without loop keeps an element on screen past its seconds, not a group. On stream, a group that hides it meanwhile sends it back to waiting (`playback`), or the group's next event would bring it back too. `enter` sets a mover's timer before its videos play, so a shown mover with no timer is only ever one its video holds.
- Keyframes take their class's name, since spin and flip are in several lists. Only `transform` moves things: Chromium 103 has no `translate`, `rotate` or `scale` properties and no `animation-composition`, so a group's motion and its elements' combine only because they're on different nodes.
- In the editor, a react plays the entrance, the seconds and the exit, and the mover comes back as it waits; loops play.

## Video and sound

- A video plays the part its element cuts (`start`, `end`), timed by its own clock as `alert.html` times an alert's: a timeout wakes at the part's end and arms again while the clock lags.
  - With `loop` it plays again from the part's start; an uncut one keeps the browser's seamless `loop`.
  - Without, it plays once and stops (`done`) (the user's call). On stream, an element that showed on an event leaves then: its Seconds hide it only if it isn't playing, as the alert page's duration does. One that moves on an event plays its part again on each.
  - Every view runs `playback`, which leaves a `done` video where it stopped and never plays an `ended` one (`play()` would start it at 0). An `ended` that comes after a react sought back is dropped.
  - A changed source, cut or loop starts it over, and so does a new player (an image, then Undo).
- It plays its sound on stream at its own `volume` (the user's call). A browser that refuses sound (a tab before a click; OBS doesn't) rejects `play()` with `NotAllowedError`: the stage then plays it muted, and later ones start muted (`quiet`: the policy is the page's) until a `click` unmutes them. Not a press: it isn't a user activation for touch, and Chromium pauses a video unmuted without one.
- The editor's stage starts `silent` until `Stage.sound(on)`. The app's `autoplay-policy` switch (`src/main/index.ts`) lets it play sound with no click.

## The page

- `?preview` (MCP's preview, `helper/studioPreview.ts`) connects no socket: the page draws with `editing: true`, its root takes `studio-preview` (which holds every mover's animation, so a loop isn't caught mid-swing), and `window.TokioPreview(view)` resolves, with how many failed or took past 5 s, once its fonts, pictures, videos and embeds (each plus 0.5 s for its socket to draw it) have loaded and two frames were painted. Main builds that view with `studioSampleView`: Test's samples on the profile's platforms, no camera.
- An embedded imported overlay is same-origin with the Studio page and can read it, the camera key included, so imported overlays are trusted code. Not sandboxed: that breaks overlays built with Vite (the user's call).
