---
paths:
  - "src/main/services/overlay/**"
  - "src/main/helper/preview.ts"
  - "src/common/util/catalog.ts"
  - "src/common/schemas/catalog.ts"
  - "src/common/schemas/overlay.ts"
  - "src/renderer/src/pages/Overlays/**"
  - "src/renderer/src/pages/OfficialOverlays/**"
  - "src/renderer/src/components/Iframe/**"
  - "src/renderer/src/components/OverlayModal/**"
  - "src/renderer/src/components/OverlayPreview/**"
  - "src/renderer/src/components/OverlayView/**"
  - "src/renderer/src/pages/Settings/sections/OverlaysSection.tsx"
  - "src/renderer/src/pages/Settings/sections/ServerSection.tsx"
---

# Overlays

The gifts `OverlayService.recordGift` saves are described in `.claude/rules/alerts.md`.

## Previews

- The Overlays page shows each overlay in an `Iframe` named `TOKIO_APP-<id>`, loaded from disk through `local-resource:` so previews work with the overlay server off. `postToOverlay` posts `TOKIO_PREVIEW` messages to it, which `@tokioapp/overlay` reads instead of opening a WebSocket.
- The settings dialog (`OverlayModal`) posts the unsaved settings to its own preview alone, so the card and the live overlays keep the saved ones until Save. While it's open, Test reaches only the previews (`postToPreviews`), never the stream.
- Test sends every live event at once, as the next moment of a test LIVE (`createTestLive`, `src/common/util/samples`) that `OverlayService` keeps per overlay id, Tools → Test overlays' ids included, until the app quits. The settings' Test carries on the card's.
- Each press ends with sample `tokio:gifters` (the test LIVE's gifters, plus 12 made-up past ones for all time, some of whom come back to it) and `tokio:fans`, so overlays built on them have something to show. Previews and test overlays get them then, not when they load.
- `local-resource:` has no origin, so it's registered with `corsEnabled` and `supportFetchAPI`, and `withPreviewCORS` adds `Access-Control-Allow-Origin: *`. Without them Chromium blocks module scripts, `crossorigin` styles, fonts and `fetch`, and overlays built with Vite never run in previews.
- Overlay code can load any `local-resource:` URL, so the handler serves only files inside the overlays folder (`previewFile`). Don't widen it.
- `getConfig`, `saveConfig` and `remove` refuse an id that isn't stored (`_isStored`), so the renderer's id can't point outside the overlays folder. The check doesn't log; the config handlers and `_remove` do.
- `withPreviewStyles` gives previews the app's background (for ClearType text) and hides scrollbars, as OBS's default CSS does. A URL with `?transparent` (`Iframe`'s `transparent`, for Overlay Studio's editor) keeps its own background; the scrollbar rule stays. The files on disk and what the overlay server sends stay unchanged.

## Files

- An import copies the folder a picked link points to (`realpath`), leaving out every link inside, into `.install-<uuid>` inside the overlays folder. It checks the copy there (`processOverlay`, the setup block, then `processHTML`), then renames it into its UUID folder (`renameWithRetry`).
  - `cp` keeps a read-only mode, which Windows can't rename over, so the copy's `index.html`, `config.yaml` and `config.yml` get the owner's write bit first, and so does the staging folder: copied from a read-only one (a mounted DMG on macOS), it couldn't hold `index.html.tmp`. Its subfolders keep their mode.
  - A failure deletes the staging folder. One a quit leaves behind, `load` deletes.
- A remove first renames the overlay's folder to `.old-<uuid>` (a missing folder counts as gone), so a folder another program holds stays whole and stored. Only then does it stop serving it, forget it and delete `.old-*`, which `load` deletes if that fails.
- `YAMLManagerService` logs to `overlays.log`, so a refused `info.yaml` or `config.yaml` says why there. `processOverlay` reads `info.yaml` itself and parses it with `parseFile`, since `loadFile` takes an empty or comment-only file for a missing one and logs nothing.
- Imports, saves, updates and every start write the settings `config.yaml` holds into the HTML (`processHTML`), only when the HTML changed.
- At each start `load` checks every stored overlay. One that fails isn't served but stays stored, so fixing it keeps its id and OBS link; only an overlay whose folder is missing (`ENOENT`, not a permission error) is forgotten.
- Saving settings writes `config.yaml` first, so settings the schema refuses change nothing, then the HTML with the gifts main keeps; the renderer doesn't send gifts.
- The `SAVE_OVERLAY_CONFIG` handler sends the saved settings (`tokio:config`) to the live overlays itself, so they get them even after the page closed; the page posts them only to its previews. A save reply updates its overlay even after its settings closed, and only closes the dialog still open for it.
- A save merges the dialog's values onto the installed version's fields (`mergeOverlayConfig`), so a dialog opened before an update can't write the old version's fields.
- `OverlayService` runs each overlay's file work (`saveConfig`, `getConfig`, `remove`, `_writeHTML`, an install's extract and swap) one after another through `_lock(id)`, so a gift refresh can't write back settings read before a save.
  - A task holding the lock must not call a method that takes it (`_prepare` uses `_readConfig`), or it waits on itself.
  - An install downloads before taking it. An update whose overlay a Remove took out meanwhile fails rather than put it back with default settings.
- Import, remove, install and Tools → Test overlays keep their change when the store file can't be written (`OverlayResult.saved: false`), and the handler follows Feedback in `AGENTS.md`.

## Settings fields

- `OverlayConfigSchema` (`src/common/schemas/overlay.ts`) holds the field types. `FieldControl` draws a field's control, which a table's cells reuse through `cellField`.
- A `font` field's `""` reads as the overlay's own font: the official overlays use `system-ui`, not Archivo.
- A `table` field's rows are objects of cells keyed by column id. Columns take every type but `table` and `slider`, and `checkTable` refuses a row without exactly one cell of its column's kind per column.
- In `TableField`, removing the last row moves the focus to the previous row's remove button or Add, and adding one to the new row's first control.
- A merge (`mergeOverlayConfig`) keeps a table's rows up to the new `max`. A cell stays when the old table had a column with the same id and type and the value still fits (`fits`); the others take the column's default.

## Another computer

- A streaming app on another computer opens overlays through `tokio-app.local` pointed at this PC's address in that computer's hosts file or a DNS entry (as the website's docs describe), or at the address itself. Tokio's own hosts-file entry (`services/url`) is only for this PC.
- `ServerService` sets Express's `env` to `production` (`NODE_ENV` isn't set), so an error page for a bad URL shows no stack, and no paths with the account's name.
- `processHTML` appends `REMOTE_SOCKET` (`services/overlay/common`) to every setup block. On a page opened on port 37891 from a host other than `localhost`, `127.0.0.1` or `[::1]`, it wraps `WebSocket` so sockets to a loopback host on that port go to `location.host`.
- Previews (`local-resource:`) and pages opened at `localhost` are left alone. A page Tokio doesn't serve gets no setup block, so it must connect to the Tokio PC's address itself.
- **Settings → Overlay server** lists `ServerService.networkAddresses()` (`GET_NETWORK_ADDRESSES`), each the IP alone, what a hosts file or a DNS entry needs.

## Official overlays

- They come from the catalog of `tokio-app/overlays` (see Overlays repo in `AGENTS.md`), listed on **Official overlays** (`/overlays/official`).
- `OverlayService.getCatalog` keeps the catalog for `CATALOG_TTL_MS`, and calls made while it fetches share that one fetch. A failure isn't kept; a failure that comes while a catalog shows is ignored.
- `parseCatalog` (`services/overlay/common/catalog.ts`) drops entries that don't parse (`CatalogOverlaySchema`) or whose zip isn't under `https://github.com/tokio-app/overlays/releases/download/`, and previews from anywhere else. Only fetch that prefix.
- The renderer sends only the id (`INSTALL_OVERLAY`); main looks the entry up in its catalog, so it never downloads a URL from the renderer.
- `installFromCatalog` checks the zip's size and SHA-256 against the catalog and extracts it (`extractZip`, refusing paths outside the folder) into `.install-<uuid>`, then checks it like an import.
- Renaming it into place (`renameWithRetry`, which retries for about a second while Windows antivirus or indexers hold the folder) keeps it on the same drive and the old version whole until the new one is in. A rollback that fails is logged with the `.old-*` folder holding the old version.
- An official overlay's folder, id and URL path are its catalog id (`http://tokio-app.local:37891/gift-jar/`), and it's stored with `external: false`. Imported overlays get a random UUID, which is how `findOverlays` tells them apart when the store is rebuilt.
- Keeping the catalog id over generated ids is the user's call: readable URLs survive removing and reinstalling, so OBS links keep working. A random id adds no security, since the socket accepts any id and every client gets the LIVE events. Don't propose switching.
- `CatalogOverlaySchema` refuses the ids `alerts`, `timer`, `games` and `studio`, Tokio's own paths (`/alerts/`, `/timer/`, `/games/`, `/studio/`).
- A rebuilt store takes back only folders named the way Tokio names them: a UUID, or an id `CatalogOverlaySchema` accepts. Express 5 can't mount a copy like `gift-jar - Copy (2)`.
- `rebuildRoutes` skips, and logs, an id it can't mount, so one an older store still holds doesn't stop the server's start.
- An update keeps the saved settings that still fit the new `config.yaml` (`mergeOverlayConfig`) and replaces the store entry in place. Streaming apps keep the old page until refreshed, as the success notice says. The gallery keys cards by id and version, so previews reload.
