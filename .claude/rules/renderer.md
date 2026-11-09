---
paths:
  - "src/renderer/**"
  - "src/ui/**"
---

# Renderer

Profile sections save through `useEditableSettings`, single fields through `useAutosave`, and sound plays through `AudioQueue`: see `.claude/rules/renderer-state.md`.

## Pages and components

- Each page is a folder `src/renderer/src/pages/<Page>/` with `index.tsx`, `<page>.module.css`, an optional `helper.ts` and `sections/*Section.tsx`, built from `components/Page` (`Page`, `Section`, `Field`, `FormGrid`, `EmptyState`). The router uses hash history. The `new-page` skill has the steps.
- A page opened from another page (Official overlays, the tools) gets a path under its parent's (`/overlays/official`, `/tools/fans`), which keeps the parent's sidebar item active, and a `BackButton` (`components/BackButton`) before its first heading (`Section`'s `icon`).
- Tools lists its tools one row each: a link named by the tool, with what it holds now in the readout on the right. No icons, chevrons or cards (the user's call). A new tool gets a page under `/tools/` and a row there.
- Leave room for Spanish, which runs about 25% longer.
- Components are folders re-exported from `components/index.tsx`. Use the primitives in `components/Elements` before creating new ones; they take colors from the tokens, not props.
- `Modal` is the only modal shell. A search in a header is a `SearchToggle`, a media library to pick from a `LibraryPicker`, a value to copy a `CopyField` (its `title` says what it copies) or a row's `CopyButton`.
- An overlay's font is a `FontSelect`: `queryLocalFonts()` lists this computer's families, which works because the main window's session has no permission handler (one added there must allow `local-fonts`). Its rows use `content-visibility`, so opening it doesn't load every font. `defaultLabel` names `""`: Archivo on Tokio's overlays, the overlay's own font in an overlay's settings.
- Deleting or removing something asks with its modal in `components/DeleteModals`, which sends the request itself. Only `DeleteSoundModal` takes `onDelete`, run before the request to stop the sound's test.
- A viewer's picture is an `Avatar` (`components/Avatar`): their initial when there's none or the link fails, as TikTok's do after a couple of days.
- Loaders use `Spinner` (`components/Elements`), announced as a `status` named "Loading". A button showing it is named by it, so one named only by its `title` also needs an `aria-label`, as `PlayButton` has.

## Media elements

- Every video player loads its own URL: `useVideoURL(file)` (`components/MediaPicker`) adds a `?player=` query from `useId`, which `mediaFile` ignores, and Overlay Studio's stage keys it by element id. Chromium fails every player that loads one `tokio-media:` URL at once (error 4), and the URL stays failed.
- Every `<audio>` and `<video>` takes `releaseOnUnmount` (`src/renderer/src/helper/media.ts`) as its ref, or calls it from its own: Chromium keeps a detached player that has a source alive, with the page section it was in. It waits a microtask and leaves an element still in the document, since StrictMode attaches refs again at once in development.

## CSP

- The CSP is `config.CSP` (`src/main/config/csp.ts`, which has no imports so `electron.vite.config.ts` can read it).
- In dev, pages get it as a header from `initSession`. Built pages load from `file://`, which headers don't reach, so the `tokio:csp` build plugin adds the production policy as a meta tag.
- That policy loads scripts only from `'self'` and has no `connect-src`: pages can't fetch, and audio reaches `AudioQueue` as bytes over IPC. Media loads from `tokio-media:`, which main serves (see `.claude/rules/alerts.md`). Anything new the renderer loads must fit it.
- Both builds set `assetsInlineLimit: 0`, because the CSP blocks fonts inlined as `data:` URLs.

## Styling

- Style with CSS Modules and the tokens in `src/ui/styles/tokens.css`, not raw values.
- To reuse another module's class, import that module in the TSX and add its class, as `GiftSelect` does with `select_display`. Not `composes: … from` another file: Vite bundles that file again for every `composes`, and the later copy overrides page styles before it, such as a field's fixed width.

## The look

The look follows the `frontend-design` skill. The palette's values and the logos are the user's: change neither without asking.

- One Ink surface (`--background-primary`). Panels (`--background-tertiary`) only for grouped content such as lists and cards. Controls on Field (`--background-secondary`), with `--border` for hairlines and Iron (`--background-secondary-hover`) for hover.
- Rose (`--accent-primary`) means LIVE or "do this": the tally, primary actions, selection and focus, never decoration.
- Text on rose is Paper (`--font-primary`), and checkboxes and radios keep the browser's light look (the user's call: they rejected dark text and gray dark-mode boxes).
- Radii: `--radius-md` for controls, `--radius-lg` for panels, `--radius-xl` for dialogs.
- No shadows on cards, pills, or uppercase labels.
- Type is Archivo, at 400 for text, 500 for labels and controls, 600 for titles. Live numbers use the readout: `font-stretch: var(--stretch-readout)`, 700, `tabular-nums`.
- A page of settings uses `<Page width="wide" layout="aside">`, with each section's header beside its content. An editor whose canvas is the page uses `width="full"`.
- Section descriptions are a few words, not explanations, and a section's actions go on the title's row as icon buttons with a `title` (the user's call). Fans' **Super Fans only** `Toggle` sits there too, the user's request.
- `TitleBar`'s `live` prop draws the tally on every page: a rose line at the top's center, fading out to both sides, with no "LIVE" label (the user's call). "LIVE" is said only to screen readers.
- The sidebar shows icons only, each page's name shown on hover and focus. Opacity hides the name, not `visibility`, so it still names the link. Escape hides it until the pointer or focus moves to another link (WCAG 1.4.13).

## Keyboard

- Don't remove focus outlines: anything without its own focus style gets `base.css`'s rose `:focus-visible` ring, drawn inset on the title bar's controls and in the sidebar.
- `Modal` takes the focus while open and gives it back, and keeps Tab inside it, `video[controls]` and `audio[controls]` included. A media element's controls live in its shadow DOM, so Tab from a video skips them (a known limit).
- Escape closes the innermost `Modal`; popovers inside it (`Select`, `Color`) handle Escape first and stop it.
- A focused control that moves in the DOM, or leaves it, drops the focus on `<body>` in Chromium, where a `Modal` no longer sees Escape or Tab. Put it back after a `flushSync`, as `TableField`, the games builder's rows and Overlay Studio's Elements list do. jsdom keeps the focus, so only the real app shows it.
- `Color`'s picker is portaled: its text field takes the focus when it opens, and Tab out of it goes back to its swatch.
- Overlay previews (`Iframe`) are out of the Tab order.
- `Select` is a combobox with a listbox. Its `OPTION_HEIGHT` is the item's `--control-height` plus the row's 2px padding on each side, so change them together.
- Number fields use `NumberInput`. It compares values with `Object.is`, so NaN (an overlay number setting saved as text) shows an empty field.
- Something hidden only by CSS also needs `tabIndex={-1}` and `aria-hidden`.
- A menu under a toggle button (`ProfileDropdown`, `NotificationBell`) takes its state from `useMenu`: it closes on a click outside its `ref`, and on Escape, which gives the focus back to `toggleRef`.
