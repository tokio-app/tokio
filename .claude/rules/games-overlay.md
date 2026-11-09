---
paths:
  - "src/main/services/server/games*"
  - "src/common/games/overlay.css"
  - "src/common/games/sprites.ts"
  - "src/common/util/games*"
  - "src/main/helper/games.ts"
  - "src/renderer/src/pages/Games/sections/Overlay*"
  - "src/renderer/src/pages/Games/PicturePicker*"
---

# Games overlay and Minecraft pictures

Builds on `.claude/rules/games.md`. The **Overlay** section builds the games overlay: each shown action is a row with the event's pictures or text, a pixel arrow, then the picture and name the streamer picked.

- It's served at `MINECRAFT_OVERLAY_PATH` (`NOTE: DO NOT CHANGE`: OBS links use it): `/games/minecraft/` shows every column, `/games/minecraft/<column>/` one (`getMinecraftOverlayURL(column?)`).
- Every page connects with the id `GAMES_PATH` (`"games"`). Later games get their own `/games/<game>/`.

## Saved data

- Per action in `GameActionSchema.overlay` (`image` a `{ name, file }` from the library or `null`; `""` texts are automatic), the look in `Profile.games.overlay`. All have defaults, so older profiles load.

## Rows

`gameOverlayRows(games, { gifts, emotes, mediaURL, language })` (`src/common/util/games.ts`) is shared by main and the preview. Its automatic texts are in the app's language; mob and item names stay English.

- An action shows when it's enabled, `show` is on, and it has a picture or a name.
- Event pictures are every picture of the trigger's gifts (`gameEventPictures`; TikTok's entry wins over a custom one) or emotes, each once. A gift or emote trigger with none picked has none.
- Follow, Share, Like, Chat and Super Fan get Tokio's own pixel art (`EVENT_SPRITES`, `src/common/games/sprites.ts`), never TikTok's artwork, over pictures the streamer picks (the user's call). Super Fan's crown was the user's pick over a star.
- An event with pictures shows only them, and the builder's row has no event text field; the page keeps the text, hidden, for when every picture fails.
- Several pictures crossfade every `ROTATE_MS`. In one at a time, a row's gifts start from the first as its turn begins, which lasts `max(TURN_MS, gifts × ROTATE_MS)` so each shows (the page's `turnMs`, the preview's `usePictureTurn(currentId)`).
- **Chat** has `withText`: its side never gets `has-picture` and its message shows by its bubble, with **Pictures only** too. Its text is the `event` override, else the keyword quoted, else none (no empty span). Its builder row keeps the event text field.
- Likes show `gameEventCount` (when `likes_every` is over 1) on the heart's corner, with the same `games-count` as the Minecraft side.
- Texts are the `event` and `name` overrides, else `gameEventText` and `gameStepsText` (in the action's edition).
- With a picture, the first mob's or item's amount (`gameCount`) goes on its corner like a stack and leaves the automatic name; without one it stays in the name.
- A timed morph before any mob or item counts too: its seconds go on the picture's corner and never in the name, so without a picture they don't show (the user's call). In Sticker they sit top right, since bottom right runs under the sticker (`games-timed` on the `li`, the user's call); amounts stay bottom right.
- Rows carry both texts. **Pictures only** is the look's job: it hides a text next to a picture, and a side without a picture keeps its text.

## Page and pushes

- `ServerService` serves `/games/minecraft{/:column}` like `/timer/`, a column only when it's digits, so the pictures' folder passes on. Archivo (`__ARCHIVO__`) and the stylesheet (`__STYLES__`) are inlined.
- A picture that fails to load is hidden. `--fit` shrinks it until all rows fit; it keeps only its column's rows.
- `sendGamesOverlay(services)` (`src/main/helper/games.ts`) sends `tokio:games` `{ look, rows }` to `GAMES_PATH` clients from the active profile and the gift lists. It logs a failure and never throws, so it can't fail the change that called it.
- Send it when a games page connects and after anything that changes the rows: the active profile's games, the TikTok or custom gifts, its emotes, the pictures library, the active profile, the language. Never after a failed save.
- `sendGamesRun(services, id)` sends `tokio:games:run` `{ id }`, which lights the row for `LIT_MS` after its last run, so a burst glows steadily. `GamesService.onRun` (one listener) fires in `_pump` once per run, never for **Test** or an offline drop. `TEST_GAMES_OVERLAY { id }` (`notify: false`) sends it from the section's Test.
- One at a time jumps to the lit row and holds it, unless the row it shows is still lit: otherwise two actions on one gift would flip every run. The preview keeps its row by id (`shownId`), the first when it's gone.

## Stylesheet

- `src/common/games/overlay.css` is the one look: the page inlines it, `OverlayPreview` imports it as a plain stylesheet, so the page's markup and the preview's must stay in step.
- Without `:has()`, the page's script and the preview set classes like `has-picture` and `has-result-picture`.
- Pictures float over the game with a halo along their shape, no box behind, gifts and Minecraft pictures alike (the user's call: no black backgrounds).
- A lit row's texts take the accent, its pictures glow and flash. Under `prefers-reduced-motion` only the flash stops.
- A Minecraft picture drawn at twice its size or more gets `games-pixelated` from `sharpen`, on load and each fit, in page and preview. Gifts and smaller scales stay smooth, since Chromium's `pixelated` is nearest-neighbor when shrinking too.
- **Sticker** (`games-sticker`, the user's reference) drops the arrow: the event's picture sits on the action picture's bottom left corner. Its rows are each a grid, the sides `display: contents`, so rules for the other formats use `:not(.games-sticker)`.
  - The action's picture sits in a square that holds the overhang, so `fit` counts it. Without that picture (no `has-result-picture`, cleared too when it fails) the event's takes its place.
  - Its row has a fixed height and `minmax(0, 1fr)` rows around the texts: with plain `1fr`, Chromium sized them from the pictures and the texts landed off center.
  - With **Text below pictures** it centers everything down a column wide enough to count the overhang. One at a time stacks the rows in one cell and fades them.
- Arrow with **Text below pictures** makes each side a grid, its text under its picture, `justify-items` toward the arrow so a long name doesn't push its picture away. A text with no picture beside it (`:last-child` on the event's side, `:first-child` on the result's, from the markup's order) stays on the pictures' line, and everything aligns to the top so the arrows stay there.
- `layout: "horizontal"` (`games-horizontal`) is a strip like a hotbar, with a wider gap between rows than inside one. With **Text below pictures** rows align to the top. It's a `layout`, so it can't be on with one at a time.
- **Event pictures** sizes the gifts, emotes and sprites, not the action's picture (`--games-event-scale`). Every size that follows from it is a `calc` of it, so a larger sticker hangs further off and the row grows. The variables hold `em`s, so every element using them has the overlay's font size.
- **Counts** (`count_size`) scales both `games-count`s by `--games-count-scale`, offsets in their own `em`s so they keep to the corner. `fit` measures `.games`, not the overhang, so Medium and Large pad `.games`; Small has none, so older profiles look the same.

## Builder

- Dragging a row (or ArrowUp and ArrowDown on its grip) moves its action in `games.actions`, the one order of the overlay and the Actions list. A row changes column only through its picker (the user's call). Its focus after a keyboard move: see `.claude/rules/renderer.md`.
- Horizontal calls columns rows, but the saved `columns` and `column` and the URLs stay the same: column 2 becomes row 2.
- `OverlayPreview` writes `--fit` in a layout effect, so measuring doesn't render again. `bare` draws only the overlay, for Overlay Studio's editor, which scales it.
- Horizontal stacks the preview's rows (`preview_rows`) above the builder's, so a strip previews near its size on stream.

## Minecraft pictures library

- Only for Minecraft, shared by all profiles: `settings.minecraftPictures` (`{ name, file }[]`), files in `Folders.minecraftFolder` (`~/.tokio/games/minecraft`; later games get folders beside it), named by a hash of their content. `IMAGE_EXTENSIONS` up to `MEDIA_MAX_BYTES`.
- A rebuilt store recovers the folder with `_findFiles`, named from the actions' `image`s, else "Recovered picture N".
- Imports go through `importFile` (`src/main/helper/library.ts`, shared with `AlertsService`).
- The overlay server mounts the folder at `MINECRAFT_PICTURES_PATH` (`/games/minecraft/pictures/`). The windows load `tokio-media:///games/minecraft/<file>` (`getPicturePreviewURL`); `mediaFile` serves only images right in that folder.
- `IMPORT_MINECRAFT_PICTURE { id, request }` adds every picked file (one bad file doesn't stop the others) and replies `SET_MINECRAFT_PICTURE { id, request, picture }` with the first, for that action (failures echo `request`), and `MINECRAFT_PICTURES`. When the library can't be saved, `MINECRAFT_PICTURES` (what main holds) goes before the failure; the picker shows the failure itself.
- `REMOVE_MINECRAFT_PICTURE { file }` takes it out of the library, then off every action in every profile (`removeFromGames`), pushes `MINECRAFT_PICTURE_REMOVED { file }` and the overlay, then deletes the file. A profile that can't be saved keeps the file and fails with `saveFailure()`.
- `PicturePicker` is the shared `LibraryPicker` with `stays` (it stays open after a pick) and `DeletePictureModal`. Browses are numbered as in "Request numbering" in `.claude/rules/alerts.md`.
- `MINECRAFT_PICTURE_REMOVED` clears the picture from the actions the page shows, so the next save doesn't bring it back.
