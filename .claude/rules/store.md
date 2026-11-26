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
- Creating, cloning or renaming a profile to a name another one has is refused (`PROFILE_EXISTS`); a rename leaves its own file out, so a change of case is fine.
- A rename (`renameProfile`) changes only the name users see, in three copies: the profile file's `name`, its `profiles[]` entry and `activeProfile` (a separate object after startup). The file keeps its own name, so fans, LIVE history and the timer, all keyed by the file, stay where they are (the user's call). A failed store save puts the old name back in memory and in the file, then saves again.
- A delete (`deleteProfile`, Settings → Profiles and MCP's `remove` of kind `profiles`) refuses the active profile, which the only one always is. It unlists the profile and saves the store first ("unsaved" puts it back and deletes nothing), so sweeps and switches no longer reach it. Then it deletes `fans/<file>`, `history/<file without .json>/` with clear()'s `.cleared-` leftovers, and the profile's file last, after its queued updates: while any of the others can't be deleted the file stays, so its name's file stays taken and a new profile can't get the fans and LIVEs left behind. `DELETE_PROFILE` runs on the switches' chain (`switching`, `events/pages/settings.ts`), so a switch away from it, which saves its timer, fans and history there, ends first.
- A clone or an export waits for the updates queued on the profile's file (`whenWritten`) before reading it: any profile can have some, like the timer's or a sweep's, not only the active one.
- An import is listed under the name saved in it, trimmed, and numbered ("Name 2") when another profile has that name in any case. One whose trimmed name is too short is listed as "Imported profile".

## The active profile

- `getProfileData` keeps the active profile in memory. When its file fails to load, live events try it again at most every `LOAD_RETRY_MS`, so a broken file isn't read on every event.
- After an emote save fails (`recordEmotes`), emote saves for that file wait `LOAD_RETRY_MS` before writing again. An emote's image is compared with TikTok's once a run, and only counts as checked once its save went through.
- Each platform (`idPlatform`) keeps at most `MAX_UNUSED_EMOTES` (300) saved emotes that nothing uses, checked when a chat adds one (the user's call). Used means named by an alert's triggers, a game action's trigger, or any Studio overlay's element, group or counter triggers or an emote element's picked `emote.id`, and those are never dropped. Past the cap, the unused ones seen longest ago go: when each was last in a chat is kept in memory for the run only, so those not seen since start go first, in file order.
- GET_PROFILE and the sweeps that remove a sound, media file or picture from every profile (`removeFromAlerts`, `removeFromGames`, through `_updateProfiles`), like `removeVoices` (a removed voice key), pass `{ fresh: true }`: they wait for the active profile's update still writing and retry a failed file at once. A sweep logs a profile whose file it can't read (held, no access) and returns false, so the handler keeps the library file, but still cleans every other profile it can; one that's missing or doesn't load counts as done. The active one too: when it isn't in memory, the sweep reads its file itself (`_readChecked`), since `getProfileData` gives null for a held file. A switch landing during that read would hand it the new profile, so it then reads the one it was on from its file, and every write names its file.
- Library files are added through `_addFiles`, one save per batch (`addSounds`, `addMediaFiles` for the Library's adds). A batch with nothing new still saves: a failed save may have left an entry out of the file.

## Loading and recovery

- JSON files load with or without a leading UTF-8 BOM (`JSONManagerService`).
- The store file is read once, at startup.
- One that doesn't parse or validate is backed up from the bytes read to `tokio.corrupted-<time>.json` next to it and replaced by the defaults. `startApp` warns naming the backup (`corruptedBackup()`, `SETTINGS_LOAD_FAILED`), and LOAD_APP's `newStore` (the tour, and `welcome`, the first-start dialog) is only for a store file that wasn't there.
- One that can't be read (locked, no access) or backed up stops startup ("Tokio couldn't start") and is left as it is.
- A rebuilt store keeps a valid `default.json`. An invalid one is backed up as `default.corrupted-<time>.json` before it's replaced, and one that can't be read stops startup too. So does another profile file it can't read, or a sounds, media or pictures folder that's there but can't be read. Profiles that don't load are left out. Its `activeProfile` takes the found `default.json` entry, with the name saved in it, so a renamed first profile keeps its name.

## The Twitch account

- `settings.accounts.twitch` (`id`, `login`, `key`) is the account Tokio signed in to, the same for every profile. `key` is the refresh token, encrypted like the provider keys (`_encryptProviderKey`, `_withKey`) and decrypted once at startup into Twitch's provider. A token that can't be decrypted reads as signed out.
- `getSettings()` blanks `key`, so the window, the logs, MCP and exports never get it. `getTwitchAccount()` and `updateTwitchAccount` are for main only. `updateTwitchAccount` saves each rotated token before the provider uses it (`.claude/rules/platforms.md`).
