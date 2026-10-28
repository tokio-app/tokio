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

Builds on `.claude/rules/games.md` (actions, steps, editions).

The **Overlay** section on the Games page builds the games overlay: each shown action is a row with the event (its gifts' or emotes' pictures, Tokio's sprite, or text like "Any gift"), a pixel arrow, then the picture and name the streamer picked.

- It's served at `MINECRAFT_OVERLAY_PATH` (`NOTE: DO NOT CHANGE`: OBS links use it): `/games/minecraft/` shows every column, `/games/minecraft/<column>/` one (`getMinecraftOverlayURL(column?)`).
- Every page connects with the id `GAMES_PATH` (`"games"`). Later games get their own `/games/<game>/`.
- `CatalogOverlaySchema` refuses the id `games`, like `alerts` and `timer` (see `.claude/rules/overlays.md`).

## Saved data

- Per action in `GameActionSchema.overlay` (`image` is a `{ name, file }` from the Minecraft library, or `null`; `""` texts are automatic), the look in `Profile.games.overlay`.
- All have defaults, so older profiles load. They save with the actions through `useEditableSettings("games")`.

## Rows

`gameOverlayRows(games, { gifts, emotes, mediaURL, language })` (`src/common/util/games.ts`) is shared by main and the preview, like `timerTriggers`. Its automatic texts are in the app's language (main passes `language()`, and sends the overlay again on a change); mob and item names stay English.

- **Shown:** an action shows when it's enabled, `show` is on, and it has a picture or a name. Rows keep the actions' order.
- **Event pictures:** every picture of the trigger's gifts (`gameEventPictures`; the gift lists are TikTok's then the custom ones, so TikTok's entry wins) or emotes (`Profile.emotes`), each once. A gift or emote trigger with none picked has no picture.
- **Sprites:** Follow, Share, Like, Chat and Super Fan get Tokio's own pixel art (`EVENT_SPRITES`, `src/common/games/sprites.ts`), drawn as SVG `data:` URLs with `crispEdges`. They're ours, never TikTok's artwork, and the user's pick over pictures the streamer chooses. Super Fan's crown (gold with rose gems) was the user's pick over a star.
- An event with pictures shows only them: on the page, in the preview and in the builder's row, which then has no event text field. The page keeps the text, hidden, for when every picture fails to load.
- Several pictures take turns in one place, crossfading every `ROTATE_MS`: the page turns every slot on one timer, the preview and the builder's rows use `usePictureTurn`.
- In one at a time, a row's gifts start from the first as its turn begins, and its turn lasts until each has shown: `max(TURN_MS, gifts × ROTATE_MS)` (the page's `rotate` and `turnMs`, the preview's `usePictureTurn(currentId)`).
- **Chat** is the exception: its row has `withText`, so its side never gets `has-picture` and its message shows by its bubble, with **Pictures only** too. Its text is the `event` override, else the keyword quoted, else none (no empty text span). Its builder row keeps the event text field.
- **Likes:** `eventCount` (`gameEventCount`, when `likes_every` is over 1) shows on the heart's corner with the same `games-count` as the Minecraft side.
- **Texts:** the `event` and `name` overrides, else `gameEventText` and `gameStepsText` (named by the action's edition). The builder shows the automatic ones as placeholders; the event text names the pictures for screen readers there.
- **Picture:** `mediaURL(file)`: main passes `MINECRAFT_PICTURES_PATH` plus the encoded file, the preview `getPicturePreviewURL`.
- **Count:** with a picture, the amount of the first mob or item (`gameCount`) shows on the picture's corner (`games-count`, like an inventory's stack), and the automatic name leaves it out (`gameStepsText(action, true)`). Without a picture it stays in the name.
- Rows carry both texts. **Pictures only** is the look's job: it hides a text next to a picture, and a side without a picture keeps its text.

## Page

- `ServerService` serves it from memory at `/games/minecraft{/:column}` like `/timer/`, a column only when it's digits (anything else, like the pictures' folder, passes on): `games.html?raw` with Archivo (`__ARCHIVO__`) and the shared stylesheet (`__STYLES__`) inlined.
- It opens a raw WebSocket with `?id=games`, reconnecting after 2 s, and ignores the live events every client gets.
- Text goes in with `textContent`, the font with `JSON.stringify`, colors as CSS variables (the schema keeps them hex). A picture that fails to load is hidden.
- `--fit` shrinks it until all rows fit. It reads its column from its path and keeps only that column's rows.

## Pushes

In `src/main/helper/games.ts`:

- `sendGamesOverlay(services)` sends `tokio:games` `{ look, rows }` to `GAMES_PATH` clients, from the active profile, `overlayService.getGifts()` and `getCustomGifts()`. It logs a failure and never throws, so it can't fail the change that called it.
- It runs when a games page connects (`serverService.onConnect` in `registerGames`), after `refreshGifts` at startup, after `recordGift` saved a custom gift, after `UPDATE_GAMES_SETTINGS` saved (none after a failed save), after `SET_PROFILE` and after `REMOVE_MINECRAFT_PICTURE`.
- `sendGamesRun(services, id)` sends `tokio:games:run` `{ id }`, which lights the row for `LIT_MS` after its last run, so a burst glows steadily.
- One at a time jumps to the lit row and holds it, unless the row it shows is still lit: otherwise two actions on one gift would flip between their rows every run. The preview does the same, and keeps the row it shows by id (`shownId`), so it stays on it when the rows change, the first when it's gone.
- `GamesService.onRun(listener)` (one listener, set in `registerGames`) is called in `_pump` right before each run's `_send`: once per run, never for an action's **Test** or an offline drop.
- `TEST_GAMES_OVERLAY { id }` (`notify: false`) sends the same run message from the section's Test, which lights the next shown row in the preview and on stream.

## Stylesheet

- `src/common/games/overlay.css` is the overlay's one look. `ServerService` imports it raw (`?raw`) into the page; `OverlayPreview` imports it as a plain stylesheet, the only one the renderer loads that way.
- It loads globally, so every class starts with `games-`. The page's markup and the preview's (`sections/OverlayPreview.tsx`) must stay in step.
- It has to work in OBS 30's Chromium 103: no `:has()`, nesting, subgrid or container queries. The page's script sets classes like `has-picture` instead.
- Pictures float over the game with a halo that follows their shape, with no box behind them, gifts and Minecraft pictures alike (the user's call: no black backgrounds).
- A lit row's texts take the accent and its pictures glow along their shape and flash. Under `prefers-reduced-motion` only the flash stops.
- A Minecraft picture drawn at twice its size or more (a 16×16 icon) gets `games-pixelated` from `sharpen`, on load and on each fit, in the page and the preview alike. Gifts and smaller scales stay smooth, since Chromium's `pixelated` is nearest-neighbor when shrinking too.

### Formats

- **Arrow** is the spine above. **Sticker** (`games-sticker`, the user's reference: the gift stuck on the item's corner) drops the arrow: the event's picture sits on the bottom left corner of the action's, over it.
- Sticker's rows are each their own grid, their sides `display: contents`. The action's picture sits in a square that holds the sticker's overhang, so `fit` counts it.
- Without the action's picture the event's takes its place: the row lacks `has-result-picture`, which the page and the preview set, and the page clears when that picture fails.
- Sticker's row has a fixed height and `minmax(0, 1fr)` rows around the texts: with a plain `1fr`, Chromium sized those rows from the pictures across them and the texts landed off center.
- Sticker with **Text below pictures** (`games-text-below`) centers everything on one line down the column, in a column wide enough that the overhang counts when fitting. One at a time stacks the row boxes in one cell and fades them.
- Arrow with **Text below pictures** makes each side a grid, its picture on a line and its text under it, with `justify-items` toward the arrow so a long name doesn't push its picture away.
- There, a text with no picture beside it (`:last-child` on the event's side, `:first-child` on the result's, from the markup's order) stays on the pictures' line, and the sides and the arrow align to the top so the arrows stay on that line.
- Those rules use `:not(.games-sticker)`, as Sticker's sides are `display: contents`.

### Event picture sizes

- **Event pictures** sizes the gifts, emotes and Tokio's sprites, not the action's picture: `games-event-medium` or `games-event-large` (Small has none) set `--games-event-scale`.
- Every size that follows from the event's picture is a `calc` of it (`--games-line`, `--games-sticker`, `--games-overhang`, `--games-square`, Arrow's slot), so a larger sticker hangs further off and the row grows with it.
- The variables hold `em`s, which resolve where they're used: every element using them has the overlay's font size.

## Builder

- The rows panel is as wide as its rows need (`.overlay`'s `auto` track). The rows share one grid (each `li` a `subgrid`), so arrows line up while the event column is only as wide as its widest content.
- With more than one column, each row gets a **Column** picker and the section gives one URL per column.
- `OverlayPreview` draws the columns side by side, each shrunk to fit its share as the page fits its source (`--fit`, written to the style in a layout effect, so measuring doesn't render again).

## Minecraft pictures library

- Only for Minecraft, shared by all profiles: `settings.minecraftPictures` (`{ name, file }[]`), files in `Folders.minecraftFolder` (`~/.tokio/games/minecraft`; later games get folders beside `minecraft`), named by a hash of their content.
- Allowed: `IMAGE_EXTENSIONS` (`src/common/util/alerts.ts`) up to `MEDIA_MAX_BYTES`.
- A rebuilt store recovers the folder with `_findFiles`, named from the actions' `image`s, else "Recovered picture N".
- `GamesService` has `setPicturesFolder`, `importPicture` and `deletePicture`. Imports go through `importFile` (`src/main/helper/library.ts`, shared with `AlertsService`).
- **Served:** the overlay server mounts the folder at `/games/minecraft/pictures/` (`MINECRAFT_PICTURES_PATH`, `serverService.mount`, next to `/alerts/media/`). The app's windows load it as `tokio-media:///games/minecraft/<file>` (`getPicturePreviewURL`); `mediaFile` in `helper/preview.ts` serves only images right in that folder.

### Requests

In `src/main/events/pages/games.ts`:

- `GET_MINECRAFT_PICTURES` replies `MINECRAFT_PICTURES`.
- `IMPORT_MINECRAFT_PICTURE { id, request }` opens a dialog for one or more pictures and adds them all (one bad file doesn't stop the others). It replies `SET_MINECRAFT_PICTURE { id, request, picture }` with the first, which goes on that action (failures echo `request` too), and `MINECRAFT_PICTURES`.
- When the library can't be saved, it replies `MINECRAFT_PICTURES` (what main holds) before the failure. Its notices go out in the handler; the picker shows a failure itself.
- `REMOVE_MINECRAFT_PICTURE { file }` takes it out of the library, then off every action in every profile (`removeFromGames`, which shares `_updateProfiles` with `removeFromAlerts`), pushes `MINECRAFT_PICTURE_REMOVED { file }` and the overlay, then deletes the file. A profile that can't be saved keeps the file and fails with `saveFailure()`.

### Picker

- `PicturePicker` imports the media picker's CSS; its Delete is `DeletePictureModal` (`components/DeleteModals`).
- The page numbers each browse (`onRequest` returns it). It applies a `SET_MINECRAFT_PICTURE` reply only to the action that asked (`asked`), and only if it's newer than the last applied for it (`applied`). The picker shows only the newest request's failure.
- `asked` is cleared when another profile loads (`useEditableSettings`'s `switched`), since a clone has the same action ids.
- `MINECRAFT_PICTURE_REMOVED` clears the picture from the actions the page shows, so the next save doesn't bring it back.
