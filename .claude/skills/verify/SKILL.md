---
name: verify
description: "Run the checks a change needs before it's done: tests, typecheck, lint and Prettier, plus the end-to-end tests or the Edge TTS check when the changed files call for them. Use when finishing a change, before a commit, or when asked to verify or check the work."
---

# Verify a change

## Changed files

!`git status --short`

## Checks

Run them from the repository root, the narrow ones first:

1. Tests: `yarn test <path>` for what you touched, then `yarn test` (`--project main` or `--project renderer` runs one side).
2. `yarn typecheck` and `yarn lint`. Fix lint warnings in code you touched.
3. Prettier on the files you touched: `npx prettier --check <files>`, and `--write` to fix them. CI checks the whole repo with `npx prettier --check .`.
4. When the changed files call for them:
   - `yarn test:e2e` for window setup, the preload or startup: `src/main/index.ts`, `src/main/config/`, `src/preload/`, `src/renderer/src/splash/`, the HTML entries (`src/renderer/index.html`, `src/renderer/splash.html`, `src/music/index.html`), `electron.vite.config.ts`, `e2e/` and `playwright.config.ts`. It builds the app first and needs port 37891, so ask the user to close Tokio and `yarn dev`.
   - `yarn build:unpack` for `electron-builder.yml`, or for files the app reads at runtime. `npx asar list dist/win-unpacked/resources/app.asar` should show, outside `node_modules`, only `out/`, `music-out/`, `resources/` and `package.json`, and the packaged app should start (the `drive-app` skill's `--exe`).
   - `yarn tts:edge:check` for `src/main/services/tts/providers/edge/`. It needs the network.
   - `npx fallow dead-code` after moving, renaming or deleting code.
   - `git ls-files --eol | grep w/crlf` after a script wrote files: the repo uses LF. `.commitlintrc`, `.editorconfig`, `.gitattributes` and `LICENSE` always show up and are fine.

## Traps

- "Vitest failed to find the runner" in every suite means the shell's working directory has a lowercase drive letter (`c:\`). Run from `C:\…`; it isn't a real failure.
- An `it.fails` test that passes now means its bug is fixed: turn it into `it`.

## Report

Say what ran and passed, show the output of what failed, and say what you skipped and why.
