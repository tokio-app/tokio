---
name: sync-docs
description: "Update every doc a change affects: the README, AGENTS.md and the .claude rules and skills, the license notices, and the website, overlays and overlay SDK repos. Use after a feature, fix or behavior change is done, or when asked to update or check the docs."
---

# Sync the docs

## What changed

!`git status --short`

!`git log --oneline -8`

Read the diff before writing anything: `git diff` for uncommitted work, `git diff <base>..HEAD` for commits.

## Where it goes

- `README.md`: features, settings, chat commands, install steps, platforms and the overlay setup. The website treats it as the source of truth.
- `AGENTS.md` for rules that cross areas, `.claude/rules/<topic>.md` for one area (keep its `paths` right; a new area gets its own rule), and `.claude/skills/<name>/SKILL.md` when a procedure changed.
- The notices, when licensed parts, react-icons sets or online services change: `THIRD_PARTY_NOTICES.md`, `LICENSES/`, `src/renderer/src/pages/About/helper.ts` and the banner in `electron.vite.config.ts` (see Licensing in `AGENTS.md`, and the `add-dependency` skill).
- The website, `../tokio-web`, for what the Website section of `AGENTS.md` lists. Read its `AGENTS.md` first. Its docs are in `src/content/docs/docs/`, and the services in `src/pages/about.astro`.
- The overlays repo, `../tokio-overlays`: `scripts/lib/schema.js` and `scripts/lib/validate.js` when `OverlayMetaSchema`, `OverlayConfigSchema`, `SCRIPT_REGEX` or what `processOverlay` accepts change, and `.github/ISSUE_TEMPLATE/overlay_request.yml` when `TOKIO_EVENTS` change.
- The overlay SDK, `../tokio-event-loader` (`@tokioapp/overlay`): its copy of the event names and payload types in `src/types/index.ts`, and the preview messages.

## Writing

- Check each fact against the code. Don't describe behavior you haven't confirmed.
- Match each doc's voice. The README and the website: plain English, second person, short sentences, UI names in bold (**Settings → Overlay Server**). `AGENTS.md`, rules and skills: terse, with names and paths in backticks.
- Run Prettier on what you touched, in each repo.
- Each repo gets its own commit, `docs: <what changed>` (`docs: describe the activity feed's settings`), and only when the user asks.

## Done when

Every doc the change touches says what the code now does, and the user knows which other repos need a commit.
