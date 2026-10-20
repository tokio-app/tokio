---
paths:
  - "src/main/services/updater/**"
  - "src/common/types/updates.ts"
  - "src/renderer/src/components/UpdateButton/**"
  - "src/renderer/src/hooks/useUpdateStatus.ts"
  - "src/renderer/src/pages/Settings/sections/UpdatesSection.tsx"
  - "electron-builder.yml"
  - "dev-app-update.yml"
---

# Updates

- `UpdaterService` (`src/main/services/updater`) wraps electron-updater's `autoUpdater`. It's loaded with a dynamic `import()` because the package is CJS and main builds to ESM, so use its default export. Tests inject a fake `Updater` instead.
- It reads the GitHub release marked latest (`allowPrerelease = false`). Without that, the library would allow prereleases on its own for `-alpha` versions.
- Windows (NSIS) and Linux (AppImage) download in the background and install on restart. macOS builds are ad-hoc signed, which Squirrel.Mac rejects, so mac only checks (`manual: true`) and opens the release page.
- Status reaches the renderer as `UpdateStatus` (`src/common/types/updates.ts`) on `UPDATE_STATUS`, pushed on every change. Read it with `useUpdateStatus`. `UpdateButton` (title bar and About) restarts or opens the release page, and asks first while a LIVE is connected.
- Checks run 15s after `LOAD_APP` and then every 6h while `settings.updates.auto` is on. A failed background check is only logged, since it's usually just offline; About shows a failed manual check.
- The updater logs its own errors through `<Updater>`, so don't log them again.
- `app-update.yml` is only packaged for update-capable targets (NSIS, mac zip, AppImage), not `--dir` builds. In dev, `TOKIO_DEV_UPDATES=1 yarn dev` checks against `dev-app-update.yml`.
