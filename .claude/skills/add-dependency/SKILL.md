---
name: add-dependency
description: "Add, upgrade or remove an npm package with Tokio's license checks and notices. Use before any yarn add or yarn upgrade, for every version bump (even a patch), including @tokioapp/connector."
argument-hint: "<package>[@version]"
---

# Add, upgrade or remove a dependency

The source and the distributed app are MIT, with one LGPL file (see Licensing in `AGENTS.md`), so every package's license is checked before it goes in.

1. Before installing, read its license: `npm view <package>@<version> license repository`. When it's missing or unusual, read the LICENSE in its repository. For an upgrade, compare it with the installed version's, `node -p "require('<package>/package.json').license"`: licenses change between versions (tiktok-live-connector went MIT → AGPL in 2.4.1).
2. Copyleft (GPL, AGPL, LGPL, MPL, EUPL, CC BY-SA) or no license at all: stop and ask the user.
3. Install with Yarn 1, never by editing `yarn.lock`: `yarn add <package>@<version>` (`-D` for build and test tools), `yarn upgrade <package>@<version>` or `yarn remove <package>`.
   - A transitive package (a security fix inside its parent's range) is different: `yarn upgrade` skips it, and a `yarn add` then `yarn remove` leaves the old version locked. Add a temporary `resolutions` entry in `package.json` (`"express/body-parser": "^2.4.0"`) and run `yarn install`. Remove the entry, delete `node_modules/.yarn-integrity`, and run it again, so the lockfile keeps the new version without the entry's pattern. `yarn install --frozen-lockfile` must pass after.
   - When the fix is outside the parent's range, a `resolutions` override forces a version the parent wasn't built for: ask the user first.
4. Check what came with it: the packages `git diff yarn.lock` adds, and each one's license (`node -p "require('<name>/package.json').license"`), with the same rule as step 2.
5. Update the notices where the change needs it. `src/renderer/src/pages/About/notices.test.ts` fails when they drift:
   - A plain npm package: nothing. About lists the production tree through `LicensesService`.
   - A package only the windows import (Vite bundles it): add it to the `!node_modules/{…}` pattern in `files` (`electron-builder.yml`), so only its `package.json` and license files ship. Take it out if main or the preload starts importing it, or the packaged app breaks.
   - A react-icons set the notices don't list yet: a row under `## Icons` in `THIRD_PARTY_NOTICES.md`, and the set in `COMPONENTS` (`src/renderer/src/pages/About/helper.ts`).
   - A new online service the app talks to: `## Services` in `THIRD_PARTY_NOTICES.md` and `SERVICES` in the About helper, in the same order, and `about.services` in the website's `src/i18n/en.json` and `es.json`.
   - Code, fonts or assets that don't come from npm: an entry in `COMPONENTS`, the license text in `LICENSES/<doc>.txt`, and a section in `THIRD_PARTY_NOTICES.md`.
   - A license change in the LGPL part: the banner in `electron.vite.config.ts`, `LICENSES/`, About and the website's licensing. Ask first.
6. After a removal, drop the rows and entries it had in the notices, and its name from that `files` pattern.
7. `npx fallow dead-code` finds code that only a removed package used. It follows dynamic `import()`s (`electron-updater`'s); a package it still calls unused that the app loads goes in `ignoreDependencies` in `.fallowrc.json`.
8. Verify: `yarn test src/renderer/src/pages/About/notices.test.ts`, `yarn typecheck`, `yarn lint` and `yarn build`.
9. Upgrading `@modelcontextprotocol/server` or `@modelcontextprotocol/core`: they compile other packages into their `dist`. List them from its `//#region ../../node_modules/…` lines and update `LICENSES/MCP-SDK-bundled.txt`, the notices' section and About's component when the list or a version changes.

## Traps

- On Windows, VS Code's Fallow extension runs its language server from `node_modules/@fallow-cli/<platform>/fallow.exe`, which Yarn can't replace while it runs (EPERM). Before an install that changes `fallow`, ask the user to disable the extension; **Fallow: Restart Language Server** locks the new binary at once.
- On Windows, VS Code's oxc extension runs the project's `oxlint --lsp`, which loads `node_modules/@oxlint/binding-win32-x64-msvc/oxlint.win32-x64-msvc.node`.
  - A `yarn upgrade` of any package can relink that file and fail with EPERM before it writes `package.json` and `yarn.lock`, leaving the upgraded package's folder half done: Electron's new `package.json` over the old `dist`.
  - Make the lockfile in a worktree instead: `yarn install --frozen-lockfile --ignore-scripts`, then the upgrade with `--ignore-scripts`. Copy `package.json` and `yarn.lock` back.
  - When the lockfile changed only that package, finish it in the checkout by hand. For Electron, `node node_modules/electron/install.js` fetches the `dist` that matches its `package.json`.
- `yarn upgrade` can replace Electron's package folder without running the root `postinstall`, even when it upgrades another package, so the binary (`node_modules/electron/dist`) is missing until you run `yarn install`, which runs `install-electron`. Check that `dist` is there after any upgrade.
- On Windows, VS Code can hold `node_modules/electron/dist/resources/default_app.asar`: Electron keeps an `.asar` open once anything reads a path inside it. Windows' Restart Manager names `Code.exe`, and only quitting VS Code frees it.
  - A `yarn add` relinks Electron's folder, so it then fails with EBUSY halfway. By then it has deleted `node_modules/.bin` and the rest of Electron's `dist`.
  - Before such an install, check the file isn't held; if it is, run the install in a worktree and copy `package.json` and `yarn.lock` back.
  - To repair the checkout, unzip Electron's zip from `%LOCALAPPDATA%\electron\Cache` over `dist`, all but that file (the same version's, byte for byte), and copy `.bin` from a worktree with the same lockfile. Run `yarn install` once VS Code is closed.

## Done when

The license of the package and of what it brought in is known and allowed, the notices match, and the checks pass.
