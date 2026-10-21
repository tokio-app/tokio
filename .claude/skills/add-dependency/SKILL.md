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
4. Check what came with it: the packages `git diff yarn.lock` adds, and each one's license (`node -p "require('<name>/package.json').license"`), with the same rule as step 2.
5. Update the notices where the change needs it. `src/renderer/src/pages/About/notices.test.ts` fails when they drift:
   - A plain npm package: nothing. About lists the production tree through `LicensesService`.
   - A package only the windows import (Vite bundles it): add it to the `!node_modules/{…}` pattern in `files` (`electron-builder.yml`), so only its `package.json` and license files ship. Take it out if main or the preload starts importing it, or the packaged app breaks.
   - A react-icons set the notices don't list yet: a row under `## Icons` in `THIRD_PARTY_NOTICES.md`, and the set in `COMPONENTS` (`src/renderer/src/pages/About/helper.ts`).
   - A new online service the app talks to: `## Services` in `THIRD_PARTY_NOTICES.md` and `SERVICES` in the About helper, in the same order, and `SERVICES` in the website's `src/pages/about.astro`.
   - Code, fonts or assets that don't come from npm: an entry in `COMPONENTS`, the license text in `LICENSES/<doc>.txt`, and a section in `THIRD_PARTY_NOTICES.md`.
   - A license change in the LGPL part: the banner in `electron.vite.config.ts`, `LICENSES/`, About and the website's licensing. Ask first.
6. After a removal, drop the rows and entries it had in the notices, and its name from that `files` pattern.
7. `npx fallow dead-code` finds code that only a removed package used. A package loaded only through a dynamic `import()` looks unused to it: list it in `ignoreDependencies` in `.fallowrc.json`, like `electron-updater`.
8. Verify: `yarn test src/renderer/src/pages/About/notices.test.ts`, `yarn typecheck`, `yarn lint` and `yarn build`.

## Done when

The license of the package and of what it brought in is known and allowed, the notices match, and the checks pass.
