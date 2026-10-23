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
- The settings dialog (`OverlayModal`) has its own preview. It posts the unsaved settings (`getOverlayConfig`) to that iframe alone, through a ref, so the card and the live overlays keep the saved ones until Save. While it's open, Test reaches only the previews (`postToPreviews`), never the stream.
- Test sends every live event at once, as the next moment of a test LIVE (`createTestLive`, `src/common/util/samples`) that `OverlayService` keeps per overlay id, Tools → Test Overlays' ids included, until the app quits. The settings' Test carries on the card's. Each press carries on from the last: one more viewer joins (up to 8), likes and coins add up, and a gift streak grows over a few presses before it ends, as TikTok sends it.
- `local-resource:` has no origin, so it's registered with `corsEnabled` and `supportFetchAPI`, and `withPreviewCORS` adds `Access-Control-Allow-Origin: *`. Without them Chromium blocks module scripts, `crossorigin` styles, fonts and `fetch`, and overlays built with Vite never run in previews.
- Overlay code can load any `local-resource:` URL, so the handler serves only files inside the overlays folder (`previewFile`). Don't widen it.
- An import copies the folder a picked link points to (`realpath`), leaving out every link inside, then checks the copy (`processOverlay` and the setup block) and removes it if that fails. Like saves, updates and every start, it writes the settings `config.yaml` holds into the HTML.
- At each start `load` checks every stored overlay and writes its settings into its HTML. One that fails isn't served but stays stored, so fixing it keeps its id and OBS link; only an overlay whose folder is gone is forgotten. `processHTML` writes only an HTML that changed, through `writeFileAtomic` (`src/main/helper/fs.ts`), so a crash or full disk midway leaves the old file whole, and a quit waits for it.
- Saving settings writes `config.yaml` first, so settings the schema refuses change nothing, then the HTML with the gifts main keeps; the renderer doesn't send gifts. The `SAVE_OVERLAY_CONFIG` handler sends the saved settings (`tokio:config`) to the live overlays itself, so they get them even after the page closed; the page posts them only to its previews (`postToPreviews`). A save reply updates its overlay even after its settings closed, and only closes the dialog still open for it.
- `OverlayService` runs each overlay's file work (`saveConfig`, `getConfig`, `remove`, `_writeHTML` for gift refreshes and starts, an install's extract and swap) one after another through `_lock(id)`, so a gift refresh can't write back settings read before a save. A task holding the lock must not call a method that takes it (`_prepare` uses `_readConfig`), or it waits on itself. An install downloads before taking it. `writeFileAtomic` also runs writes to one file in the order they came.
- The `Iframe` ignores the pointer, so previews can't be scrolled or clicked. `withPreviewStyles` appends a style to the page giving it the app's background (for ClearType text) and hiding scrollbars, as OBS's default CSS does. The files on disk and what the overlay server sends stay unchanged.

## Another computer

- The server listens on every interface on purpose (see Conventions in `AGENTS.md`), so a streaming app on another computer can open overlays from this PC: through `tokio-app.local` pointed at this PC's address in that computer's hosts file or a DNS entry (as the docs describe), or at the address itself.
- `processHTML` appends `REMOTE_SOCKET` (`services/overlay/common`) to every setup block. On a page opened on port 37891 from a host other than `localhost`, `127.0.0.1` or `[::1]`, it wraps `WebSocket` so sockets to a loopback host on that port go to `location.host`. Previews (`local-resource:`) and pages opened at `localhost` are left alone; a page Tokio doesn't serve gets no setup block, so it must connect to the Tokio PC's address itself.
- **Settings → Overlay Server** (`ServerSection`) lists `ServerService.networkAddresses()` (`GET_NETWORK_ADDRESSES`, `notify: false`, `[]` on failure): non-internal IPv4 without `169.254.*`, leaving out virtual adapters (Hyper-V, WSL, VMs, Docker, bridges) unless there's no other (a Hyper-V switch or a bridge on the network card), each a `CopyField` of the IP alone (what a hosts file or a DNS entry needs), in a `FormGrid` column as wide as the Euler Stream key's field.

## Official overlays

- They come from the catalog of `tokio-app/overlays` (see Overlays repo in `AGENTS.md`) and are listed on their own page, **Official Overlays** (`pages/OfficialOverlays`, route `/overlays/official`), opened from the gallery's header.
- `OverlayService.getCatalog` reads the catalog when that page or the Overlays page opens and keeps it for 15 minutes (`CATALOG_TTL_MS`). A failure isn't kept, and Official Overlays shows it with Try again.
- The Overlays page reads the catalog only for the dot on its **Official Overlays** button, shown while an installed official overlay has another version (`countUpdates` in `src/common/util/catalog.ts`, next to `catalogState`, which gives each card Install, Update or Installed).
- `parseCatalog` (`services/overlay/common/catalog.ts`) drops entries that don't parse (`CatalogOverlaySchema`, `src/common/schemas/catalog.ts`) or whose zip isn't under `https://github.com/tokio-app/overlays/releases/download/`, and previews from anywhere else. Only fetch that prefix.
- The renderer sends only the id (`INSTALL_OVERLAY`); main looks the entry up in its catalog, so it never downloads a URL from the renderer.
- `installFromCatalog` downloads the zip, checks its size and SHA-256 against the catalog, and extracts it (`extractZip`, refusing paths outside the folder) into `.install-<uuid>` inside the overlays folder. It's then checked like an import. Renaming it into place (`renameWithRetry`, which retries for about a second while Windows antivirus or indexers hold the folder) keeps it on the same drive and the old version whole until the new one is in. `load` deletes `.install-*` and `.old-*` leftovers, so a rollback that fails is logged with the `.old-*` folder holding the old version.
- An official overlay's folder, id and URL path are its catalog id (`http://tokio-app.local:37891/gift-jar/`), and it's stored with `external: false` (Verified in the gallery). Imported overlays get a random UUID, which is how `findOverlays` tells them apart when the store is rebuilt.
- `CatalogOverlaySchema` refuses the ids `alerts` and `timer`: `/alerts/` serves each alert's own overlay, and `/timer/` the countdown timer's. Neither is stored or in the gallery (see `.claude/rules/alerts.md` and `.claude/rules/timer.md`).
- An update keeps the saved settings that still fit the new `config.yaml` (`mergeOverlayConfig`, `src/common/schemas/overlay.ts`) and replaces the store entry in place. Streaming apps keep the old page until refreshed, as the success notice says. The gallery keys cards by id and version, so previews reload.
- Official overlays are removed from their card on Official Overlays, imported ones in **Settings → Overlay Library**. Both use `REMOVE_OVERLAY`.
- Import, remove, install and the Tools page's test overlays keep their change when the store file can't be written (`OverlayResult.saved: false`): the handler replies with the list main holds, then throws `saveFailure()`, with no success notice.
