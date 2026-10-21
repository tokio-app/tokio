---
paths:
  - "src/renderer/**"
  - "src/ui/**"
---

# Renderer

## Pages and components

- Each page is a folder `src/renderer/src/pages/<Page>/` with `index.tsx`, `<page>.module.css`, an optional `helper.ts` and `sections/*Section.tsx`. Export it from `pages/index.tsx`, route it in `router/index.tsx` (hash history) and add sidebar links to `NAV_ITEMS` in `router/Layout`. The router's `defaultErrorComponent` keeps a page's render error inside the page, with the title bar and sidebar.
- A page opened from another page instead of the sidebar (Official Overlays) gets a path under its parent's (`/overlays/official`), which keeps the parent's sidebar item active, and a back button in its header (`Section`'s `icon`).
- Build pages from `components/Page` (`Page`, `Section`, `Field`, `FormGrid`, `EmptyState`); a page module only holds page-specific layout.
- Components are folders with `index.tsx` and `<name>.module.css`, re-exported from `components/index.tsx`. Use the primitives in `components/Elements` before creating new ones; they take colors from the tokens, not props. `Modal` is the only modal shell.
- The CSP is `config.CSP` (`src/main/config/csp.ts`, which has no imports so `electron.vite.config.ts` can read it). In dev pages get it as a header from `initSession`; built pages load from `file://`, which headers don't reach, so the `tokio:csp` build plugin adds the production policy as a meta tag. That policy has no `connect-src`: pages can't fetch, and audio reaches `AudioQueue` as bytes over IPC. Anything new the renderer loads must fit it.
- Style with CSS Modules and the tokens in `src/ui/styles/tokens.css` (colors, `--space-*`, `--font-*`, `--radius-*`, `--z-*`), not raw values.

## Keyboard

- Keep controls usable from the keyboard. `Modal` takes the focus while open and gives it back, keeps Tab inside it (wrapping between its first and last controls), and Escape closes the innermost one; popovers inside it (`Select`, `Color`) handle Escape first and stop it. `Color`'s picker is portaled: its text field takes the focus when it opens, and Tab out of it goes back to its swatch. Overlay previews (`Iframe`) are out of the Tab order.
- Don't remove focus outlines: buttons, sliders and the title bar keep the browser's `:focus-visible` ring, and `Toggle` draws one on its track.
- `Select` is a combobox with a listbox. Number fields use `NumberInput`, which can be emptied while typing and reports only valid numbers. It compares values with `Object.is`, so NaN (an overlay number setting saved as text) shows an empty field.
- Something hidden only by CSS also needs `tabIndex={-1}` and `aria-hidden`.

## State, hooks and audio

- Global state is in `context/` (`app`, `audio`, `notifications`); shared hooks are in `hooks/`.
- If `LOAD_APP` fails, `AppProvider` still sends `SHOW_WINDOW`, but shows only the title bar and "Tokio couldn't start" instead of the pages. Toasts still work, since `NotificationsProvider` sits outside it.
- `useImmerState` returns an immer `Updater`; `scopeUpdater(update, key)` hands a section one field.
- `useEditableSettings(section, onLoad?)` loads a profile section (TTS, Music, Alerts) and saves it 300ms after the last change, so quick changes go in one save. A change still waiting is sent when the page closes and dropped when another profile loads, and a failed save reloads the profile. Nothing is saved before a profile has loaded, so the defaults it starts from never reach one.
- Main saves to whichever profile is active, so call `flushSettings()` before switching profiles: it sends the changes still waiting to the profile they were made on.
- Audio plays through named `AudioQueue`s (`helper/audio.ts`) from `useAudio().getQueue(name)`. `onEnded` doesn't run when a queue is stopped, and `maxQueueLength` counts waiting and playing items.
