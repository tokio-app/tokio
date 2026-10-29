---
paths:
  - "src/renderer/**"
  - "src/ui/**"
---

# Renderer

Profile sections save through `useEditableSettings`, single fields through `useAutosave`, and sound plays through `AudioQueue`: see `.claude/rules/renderer-state.md`.

## Pages and components

- Each page is a folder `src/renderer/src/pages/<Page>/` with `index.tsx`, `<page>.module.css`, an optional `helper.ts` and `sections/*Section.tsx`. The router uses hash history. The `new-page` skill has the steps.
- The router's `defaultErrorComponent` keeps a page's render error inside the page, with the title bar and sidebar.
- A page opened from another page instead of the sidebar (Official overlays) gets a path under its parent's (`/overlays/official`), which keeps the parent's sidebar item active, and a back button in its header (`Section`'s `icon`).
- Build pages from `components/Page` (`Page`, `Section`, `Field`, `FormGrid`, `EmptyState`); a page module only holds page-specific layout.
- Every text on screen comes from the locale files through `useT()`, and lint fails on text written into JSX: see `.claude/rules/i18n.md`. Leave room for Spanish, which runs about 25% longer.
- Components are folders with `index.tsx` and `<name>.module.css`, re-exported from `components/index.tsx`. Use the primitives in `components/Elements` before creating new ones; they take colors from the tokens, not props.
- `Modal` is the only modal shell. A search in a header is a `SearchToggle`. A value to copy is a `CopyField` with a `title` saying what it copies, or a `CopyButton` among a row's actions.
- An overlay's font is a `FontSelect`: Chromium's `queryLocalFonts()` lists this computer's families, which works because the main window's session has no permission handler (one added there must allow `local-fonts`). Its rows skip layout out of view (`content-visibility`), so opening it doesn't load every font.
- Deleting a sound or media file or removing an overlay asks with `DeleteSoundModal`, `DeleteMediaModal` or `RemoveOverlayModal` (`components/DeleteModals`), which send the request themselves.
- Loaders use `Spinner` (`components/Elements`): a ring in the text color (set `color` on its container), announced as a `status` named "Loading". A button showing it is named by it, so a button named only by its `title` also needs an `aria-label`, as `PlayButton` has.

## CSP

- The CSP is `config.CSP` (`src/main/config/csp.ts`, which has no imports so `electron.vite.config.ts` can read it).
- In dev, pages get it as a header from `initSession`. Built pages load from `file://`, which headers don't reach, so the `tokio:csp` build plugin adds the production policy as a meta tag.
- That policy loads scripts only from `'self'` and has no `connect-src`: pages can't fetch, and audio reaches `AudioQueue` as bytes over IPC. The media library's thumbnails and the sounds' lengths load from `tokio-media:`, which main serves (see `.claude/rules/alerts.md`). Anything new the renderer loads must fit it.
- Both builds set `assetsInlineLimit: 0`, because the CSP blocks fonts inlined as `data:` URLs.

## Styling

- Style with CSS Modules and the tokens in `src/ui/styles/tokens.css` (colors, `--space-*`, `--font-*`, `--radius-*`, `--z-*`), not raw values.
- To reuse another module's class, import that module in the TSX and add its class, as `GiftSelect` does with `select_display`. Don't use `composes: … from` another file:
  - Vite bundles that file again for every `composes`.
  - A later copy then overrides the page styles that come before it, such as a field's fixed width.

## The look

The look follows the `frontend-design` skill. The palette's values and the logos are the user's: the redesign kept every color value and the logos, so change neither without asking.

- **Surfaces:** one Ink surface (`--background-primary`). Panels (`--background-tertiary`) only for grouped content such as lists and cards. Controls on Field (`--background-secondary`), with `--border` for hairlines and Iron (`--background-secondary-hover`) for hover.
- **Rose** (`--accent-primary`) means LIVE or "do this": the tally, primary actions, selection and focus, never decoration.
- Text on rose is Paper (`--font-primary`), and checkboxes and radios keep the browser's light look. The user's call: they rejected dark text and gray dark-mode boxes.
- **Radii:** `--radius-md` for controls, `--radius-lg` for panels, `--radius-xl` for dialogs.
- **Never:** shadows on cards, pills, or uppercase labels.
- Type is Archivo (`@fontsource-variable/archivo`, imported by `base.css`), at 400 for text, 500 for labels and controls, 600 for titles. Live numbers (Home's stats and totals) use the readout: `font-stretch: var(--stretch-readout)`, 700, `tabular-nums`.
- A page of settings uses `<Page width="wide" layout="aside">`: each section's header sits in a column beside its content. `Section` wraps the content in `.section_body`, which is `display: contents` in the stacked layout.
- Section descriptions are a few words, not explanations, and a section's actions go on the title's row as icon buttons with a `title` (text buttons don't fit there). The user's call.
- `TitleBar`'s `live` prop (Layout passes the `CONNECTED` reply's `live`, see `.claude/rules/live-session.md`) draws the tally on every page: a rose line at the top's center, fading out to both sides, with no "LIVE" label (the user's call). "LIVE" is said only to screen readers.
- The sidebar shows icons only. Each page's name is a span in its link, shown beside the icon on hover and keyboard focus. Opacity hides it, not `visibility`, so it still names the link. Escape hides it until the pointer or focus moves to another link (WCAG 1.4.13).

## Keyboard

- Keep controls usable from the keyboard.
- `Modal` takes the focus while open and gives it back, and keeps Tab inside it: it wraps between its first and last controls, `video[controls]` and `audio[controls]` included, skipping disabled controls and `[tabindex^="-"]`.
- Escape closes the innermost `Modal`; popovers inside it (`Select`, `Color`) handle Escape first and stop it.
- `Color`'s picker is portaled: its text field takes the focus when it opens, and Tab out of it goes back to its swatch.
- Overlay previews (`Iframe`) are out of the Tab order.
- Known limit: a media element's controls live in its shadow DOM, so Tab from a video moves on to the next control rather than through them.
- Don't remove focus outlines. Anything without its own focus style gets `base.css`'s rose `:focus-visible` ring, drawn inset on the title bar's controls and in the sidebar. Inputs show a rose border. `Toggle` draws the ring on its track.
- `Select` is a combobox with a listbox. Its `OPTION_HEIGHT` is the item's `--control-height` plus the row's 2px padding on each side, so change them together.
- Number fields use `NumberInput`, which can be emptied while typing and reports only valid numbers. It compares values with `Object.is`, so NaN (an overlay number setting saved as text) shows an empty field.
- Something hidden only by CSS also needs `tabIndex={-1}` and `aria-hidden`.
- A menu under a toggle button (`ProfileDropdown`, `NotificationBell`) takes its state from `useMenu`: it closes on a click outside its `ref`, and on Escape, which gives the focus back to `toggleRef`.
