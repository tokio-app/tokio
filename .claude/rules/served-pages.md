---
paths:
  - "src/main/services/server/**"
  - "src/common/games/overlay.css"
  - "src/common/studio/**"
---

# Served pages

The pages the overlay server serves itself (`src/main/services/server/*.html`): the alerts', the timer's, the games' and Overlay Studio's. Each area's rule has its page's own behavior.

- They run in OBS 30's Chromium 103: no `:has()`, CSS nesting, subgrid, container queries or `color-mix()`, and no JS newer than Chrome 103 (`toSorted`, `Object.groupBy`).
- Main imports them with `?raw` and serves them from memory. A package file imported with `?inline`, like the Archivo font, needs its package in main's `externalizeDeps.exclude` (`electron.vite.config.ts`; `packaging.test.ts` skips query imports). A `?script` import (`inlineScript`, Overlay Studio's `stage.ts`) compiles one file alone to a classic script's text, so that file may import only types.
- A stylesheet a window's preview shares (`src/common/games/overlay.css`, `src/common/studio/overlay.css`) loads there globally, so every class takes its prefix (`games-`, `studio-`).
- Text goes in with `textContent`, a font as one `style.fontFamily = JSON.stringify(name)`, and colors as CSS variables the schema keeps hex, so a name or a setting can't add markup or styles.
- They reconnect after 2 s and ignore the live events every client gets.
