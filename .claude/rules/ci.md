---
paths:
  - ".github/workflows/**"
  - "electron-builder.yml"
  - "scripts/release-notes/**"
  - ".commitlintrc"
---

# CI, packaging and releases

- `ci.yml` (pull requests and `main`): Prettier, lint, typecheck and the tests on Linux, Windows and macOS, the e2e tests (under `xvfb-run` on Linux), and on pull requests `commitlint` on every commit against `.commitlintrc`.
- Its `gate` job packages the app with `build-app.yml` for non-draft PRs, `main`, and draft PRs whose latest commit contains `[ci]`. `chore(release): ...` pushes skip it: their tag runs `release.yml`, which packages the same commit.
- `release.yml` runs on a `v<version>` tag that must match `package.json`. Only its `release` job can write to the repository; `verify` and the packaging jobs only read it. The `release` skill drives it.
- Versions with a `-` (`0.1.0-alpha.5`) are published as regular releases, not prereleases: auto-updates and the website read only the latest release.
- It then sends a `repository_dispatch` (`release`) to `tokio-app/website`, which rebuilds the download page. That needs the `WEBSITE_DISPATCH_TOKEN` secret, a fine-grained token with Contents read and write on `tokio-app/website`; without it the step only warns.
- The package file names change together: `artifactName` in `electron-builder.yml`, the upload paths in `build-app.yml`, the file list in the `release` skill and the website's `src/lib/release.ts`.
- `scripts/release-notes` (`yarn release:notes`) writes the notes from the pull requests merged since the previous `v*` tag, one line each, by their titles' Conventional Commits type: breaking changes, `feat`, `fix`, `perf` and `revert` only (the user's call: pull requests, not commits, and nothing users don't notice). It prints the ones it leaves out on stderr, which the workflow doesn't save. It finds pull requests by GitHub's merge commits (`Merge pull request #N`, the title below), so a pull request squashed or rebased in, a local merge or a commit pushed to `main` isn't in them.
