---
paths:
  - "src/main/services/store/**"
  - "src/main/services/json/**"
  - "src/common/schemas/**"
  - "src/common/util/constants/**"
---

# Store and profiles

`StoreManagerService` (`src/main/services/store`) holds the store file and the profile files.

## Profiles

- `createNewProfile`, `cloneProfile` and `importProfile` return `"unsaved"` when only the store save failed, after deleting the profile file they wrote, and `null` for other failures.
- A profile switch or a new listing (`addProfile`) that can't be saved is undone. The store is then saved once more so the file matches memory: an earlier queued save may have written it. An undone switch reads the active profile from its file again, since an update to it may have landed during the save.
- Profile files, an import's too (after the picked file's name), are named by `profileFileFor`: the name in safe characters, numbered when the file is taken. The store never writes over a profile's file. An export into the profiles folder is refused: the save dialog starts in the last folder used, which an import can make that one.
- Creating or cloning a profile under a name another one has is refused (`PROFILE_EXISTS`).
- An import is listed under the name saved in it, trimmed, and numbered ("Name 2") when another profile has that name in any case. One whose trimmed name is too short is listed as "Imported profile".

## The active profile

- `getProfileData` keeps the active profile in memory. When its file fails to load, live events try it again at most every `LOAD_RETRY_MS`, so a broken file isn't read on every event.
- After an emote save fails (`recordEmotes`), emote saves for that file wait `LOAD_RETRY_MS` before writing again. An emote's image is compared with TikTok's once a run, and only counts as checked once its save went through.
- GET_PROFILE and the sweeps that remove a sound, media file or picture from every profile (`removeFromAlerts`, `removeFromGames`, through `_updateProfiles`) pass `{ fresh: true }`: they wait for the active profile's update still writing and retry a failed file at once. A sweep logs a profile whose file it can't read (held, no access) and returns false, so the handler keeps the library file; one that's missing or doesn't load counts as done. The active one too: when it isn't in memory, the sweep reads its file itself (`_readChecked`), since `getProfileData` gives null for a held file. A switch landing during that read would hand it the new profile, so it then reads the one it was on from its file, and every write names its file.
- A library file added again (`_addFile`) saves the store anyway: a failed save may have left it out of the file.

## Loading and recovery

- JSON files load with or without a leading UTF-8 BOM (`JSONManagerService`).
- The store file is read once, at startup.
- One that doesn't parse or validate is backed up from the bytes read to `tokio.corrupted-<time>.json` next to it and replaced by the defaults. `startApp` warns naming the backup (`corruptedBackup()`, `SETTINGS_LOAD_FAILED`), and LOAD_APP's `newStore` (the tour) is only for a store file that wasn't there.
- One that can't be read (locked, no access) or backed up stops startup ("Tokio couldn't start") and is left as it is.
- A rebuilt store keeps a valid `default.json`. An invalid one is backed up as `default.corrupted-<time>.json` before it's replaced, and one that can't be read stops startup too. So does another profile file it can't read, or a sounds, media or pictures folder that's there but can't be read. Profiles that don't load are left out.
