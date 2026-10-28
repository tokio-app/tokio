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
2. `yarn typecheck` and `yarn lint`. Lint fails on any warning, so fix them all.
3. Prettier on the files you touched: `npx prettier --check <files>`, and `--write` to fix them. CI checks the whole repo with `npx prettier --check .`.
4. When the changed files call for them:
   - `yarn test:e2e` for window setup, the preload or startup: `src/main/index.ts`, `src/main/handler/app.ts`, `src/main/config/`, `src/preload/`, `src/renderer/src/splash/`, the HTML entries (`src/renderer/index.html`, `src/renderer/splash.html`, `src/music/index.html`), `electron.vite.config.ts`, `e2e/` and `playwright.config.ts`. It builds the app first and needs port 37891, so ask the user to quit Tokio and stop `yarn dev`.
   - `yarn build:unpack` for `electron-builder.yml`, or for files the app reads at runtime. `npx asar list dist/win-unpacked/resources/app.asar` should show, outside `node_modules`, only `out/`, `music-out/`, `resources/` and `package.json`, and for the window-only packages in `files`' `!node_modules/{…}` pattern only their `package.json` and license files. The packaged app should start (the `drive-app` skill's `--exe`). `src/main/packaging.test.ts` already catches main reaching a stripped package.
   - `yarn tts:edge:check` for `src/main/services/tts/providers/edge/`. It needs the network.
   - `npx fallow dead-code` after moving, renaming or deleting code.
   - The tests in WSL, on Windows, for code that can behave differently on Linux or macOS: file links, paths, case-sensitive names, permissions. Commit first: the WSL copy runs committed code (see Linux checks in WSL below).
   - `git ls-files --eol | grep w/crlf` after a script wrote files: the repo uses LF. `.commitlintrc`, `.editorconfig`, `.gitattributes` and `LICENSE` always show up and are fine. A Python script writes CRLF on Windows unless it opens files with `newline="\n"`.

## Linux checks in WSL

The maintainer's Windows machine keeps a Linux copy of the repo in WSL (Ubuntu 24.04) at `~/tokio-wsl`, cloned from the Windows checkout, with Node 24 in `~/.local/node24/bin`. It only sees committed code:

```sh
wsl.exe -e bash -lc 'cd ~/tokio-wsl && export PATH=$HOME/.local/node24/bin:$PATH &&
  git fetch -q origin && git checkout -q -B <branch> origin/<branch> && npx vitest run'
```

- After `yarn.lock` changes, reinstall there first with `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npx yarn@1.22.22 install --frozen-lockfile --ignore-scripts`.
- Electron isn't installed there, so `yarn dev` and `yarn test:e2e` don't run.

## Traps

- "Vitest failed to find the runner" in every suite means the shell's working directory has a lowercase drive letter (`c:\`). Run from `C:\…`; it isn't a real failure. In PowerShell, run `Set-Location 'C:\Users\…\tokio'` first: a Git Bash `cd /c/…` can keep the lowercase drive.
- While `.claude/worktrees/` holds agents' worktrees, `yarn lint` lints them too. Run `npx oxlint --type-aware --deny-warnings --ignore-pattern ".claude/worktrees/**"` instead.
- An `it.fails` test that passes now means its bug is fixed: turn it into `it`.
- The renderer tests that render the whole app (App, Home, Overlays, Official overlays, Layout) slow down when other test runs share the machine, which is why the renderer's timeout is 15s. If one still times out, rerun it alone before calling it a failure.

## Report

Say what ran and passed, show the output of what failed, and say what you skipped and why.
