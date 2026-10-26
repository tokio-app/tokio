---
paths:
  - "src/main/services/store/**"
  - "src/main/services/json/**"
  - "src/common/schemas/**"
  - "src/common/util/constants/**"
---

# Store and profiles

`StoreManagerService` (`src/main/services/store`) holds the store file and the profile files. The rules every area follows (schemas and defaults, store mutators, `updateProfileData`, provider keys, atomic writes) are in Persistence in `AGENTS.md`.

## Profiles

- `createNewProfile`, `cloneProfile` and `importProfile` return `"unsaved"` when only the store save failed, after deleting the profile file they wrote, and `null` for other failures.
- A profile switch or a new listing (`addProfile`) that can't be saved is undone. The store is then saved once more so the file matches memory: an earlier queued save may have written it.
- Profile files are named by `profileFileFor`: the name in safe characters, numbered when the file is taken. The store never writes over a profile's file.
- Creating or cloning a profile under a name another one has is refused (`PROFILE_EXISTS`). An import gets a free file name.
- An import is listed under the name saved in it, trimmed, and numbered ("Name 2") when another profile has that name in any case. One whose trimmed name is too short is listed as "Imported profile".

## The active profile

- `getProfileData` keeps the active profile in memory.
- When its file fails to load, live events try it again at most every `LOAD_RETRY_MS`, so a broken file isn't read on every event.
- After an emote save fails (`recordEmotes`), emote saves for that file wait `LOAD_RETRY_MS` before writing again.
- GET_PROFILE and the sweeps that remove a sound, media file or picture from every profile (`removeFromAlerts`, `removeFromGames`, through `_updateProfiles`) pass `{ fresh: true }`: they wait for the active profile's update still writing and retry a failed file at once.

## Loading and recovery

- JSON files load with or without a leading UTF-8 BOM (`JSONManagerService`).
- The store file is read once, at startup.
- One that doesn't parse or validate is backed up from the bytes read to `tokio.corrupted-<time>.json` next to it and replaced by the defaults.
- One that can't be read (locked, no access) or backed up stops startup ("Tokio couldn't start") and is left as it is.
- A rebuilt store keeps a valid `default.json`. An invalid one is backed up as `default.corrupted-<time>.json` before it's replaced, and one that can't be read stops startup too.
