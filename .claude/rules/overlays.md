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
---

# Overlays

The gifts `OverlayService.recordGift` saves are described in `.claude/rules/alerts.md`.

## Previews

- The Overlays page shows each overlay in an `Iframe` named `TOKIO_APP-<id>`, loaded from disk through `local-resource:` so previews work with the overlay server off. `postToOverlay` posts `TOKIO_PREVIEW` messages to it, which `@tokioapp/overlay` reads instead of opening a WebSocket.
- The settings dialog (`OverlayModal`) has its own preview. It posts the unsaved settings (`getOverlayConfig`) to that iframe alone, through a ref, so the card and the live overlays keep the saved ones until Save. While it's open, Test reaches only the previews (`postToPreviews`), never the stream.
- `local-resource:` has no origin, so it's registered with `corsEnabled` and `supportFetchAPI`, and `withPreviewCORS` adds `Access-Control-Allow-Origin: *`. Without them Chromium blocks module scripts, `crossorigin` styles, fonts and `fetch`, and overlays built with Vite never run in previews.
- Overlay code can load any `local-resource:` URL, so the handler serves only files inside the overlays folder (`previewFile`). Don't widen it.
- The `Iframe` ignores the pointer, so previews can't be scrolled or clicked. `withPreviewStyles` appends a style to the page giving it the app's background (for ClearType text) and hiding scrollbars, as OBS's default CSS does. The files on disk and what the overlay server sends stay unchanged.

## Official overlays

- They come from the catalog of `tokio-app/overlays` (see Overlays repo in `AGENTS.md`) and are listed on their own page, **Official Overlays** (`pages/OfficialOverlays`, route `/overlays/official`), opened from the gallery's header.
- `OverlayService.getCatalog` reads the catalog when that page or the Overlays page opens and keeps it for 15 minutes (`CATALOG_TTL_MS`). A failure isn't kept, and Official Overlays shows it with Try again.
- The Overlays page reads the catalog only for the dot on its **Official Overlays** button, shown while an installed official overlay has another version (`countUpdates` in `src/common/util/catalog.ts`, next to `catalogState`, which gives each card Install, Update or Installed).
- `parseCatalog` (`services/overlay/common/catalog.ts`) drops entries that don't parse (`CatalogOverlaySchema`, `src/common/schemas/catalog.ts`) or whose zip isn't under `https://github.com/tokio-app/overlays/releases/download/`, and previews from anywhere else. Only fetch that prefix.
- The renderer sends only the id (`INSTALL_OVERLAY`); main looks the entry up in its catalog, so it never downloads a URL from the renderer.
- `installFromCatalog` downloads the zip, checks its size and SHA-256 against the catalog, and extracts it (`extractZip`, refusing paths outside the folder) into `.install-<uuid>` inside the overlays folder. It's then checked like an import. Renaming it into place keeps it on the same drive and the old version whole until the new one is in. `load` deletes `.install-*` and `.old-*` leftovers.
- An official overlay's folder, id and URL path are its catalog id (`http://tokio-app.local:37891/gift-jar/`), and it's stored with `external: false` (Verified in the gallery). Imported overlays get a random UUID, which is how `findOverlays` tells them apart when the store is rebuilt.
- An update keeps the saved settings that still fit the new `config.yaml` (`mergeOverlayConfig`, `src/common/schemas/overlay.ts`) and replaces the store entry in place. Streaming apps keep the old page until refreshed, as the success notice says. The gallery keys cards by id and version, so previews reload.
- Official overlays are removed from their card on Official Overlays, imported ones in **Settings → Imported Overlays**. Both use `REMOVE_OVERLAY`.
