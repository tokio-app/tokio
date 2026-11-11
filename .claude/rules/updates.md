---
paths:
  - "src/main/services/updater/**"
  - "src/common/types/updates.ts"
  - "src/renderer/src/components/UpdateButton/**"
  - "src/renderer/src/hooks/useUpdateStatus.ts"
  - "src/renderer/src/pages/Settings/sections/UpdatesSection.tsx"
  - "src/renderer/src/components/WhatsNew/**"
  - "electron-builder.yml"
  - "dev-app-update.yml"
---

# Updates

- `UpdaterService` (`src/main/services/updater`) wraps electron-updater's `autoUpdater`. It's loaded with a dynamic `import()` because the package is CJS and main builds to ESM, so use its default export. Tests inject a fake `Updater`.
- It reads the GitHub release marked latest (`allowPrerelease = false`). Without that, the library would allow prereleases on its own for `-alpha` versions.
- Windows (NSIS) and Linux (AppImage) download in the background and install on restart. macOS builds are ad-hoc signed, which Squirrel.Mac rejects, so mac only checks (`manual: true`) and opens the release page.
- `install()` calls `quitAndInstall` only after `settle(3000)`, without awaiting it, because the request that asked is tracked too. electron-updater starts the installer before it quits the app, so a quit held for saves would race it. Clicks during the wait install once. `UpdateButton` calls `flushSettings()` first, so an edit still in its autosave delay is tracked before the wait.
- Status reaches the renderer as `UpdateStatus` (`src/common/types/updates.ts`) on `UPDATE_STATUS`, pushed on every change; read it with `useUpdateStatus`. `UpdateButton` (title bar and About) asks first while a LIVE is connected, and isn't rose then, since rose says "do this". In the title bar (`titleBar`) a ring fills in its place while the update downloads; About shows the download's percent and bar in place of its buttons.
- Checks run `STARTUP_DELAY_MS` after `LOAD_APP`, then every `CHECK_INTERVAL_MS` while `settings.updates.auto` is on. A failed background check is only logged, since it's usually just offline; About shows a failed manual check.
- The updater logs its own errors through `<Updater>`, so don't log them again.
- What's new: the first `LOAD_APP` of a run saves `app.getVersion()` as `settings.lastVersion` when it changed, and replies the old one as `updatedFrom` (`""` from stores older than the field), except for a new store (`wasRebuilt`), whose first `LOAD_APP` replies `newStore: true` instead, for the tour (`.claude/rules/renderer.md`). The field is top level because `updateUpdatesSettings` replaces `updates` whole. `AppProvider` keeps `updatedFrom` only from a reply that has it, since StrictMode loads twice. `WhatsNew` shows only `__APP_VERSION__`'s `releases.<version>` notes, at least `MIN_NOTES` (3) to a page and split evenly, with a link to its GitHub release (the user's call: never one note per page). It opens nothing when that release has no notes or `updatedFrom` is newer, a release coming after its prereleases. The `release` skill writes them.
- `app-update.yml` is only packaged for update-capable targets (NSIS, mac zip, AppImage), not `--dir` builds. In dev, `TOKIO_DEV_UPDATES=1 yarn dev` checks against `dev-app-update.yml`.
