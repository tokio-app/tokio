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
- Components are folders with `index.tsx` and `<name>.module.css`, re-exported from `components/index.tsx`. Use the primitives in `components/Elements` before creating new ones; they take colors from the tokens, not props. `Modal` is the only modal shell; its `actions` sit at the end of the title row, like a `Section`'s. A search in a header is a `SearchToggle`: a button that opens a field beside it and clears it on close.
- Loaders use `Spinner` (`components/Elements`): a CSS ring in the text color (set `color` on its container), announced as a `status` named "Loading". A button showing it is named by it, so a button named only by its `title` also needs an `aria-label`, as `PlayButton` has.
- The CSP is `config.CSP` (`src/main/config/csp.ts`, which has no imports so `electron.vite.config.ts` can read it). In dev pages get it as a header from `initSession`; built pages load from `file://`, which headers don't reach, so the `tokio:csp` build plugin adds the production policy as a meta tag. That policy loads scripts only from `'self'` and has no `connect-src`: pages can't fetch, and audio reaches `AudioQueue` as bytes over IPC. The media library's thumbnails load from `tokio-media:`, which main serves (see `.claude/rules/alerts.md`). Anything new the renderer loads must fit it.
- Style with CSS Modules and the tokens in `src/ui/styles/tokens.css` (colors, `--space-*`, `--font-*`, `--radius-*`, `--z-*`), not raw values.
- To reuse another module's class, import that module in the TSX and add its class, as `GiftSelect` does with `select_display`. Don't use `composes: … from` another file.
  - Vite bundles that file again for every `composes`.
  - A later copy then overrides the page styles that come before it, such as a field's fixed width.
- The look follows the `frontend-design` skill:
  - **Surfaces:** one Ink surface (`--background-primary`). Panels (`--background-tertiary`) only for grouped content such as lists and cards. Controls on Field (`--background-secondary`), with `--border` for hairlines and Iron (`--background-secondary-hover`) for hover.
  - **Rose** (`--accent-primary`) means LIVE or "do this": the tally, primary actions, selection and focus, never decoration. Text on it is Paper (`--font-primary`), and checkboxes and radios keep the browser's light look.
  - **Radii:** `--radius-md` for controls, `--radius-lg` for panels, `--radius-xl` for dialogs.
  - **Never:** shadows on cards, pills, or uppercase labels.
- Type is Archivo (`@fontsource-variable/archivo`, imported by `base.css`), at 400 for text, 500 for labels and controls, 600 for titles.
  - Live numbers (Home's stats and totals) use the readout: `font-stretch: var(--stretch-readout)`, 700, `tabular-nums`.
  - Both builds set `assetsInlineLimit: 0`, because the CSP blocks fonts inlined as `data:` URLs.
- A page of settings uses `<Page width="wide" layout="aside">`.
  - Each section's header sits in a 240px column beside its content.
  - The section's actions go on the title's row, as icon buttons with a `title`: text buttons don't fit there.
  - Descriptions there are a few words, not explanations.
  - `Section` wraps the content in `.section_body`, which is `display: contents` in the stacked layout.
- `TitleBar`'s `live` prop (Layout passes the connection) draws the tally on every page: a rose line at the top's center, fading out to both sides. "LIVE" is said only to screen readers.
- The sidebar shows icons only. Each page's name is a span in its link, shown beside the icon on hover and keyboard focus. Opacity hides it, not `visibility`, so it still names the link. Escape hides it until the pointer or focus moves to another link (WCAG 1.4.13).

## Keyboard

- Keep controls usable from the keyboard. `Modal` takes the focus while open and gives it back, keeps Tab inside it (wrapping between its first and last controls), and Escape closes the innermost one; popovers inside it (`Select`, `Color`) handle Escape first and stop it. `Color`'s picker is portaled: its text field takes the focus when it opens, and Tab out of it goes back to its swatch. Overlay previews (`Iframe`) are out of the Tab order.
- Don't remove focus outlines. Focus looks like this:
  - Anything without its own focus style gets `base.css`'s rose `:focus-visible` ring; it's drawn inset on the title bar's controls and in the sidebar.
  - Inputs show a rose border.
  - `Toggle` draws the ring on its track.
- `Select` is a combobox with a listbox. Its `OPTION_HEIGHT` is the item's `--control-height` plus the row's 2px padding on each side, so change them together. Number fields use `NumberInput`, which can be emptied while typing and reports only valid numbers. It compares values with `Object.is`, so NaN (an overlay number setting saved as text) shows an empty field.
- Something hidden only by CSS also needs `tabIndex={-1}` and `aria-hidden`.

## State, hooks and audio

- Global state is in `context/` (`app`, `audio`, `notifications`); shared hooks are in `hooks/`.
- If `LOAD_APP` fails, `AppProvider` still sends `SHOW_WINDOW`, but shows only the title bar and "Tokio couldn't start" instead of the pages. Toasts still work, since `NotificationsProvider` sits outside it.
- `useImmerState` returns an immer `Updater`; `scopeUpdater(update, key)` hands a section one field.
- `useEditableSettings(section, onLoad?)` loads a profile section (TTS, Music, Alerts) and saves it 300ms after the last change, so quick changes go in one save. A change still waiting is sent when the page or the window closes (`pagehide`; not `beforeunload`, which can keep the window open) and dropped when another profile loads, and a failed save reloads the profile. Nothing is saved before a profile has loaded, so the defaults it starts from never reach one.
- Main saves to whichever profile is active, so call `flushSettings()` before switching profiles: it sends the changes still waiting to the profile they were made on, and the `useAutosave` fields still waiting.
- `useAutosave(saved, save)` does the same for one field outside the profile, such as the keys in Settings, which have no Save button.
  - It saves 300ms after the last change, and sends a change still waiting when the field unmounts, the window closes or `flushSettings()` runs (both hooks join one set through `useFlush`).
  - It starts over when `saved` changes, except for main's echo of its own save, which would undo what was typed since.
- Audio plays through named `AudioQueue`s (`helper/audio.ts`) from `useAudio().getQueue(name)`, with `enqueue(bytes, { gain, key, cacheKey, speed, pitch, onEnded, minDuration, onScheduled })`, scheduled once decoded, or `wait(seconds, options)` for a silent place (speed changes don't stretch it). An item's place lasts at least `minDuration`, and `onScheduled(delay, duration)` gets the seconds until it's heard, measured from `Tone.immediate()` (`Tone.now()` runs ahead by the look ahead), and how long the place lasts. `onEnded` doesn't run when a queue is stopped. `maxQueueLength` counts playing items and decodes in flight, so a full queue never decodes. Sounds with a `cacheKey` are decoded once for every queue, kept in an LRU of up to 200 MB of decoded audio (`DECODED_CACHE_BYTES`).
