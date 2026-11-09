---
name: release
description: "Publish a Tokio release. Bumps the version, previews the notes, writes the What's new streamers see after the update, commits, tags and pushes, then watches the Release workflow until the release and its update files are out. Use only when the user asks for a release."
argument-hint: "[version]"
disable-model-invocation: true
---

# Release

A release reaches auto-updates and the website as soon as the workflow publishes it. Confirm the version, and ask before pushing.

## Where things stand

- Version: !`node -p "require('./package.json').version"`
- Last tag: !`git describe --tags --abbrev=0`
- Branch: !`git status --short --branch`

## Steps

1. Check the branch: `main`, clean and level with `origin/main` (`git fetch origin`, then `git status --short --branch`). Check that CI passed on `HEAD`: `gh run list --branch main --limit 3`, or without `gh`, the `status` and `conclusion` of `https://api.github.com/repos/tokio-app/tokio/actions/runs?head_sha=<sha>`. If anything is off, stop and tell the user.
2. Pick the version: the argument if there is one, otherwise the next prerelease number (`0.1.0-alpha.6` → `0.1.0-alpha.7`). Confirm it with the user. Versions with a `-` are still published as regular releases.
3. Show the notes: `yarn release:notes`. `scripts/release-notes` lists the features, fixes, performance changes and reverts merged by pull request since the previous `v*` tag (see `.claude/rules/ci.md`), then the pull requests it left out: check those for a feature or fix with the wrong title. A wrong one can be fixed in the release on GitHub afterwards, and a rerun keeps the edit.
4. Write the What's new that Tokio shows after the update. From the pull requests in the notes, pick what a streamer would notice: new features, and fixes to things they could see go wrong. Write up to nine lines, each a plain sentence that uses the app's own names for things, with no commit types, scopes or code names. The dialog lists them at least three to a page, so six or more take two pages. Add them as `"releases.<version>": "line\nline"` at the end of `en.json`, and in Spanish at the end of `es-419.json` (the Spanish section of `.claude/rules/i18n.md`), both through the `humanizer` skill. Show them to the user with the notes. A release with nothing a streamer would notice gets no entry, and no dialog opens for it.
5. Change only `version` in `package.json` and add the What's new lines, run `yarn test src/common/i18n` if there are any, and commit them as `chore(release): <version>`, subject only, like the earlier ones (`git log --grep "^chore(release)" -3`).
6. Tag it: `git tag v<version>`, lightweight like the other tags. The workflow fails when the tag doesn't match `package.json`.
7. Ask the user, then push the commit and the tag: `git push origin main`, then `git push origin v<version>`.
8. Watch the Release workflow (`.github/workflows/release.yml`: verify, then the app on Windows, macOS and Linux, then release). With `gh`, use `gh run watch`. Without it, poll `https://api.github.com/repos/tokio-app/tokio/actions/runs?event=push&branch=v<version>` once a minute in the background until its `status` is `completed`. The builds take a while.
9. If it failed, give the user the run's `html_url` and the job that failed. Rerunning it on GitHub only replaces the release's files. On the first run, `gh release create` uploads the files before it publishes, so the update files are there when auto-updates see the release.
10. Check the release at `https://api.github.com/repos/tokio-app/tokio/releases/tags/v<version>`: published, not a draft, with 10 files. They are `latest.yml`, `latest-mac.yml`, `latest-linux.yml`, `tokio-<version>-setup.exe`, `tokio-<version>-mac-arm64.zip`, `tokio-<version>-mac-x64.zip`, `tokio-<version>-x86_64.AppImage`, and a `.blockmap` for the setup and each zip.
11. Check that the website rebuilt: `https://api.github.com/repos/tokio-app/website/actions/runs?event=repository_dispatch&per_page=1` shows a Deploy run started after the release. If there's none, the `WEBSITE_DISPATCH_TOKEN` secret is missing: tell the user to run the website's Deploy workflow by hand.

## Done when

The release is published with its 10 files, and the user has its URL (`https://github.com/tokio-app/tokio/releases/tag/v<version>`) and knows whether the website rebuilt.
