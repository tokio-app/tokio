---
paths:
  - "src/renderer/src/pages/Studio/**"
  - "src/common/studio/**"
  - "src/main/services/studio/**"
  - "src/main/helper/studio*"
  - "src/main/events/pages/studio*"
  - "src/main/services/server/studio*"
  - "src/common/schemas/studio*"
  - "src/common/types/studio.ts"
  - "src/common/util/studio*"
  - "src/main/services/server/camera*"
  - "src/renderer/src/helper/camera*"
  - "src/renderer/src/hooks/useCameraCapture*"
---

# Overlay Studio

**Tools → Overlay Studio** (`pages/Studio`, `/tools/studio`) lists the streamer's own overlays; each opens in the editor (`pages/StudioEditor`, `/tools/studio/$id`, see `.claude/rules/studio-editor.md`). They live in `settings.studio`, shared by every profile like the overlay library, and each is served at `/studio/<id>/` (`STUDIO_PATH`, `getStudioOverlayURL`, `NOTE: DO NOT CHANGE`), one browser source.

## The stage

- One renderer for the stream and the editor: `src/common/studio/stage.ts` (`createStage(root, { slots, editing })`), in the markup `src/common/studio/overlay.css`'s header describes. `ServerService` inlines both into `studio.html`; the editor mounts the same stage (`StudioStage.tsx`) and imports the stylesheet globally.
- The page gets it through `stage.ts?script` (`inlineScript`, also in Vitest's main project, typed in `src/main/env.d.ts`) on the global `TokioStage`, `target: "chrome103"` (OBS 30). So `stage.ts` imports only types: `partOf` copies `cutPart`'s rule for that reason.
- Backgrounds stay transparent and nothing sets `color-scheme`: Chromium paints an iframe opaque when its `color-scheme` differs from its page's.
- It keeps one node per stage layer (`.studio-layer`): a group's, or a standalone element's, whose layer id is the element's own id. Inside it, one node per element id, updated in place: it never moves a node or resets an iframe's `src` unless the element's kind or source changed or it changed groups, since Chromium reloads a moved iframe and views come on every autosave and every numbers push. So an embed that changes groups reloads.
- A group's layer holds one `.studio-group`, the group's mover, at the box around its elements' turned boxes; its elements are placed from that box's corner. The stage computes the box itself (`groupBox`, a copy of the editor's `extent`), and the layer keeps the z-index and the group's opacity, which `.studio-hidden` couldn't beat. The box is axis-aligned, so a group's motion doesn't turn with the group's editor-only rotation.
- An element's `rotation` is an inline `transform` on its node, so its motion (on `.studio-body`) turns with it; its flips come after it, so it mirrors along its own sides, then turns.
- `studioView(overlay, deps)` (`src/common/util/studio.ts`) resolves every element into one stage layer per group or standalone element, and leaves hidden ones out; a `z` counts hidden ones too, so hiding one doesn't renumber the rest. Main (`src/main/helper/studio.ts`) and the editor call it with their own `deps`, so the page never fills text or matches triggers.
- In the editor, `slots: true` makes each embed an empty, stable `.studio-slot` that React portals its preview into, and `editing: true` keeps the elements and groups that wait for an event on screen (`.studio-waits`, on a group's wrapper too).
- A cropped or rounded picture is laid out by the stage from its own size (`layoutPicture`), since Chromium 103 has no `object-view-box`, and clipped with `clip-path: inset(… round …)`. It's hidden until its size is read, so it never shows uncut, and laid out again on `load` or `loadedmetadata` (a sent gift, a new file), and a camera's on `resize` too. A viewer's crop covers its circle instead (`layoutAvatar`).
- Shapes other than a rectangle or an ellipse draw as `svg.studio-figure`, one path from `shapePath` in px of the box, so nothing scales its stroke; the editor's thumbnails draw it the same way. A star's inner corners sit at Figma's ratio (`STAR_RATIO`).
- Their border is a stroke at twice the width, cut to the inside by `clip-path: path()` with the same path: a border inside the edge for any shape, convex or not, with no ids to keep unique.

## Video and sound

- A video plays the part its element cuts (`start`, `end`), timed by its own clock as `alert.html` times an alert's: a timeout wakes at the part's end and arms again while the clock lags.
  - With `loop` it plays again from the part's start; an uncut one keeps the browser's seamless `loop`.
  - Without, it plays once and stops (`done`) (the user's call). On stream, an element that showed on an event leaves then: its Seconds hide it only if it isn't playing, as the alert page's duration does. One that moves on an event plays its part again on each.
  - Every view runs `playback`, which leaves a `done` video where it stopped and never plays an `ended` one (`play()` would start it at 0). An `ended` that comes after a react sought back is dropped.
  - A changed source, cut or loop starts it over, and so does a new player (an image, then Undo).
- It plays its sound on stream at its own `volume` (the user's call). A browser that refuses sound (a tab before a click; OBS doesn't) rejects `play()` with `NotAllowedError`: the stage then plays it muted, and later ones start muted (`quiet`: the policy is the page's) until a `click` unmutes them. Not a press: it isn't a user activation for touch, and Chromium pauses a video unmuted without one.
- The editor's stage starts `silent` until `Stage.sound(on)`. The app's `autoplay-policy` switch (`src/main/index.ts`) lets it play sound with no click.

## Data

- An overlay's `items` go back to front: groups (`StudioGroupSchema`, `kind: "group"`) and standalone elements. A group's `elements` go back to front too, and groups don't hold groups. Ids are unique across groups and elements both.
- A group orders, names, locks, hides and folds its elements and moves them as one. It reacts as one too, with the same reaction fields as an element (`REACTION`), while its elements keep their own When inside it (the user's call). Its `rotation`, `flip_x` and `flip_y` are its frame's in the editor; its elements keep the result of moving, scaling, turning and mirroring it. Its `opacity` is its layer's, on stream too.
- The loop is `idle`, not `loop`, which a media element's video has. Exits pick from the entrances' list (`STUDIO_ENTRANCES`), whose `slide` slides up, as older files saved it.
- An element (`StudioElementSchema`) is one of the eight kinds. Its name is `label` (`""` for what it shows; not `name`, which is a media element's file name): elements take names of their own, like groups (the user's call). `rotation` is degrees clockwise, -180 to 180. It locks and hides like a group (the user's call), and is locked or hidden when it or its group is.
- `StudioOverlaySchema` (`src/common/schemas/studio.ts`) is the strict schema, for IPC and the store's mutators. It validates without transforming (no trims, clamps, rounding or `.catch`): `useAutosave` settles a save only when main's echo deep-equals what it sent. For the same reason the editor builds only schema-shaped objects, since Zod drops unknown keys.
- `StoredStudioOverlaysSchema`, for `settings.studio` (`.default([])`), drops an element, then a group, then an overlay that doesn't parse (a newer Tokio's kind after a downgrade, a hand edit) instead of failing the store, which would reset every setting. Guides it can't read are dropped (`.catch`), not the overlay, and a group's reaction field it can't read takes its default (`orDefault`), so a newer Tokio's animation doesn't drop the group's elements. An overlay saved before groups, with `layers`, loads with each layer as a group (`withItems`).
- A picture element (`StudioPictureKind`: media, camera, gift, emote, viewer) has `crop` (the fractions cut from each side, which can't meet) and `rounding` (a % of the shorter side of what shows: 50 is round), a viewer's 50 by default, a circle. Every picture kind crops and rounds up to a circle (the user's call). Its view's `crop` is null when it keeps all of the picture.
- A shape is a rectangle (the default, and for older files), an ellipse, a polygon, a star, an arrow, a heart or a speech bubble (`STUDIO_SHAPES`, the user's picks), each filling its box. A polygon's `sides` and a star's `points` go 3 to `STUDIO_MAX_CORNERS` (12, the user's call); each shape keeps its own count, so switching back finds it. `radius` is a rectangle's and a bubble's. Fill and border are each on or off, the border inside the edge (the user's call); the view's `color` is null without a fill and `border` null without one.
- A media element has its video's cut (spreads the alerts' `CUT`), `loop` (on by default) and `volume`; an image ignores them. Another file (`setMedia`) starts uncut and keeps its volume and loop, as alerts do.
- An overlay also saves the editor's `rulers` (off for a new one) and `guides`. The stream never gets either.
- The caps (`STUDIO_MAX_ELEMENTS`, `STUDIO_MAX_GROUPS` and the rest) stay tight: each autosave rewrites and flushes the whole `tokio.json`.
- A media element saves a library basename; the only URL an element saves is an emote's `image`, kept to `https:`.
- The list page picks the id (`crypto.randomUUID()`) and the name (`newOverlayName`), and opens a new overlay only once the `STUDIO` list holds it, so a failed add opens nothing. `addStudioOverlay` refuses an id that isn't a UUID or is taken, since it becomes the URL and the socket id; `saveStudioOverlay` and `removeStudioOverlay` refuse one they don't hold, and the handler then replies `STUDIO` with the list and warns `main.studio.missing`.
- Every handler in `src/main/events/pages/studio.ts` replies `STUDIO` with the list main holds, failures included.

## Reactions

- Each element and group reacts on its own: its `when` is `always`, `event` (hidden until its trigger, then `seconds` with its `entrance`, then its `exit`), `animate` (always on screen, plays its `animation` on each trigger) or `loop` (always on screen, plays its `idle` forever, with no trigger). `reactsToEvents` is the one check for a trigger, so a loop never counts as reacting.
- `StudioService.handle` runs `streakOf` once per event, then `matchesTrigger` per reacting group and element, as alerts do (see `.claude/rules/alerts.md`), each group just before its elements. A group's react carries only its id (`StudioReact.element` names either) and keeps nothing.
- On Like an element reacts each time the likes from every viewer pass another `likes_every`, the rest carried over, at most once per event, counted per element, as game actions count them (the user's call). So a Like offers no viewer or count variables (`countedVariables`, the user's call).
- A viewer's picture offers only the triggers a viewer sends (not Envelope, Super Fan Box or Music change) and the event Whens (the user's call).
- A gift or emote element shows one picked (an emote from the saved ones) or, with none (`gift: null`, `emote: null`, a new one's default), what its event sent; that choice offers only the Gift or Emote trigger and the event Whens, and sets both (the user's call). `sentPicture` reads the gift's `image`, or the emote its trigger names (else the first), for the react and, kept, for the view (`sent` in `StudioViewDeps`). Emote samples (`generateEmoteChatSample`) always hold an emote.
- It keeps each element's last event values and viewer until Tokio quits, so a reloaded page shows them. `kept(element)` returns them only while the element's trigger type is the one they came from. Before the first event, the trigger's variables read `""`.
- Hidden elements, and those of a hidden group, still react and keep their values: their page ignores reacts for elements it doesn't draw, and they have the latest event when they show again.
- `clear()` on `DISCONNECTED` drops the gift streaks and like counts, not the kept values.
- Another react while an element shows restarts its entrance and its `seconds` with the newest values, and an `animate` element's animation from the start (the user's call). One during its exit enters again.
- **The stage's motion** runs on movers, an element's `.studio-body` or a group's `.studio-group`, each with its own timer:
  - An exit plays for `EXIT_MS`, every `studio-exit-*`'s length in `overlay.css` (they change together), held by its forwards fill until the timer hides the mover and pauses the videos under it (`hidden` checks the group's wrapper too). `.studio-hidden` has no transition: the fade-out is the `fade` exit.
  - Views come on every autosave and numbers push, so a view leaves a mover alone mid-exit or mid-loop, and a loop's class is added only when it's missing, never restarted. Only a new When resets a mover, with no class left behind.
  - A video without loop keeps an element on screen past its seconds, not a group. On stream, a group that hides it meanwhile sends it back to waiting (`playback`), or the group's next event would bring it back too. `enter` sets a mover's timer before its videos play, so a shown mover with no timer is only ever one its video holds.
  - Keyframes take their class's name, since spin and flip are in several lists. Only `transform` moves things: Chromium 103 has no `translate`, `rotate` or `scale` properties and no `animation-composition`, so a group's motion and its elements' combine only because they're on different nodes.
  - In the editor, a react plays the entrance, the seconds and the exit, and the mover comes back as it waits; loops play.
- Test plays every reacting element and group once, elements with samples, on the editor's stage (fresh `Samples`) and on stream too (`TEST_STUDIO_OVERLAY`, `StudioService.test`), like the Overlays page's and the games overlay's (the user's call). Each element keeps its sample (`_tests`) for its seconds and a second for its exit, or until a real event reacts it (the user's call): views come on every numbers push, which would show the real last event at once. After that a reload shows the real last event.

## Live numbers

- `{likes}`, `{viewers}`, `{followers}`, `{shares}`, `{coins}` in any text, compact in the app's language (`formatStat`). `fillStudioText` fills them first (names checked with `Object.hasOwn`), then the trigger's values in one `formatAlertMessage` pass, so a viewer's comment that says `{likes}` stays as typed.
- `registerStudio` (`src/main/events/init.ts`) is registered after `registerConnectorEvents`: the connector runs listeners in order, synchronously, so the stats and the LIVE session already hold the event when the studio reads them.
- One listener per trigger serves both the reacts and the numbers (GIFT and CHAT have many listeners already; Node warns past 10). Emote triggers are matched on chat; `MUSIC_CHANGE` comes from `music.onSongChange`, once per song as alerts take it.
- On `LIKE`, `ROOM_USER`, the `ACTIVITY_EVENTS` and `CONNECTED`, a throttle (`STATS_THROTTLE_MS`) re-sends the views of the overlays whose texts use a number (`showsNumbers`), built when it fires. `DISCONNECTED` cancels it, so a late push can't show the LIVE's numbers over the zeros, and sends them at once.
- The editor shows `SAMPLE_NUMBERS`, never the LIVE's (`liveNumbers`).
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

## Cameras

- A camera element shows a camera on this PC, each element its own (`camera`, `{ id, label }` or null for the default camera), at `quality` 720p or 1080p. A Studio element instead of a webcam overlay or page, the camera per element, the quality setting, a secret in the URL and hardware video are the user's calls; a camera alone is a studio overlay with one Camera element.
- The main window captures (`useCameraCapture` in `router/Layout`, `helper/camera.ts`): OBS's browser source refuses `getUserMedia` without `--enable-media-stream`, and a page opened from another computer isn't a secure context. `MediaStreamTrackProcessor` doesn't wait for paint, so it keeps going with the window in the tray, which `requestVideoFrameCallback` wouldn't.
- It matches a saved camera by id, then by name: ids are per origin, so `yarn dev` and the packaged app list different ones.
- It encodes with WebCodecs' `VideoEncoder`: H.264 on the GPU when it can, else in software, with a keyframe every 2 s. A GPU can take a config and then fail to start it (OBS holding its encoder sessions): a frame size whose hardware encoder fails before its first chunk encodes in software until Tokio quits (`noHardware`, with no notice: the user's call), while one that fails later gets the GPU again. On the user's laptop at 720p30, JPEG frames cost Tokio about 45% of a core and 220 KB each; H.264 about 17% and 16 KB. Chunks go to main (`CAMERA_FRAME`, each keyframe with its `CameraConfig`), which muxes them into fragmented MP4 (`services/server/mp4.ts`) and streams them (`CameraFeeds`, `services/server/camera.ts`). Not WebRTC: signaling, ICE and an encoder per page, under the app's `webrtc-ip-handling-policy`.
- Pages play it through MediaSource (`playCamera` in `stage.ts`), never WebCodecs: `VideoDecoder` exists only in secure contexts, and an overlay at `tokio-app.local` or a LAN address isn't one (`localhost` is). So it's H.264 only, which MP4 carries: the encoder gives length-prefixed NAL units (`avc` format), an MP4 sample as is, and its description (the avcC) with its first keyframe. Its H.264 carries no colors, and Chromium takes HD video without them for BT.709, so main writes the color space the encoder reports into the init segment (`colr`): without it a camera's BT.601 greens play darker.
- The stream is `video/mp4; codecs="…"`, its headers held until the feed has a config: the init segment, then one fragment per chunk. A page appends it in sequence mode, trims behind it (MediaSource's quota fills in minutes), and opens again 2 s after it ends.
- A page decodes only from a keyframe. One that connects gets the init segment at once and waits for the next keyframe, which main asks the window for (`CAMERA_KEYFRAME`, once until it comes) and gets about a frame later. Not the fragments since the last keyframe: the page would play them from there, up to 2 s behind, and stay that late. A page that can't keep up gets nothing until the next keyframe: a missed delta breaks every frame up to it. A changed config ends the streams that got the old init segment, and their pages open again.
- A page stays near its stream's end: past 0.15 s behind it plays at 1.5× until it's within 0.07 s, and past 1 s it skips ahead. A skip decodes from the last keyframe, so it lands later, and the page doesn't skip again while it decodes, which a slow PC could keep starting over. Frames that come in a burst would leave it late for good: a new capture's first ones do, as the GPU encoder starts (about 0.5 s of them), and so does a busy main process. A steady 30 fps stays under 0.15 s: speeding up there tripled the frames dropped at 1080p. On the user's laptop a page plays 35 to 50 ms behind Tokio's window at 720p, 65 to 100 at 1080p.
- The editor never plays the stream: the stage takes its `camera` option (`previewCamera`), which shows the camera from the window's own capture, so the editor alone encodes nothing and shows the camera without the overlay server. Its src only names the camera and its quality.
- The stream's URL (`studioCameraPath`) carries `ServerService.cameraKey`, new on every `start()`, never saved or logged: the server is open to the whole network, and only pages main sent a view know the key. The new key on a restart also changes every camera's src, so pages that reconnect start a new stream. `stop()` ends the streams, which `server.close()` leaves running.
- One feed per camera (device and name), whose id names its frames, at the highest quality its pages ask for. A camera no page shows stops `CAMERA_LINGER_MS` after its last page closed, so an OBS source reloading doesn't turn it off and on. A hidden element is left out of the view and the stage stops its player, so hiding it turns its camera off too.
- After a camera's first use, Tokio stays about 100 MB over idle until it quits, which is kept (the user's call, with a note on the website). Chromium's video capture process stays alive: 55 MB with the user's camera, 6 with the test camera. The GPU process keeps about 46 MB of the hardware encoder's memory. The next camera reuses both, so neither grows. A GC or a reload of the window frees neither, and Edge keeps its capture process the same way, even after its tab closes. Ending that process from main was offered and declined.
- A capture that fails (`CAMERA_FAILED`) warns once per camera per `REPEAT_NOTICE_MS`, logged only when the notice goes out, and the window tries again every 5 s.
- On macOS, main asks for camera access (`askForMediaAccess`) the first time a capture is wanted while it's `not-determined`, without waiting: the window retries. Electron's Info.plist has `NSCameraUsageDescription`, and the mac build isn't hardened.
- Check a change in the real app with Chromium's test camera: `drive-app`'s `--fake-camera`, as `e2e/` launches. A dark or covered camera sends about 10 fps; for a steady 30 fps with camera-like detail, launch with `--use-file-for-fake-video-capture=<a .y4m>` too. To measure the delay, draw each frame's number in the .y4m and read it with `requestVideoFrameCallback` on the page and on a video of the same camera in the window.

## Media sweep

- `REMOVE_MEDIA` (`pages/alerts.ts`) clears the file from every studio media element, grouped or not (`removeFromStudio`: the element stays, empty), before deleting it, re-sends the views, and keeps the file with `saveFailure()` when the store can't be written. The editor's half is in `.claude/rules/studio-editor.md`.
