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
- `install()` calls `quitAndInstall` only after `settle(3000)`, without awaiting it, because the request that asked is tracked too. electron-updater starts the installer before it quits the app, so a quit held for saves would race it. `UpdateButton` calls `flushSettings()` first, so an edit still in its autosave delay is tracked before the wait.
- electron-updater's `info` lines go to `Logger.debug` until `install()` runs, then to `Logger.info`: the install's own lines are the only trace of an installer Windows refused (`spawn UNKNOWN`, likely the unsigned build).
- `INSTALL_UPDATE` saves a ready version as `settings.installingVersion` (top level, like `lastVersion`) before `install()`, whose wait covers the write; a failed save doesn't block it. The first `LOAD_APP` of a run clears it, and when Tokio is still on an older version (`compareVersions`, so not after a newer one installed by hand), warns (`UPDATE_NOT_INSTALLED`) and calls `markManual(version)`: that version then shows as `available` with `manual: true` on any platform, so the button opens its release page instead of restarting into the same failed installer.
- Status reaches the renderer as `UpdateStatus` on `UPDATE_STATUS`, pushed on every change; read it with `useUpdateStatus`. `UpdateButton` asks first while a LIVE is connected, and isn't rose then, since rose says "do this".
- Checks run `STARTUP_DELAY_MS` after `LOAD_APP`, then every `CHECK_INTERVAL_MS` while `settings.updates.auto` is on. A failed background check is only logged, since it's usually just offline; About shows a failed manual check. The official overlays' automatic updates use the same timings and sit in **Settings → Updates** too (`.claude/rules/overlays.md`).
- The updater logs its own errors through `<Updater>`, so don't log them again.
- What's new: the first `LOAD_APP` of a run saves `app.getVersion()` as `settings.lastVersion` when it changed, and replies the old one as `updatedFrom` (`""` from stores older than the field), except for a rebuilt store (`wasRebuilt`). A first run gets `newStore` instead (`.claude/rules/first-start.md`). The field is top level because `updateUpdatesSettings` replaces `updates` whole.
- `AppProvider` keeps `updatedFrom` only from a reply that has it, since StrictMode loads twice.
- `WhatsNew` shows only `__APP_VERSION__`'s `releases.<version>` notes, at least `MIN_NOTES` to a page and split evenly, with a link to its GitHub release (the user's call: never one note per page). It opens nothing when that release has no notes or `updatedFrom` is newer, a release coming after its prereleases. The `release` skill writes them.
- `app-update.yml` is only packaged for update-capable targets (NSIS, mac zip, AppImage), not `--dir` builds. In dev, `TOKIO_DEV_UPDATES=1 yarn dev` checks against `dev-app-update.yml`.
