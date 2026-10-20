---
paths:
  - "src/renderer/**"
  - "src/ui/**"
---

# Renderer

## Pages and components

- Each page is a folder `src/renderer/src/pages/<Page>/` with `index.tsx`, `<page>.module.css`, an optional `helper.ts` and `sections/*Section.tsx`. Export it from `pages/index.tsx`, route it in `router/index.tsx` (hash history) and add sidebar links to `NAV_ITEMS` in `router/Layout`.
- A page opened from another page instead of the sidebar (Official Overlays) gets a path under its parent's (`/overlays/official`), which keeps the parent's sidebar item active, and a back button in its header (`Section`'s `icon`).
- Build pages from `components/Page` (`Page`, `Section`, `Field`, `FormGrid`, `EmptyState`); a page module only holds page-specific layout.
- Components are folders with `index.tsx` and `<name>.module.css`, re-exported from `components/index.tsx`. Use the primitives in `components/Elements` before creating new ones; they take colors from the tokens, not props. `Modal` is the only modal shell.
- Style with CSS Modules and the tokens in `src/ui/styles/tokens.css` (colors, `--space-*`, `--font-*`, `--radius-*`, `--z-*`), not raw values.

## Keyboard

- Keep controls usable from the keyboard. `Modal` takes the focus while open and gives it back, and Escape closes the innermost one; popovers inside it (`Select`, `Color`) handle Escape first and stop it.
- `Select` is a combobox with a listbox. Number fields use `NumberInput`, which can be emptied while typing and reports only valid numbers.
- Something hidden only by CSS also needs `tabIndex={-1}` and `aria-hidden`.

## State, hooks and audio

- Global state is in `context/` (`app`, `audio`, `notifications`); shared hooks are in `hooks/`.
- `useImmerState` returns an immer `Updater`; `scopeUpdater(update, key)` hands a section one field.
- `useEditableSettings(section, onLoad?)` loads a profile section (TTS, Music, Alerts) and saves it 300ms after the last change, so quick changes go in one save. A change still waiting is sent when the page closes and dropped when another profile loads, and a failed save reloads the profile.
- Main saves to whichever profile is active, so call `flushSettings()` before switching profiles: it sends the changes still waiting to the profile they were made on.
- Audio plays through named `AudioQueue`s (`helper/audio.ts`) from `useAudio().getQueue(name)`. `onEnded` doesn't run when a queue is stopped, and `maxQueueLength` counts waiting and playing items.
