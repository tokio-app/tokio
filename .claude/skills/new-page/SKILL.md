---
name: new-page
description: "Add a page to the main window, with its folder, route, sidebar link and first test, built from components/Page. Use when the app needs a new screen, or a page opened from another page."
argument-hint: "<PageName> [path]"
---

# Add a page

Follow `.claude/rules/renderer.md`; it loads with the renderer files. Tools (`src/renderer/src/pages/Tools/`) is a small page to start from.

1. Make the folder `src/renderer/src/pages/<Page>/`: `index.tsx` exporting `<Page>`, `<page>.module.css` with tokens only, a `helper.ts` for logic worth its own tests, and a `sections/<Name>Section.tsx` per section. Build it from `Page`, `Section`, `Field`, `FormGrid` and `EmptyState` (`components/Page`). A page of settings uses `<Page width="wide" layout="aside">`, which puts each section's title and description beside its fields.
2. Export it from `src/renderer/src/pages/index.tsx`.
3. Route it in `src/renderer/src/router/index.tsx`: a `createRoute` with its `path`, added to `routeTree`.
4. Link it in the sidebar with an entry in `NAV_ITEMS` (`src/renderer/src/router/Layout/index.tsx`), and a Lucide icon (`react-icons/lu`, like the rest of the rail) that shows what the page does. A page opened from another page gets no entry: its path goes under its parent's (`/overlays/official`), and its header gets a back button (`Section`'s `icon`).
5. Get data from main with `useIpcRequest` and `useIpcListener`, and use the `ipc-event` skill for new events. A profile section that saves as it changes uses `useEditableSettings`.
6. Test it in `index.test.tsx`: `renderWithProviders(<Page />)` from `@test/render`, with main's replies sent through `send` (`@test/ipc`). Test the route and the sidebar link with `renderApp("/<path>")`.
7. If users see it, describe it in the website's docs, and give a new feature a line in the README (the `sync-docs` skill).

## Done when

The page opens from its link or its parent, has a test, and the `verify` checks pass.
