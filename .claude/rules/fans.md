---
paths:
  - "src/main/services/fans/**"
---

# Fans

`FansService` (`src/main/services/fans`) keeps the fans the active profile has seen in its LIVEs, and overlays get them as `tokio:fans`. TikTok sends a viewer's fan level only when they do something in the LIVE, so an overlay learns from here about fans it hasn't seen since it loaded.

## Recording

- A fan is keyed by TikTok's user id (`UserData.userId`), since handles change. Viewers without one are skipped.
- The user of each `FAN_EVENTS` event with a fan level of 1 or more updates their entry: name, handle, level, the badge's picture (`fanBadge`) and `seenAt` (ms since the epoch). A level of 0 changes nothing, since a missing badge isn't proof they left the fan club. ROOM_USER's ranks carry no badges, so they're left out.
- A new live event with a `user` goes in `FAN_EVENTS`.
- Up to `MAX_FANS` (5,000) per profile. The one not seen for the longest is dropped first, in the `Map`'s order, which the file keeps.
- No profile pictures, the user's call: TikTok signs their links (`x-expires`), and in the 2026-10-20 captures they expired 2 days after they were sent. An overlay takes the picture of a fan in the LIVE from their live events.
- The badge's picture is kept: the connector takes it from the fan badge (`getFanBadge`), next to the level. They're TikTok's fixed files on `p16-webcast.tiktokcdn.com`, unsigned: a heart with a tier mark and no number, one per 10 levels (`fans_badge_icon_lv1`, `lv10` … `lv50`), in two designs (`_v2`, `_v4`) and grey versions. Overlays draw `fanLevel` next to it. A file saved without `fanBadge` loads with `""`.

## The file

- `fans/<profile file>` in the app folder (`folders.fansFolder`), outside the profile, so exports, clones, imports and `GET_PROFILE` leave it out. Clones and imports start with no fans.
- `load(file)` runs at startup, even when the profile didn't load, and on `SET_PROFILE`. A later load wins over an earlier one still reading.
- A file that's there but doesn't load is left as it is, and nothing is recorded for that profile until a later load. The log has a warning.
- Saved when it changed: every `FANS_SAVE_MS` (30 s, an unref'd interval in `registerFans`), on `DISCONNECTED`, and before `SET_PROFILE` switches, which is refused when that save fails. A failed background save warns once per `REPEAT_NOTICE_MS` (`FANS_SAVE_FAILED`).
- Never on quit (`shortcut:`), like the timer: a quit or crash during a LIVE loses up to 30 s of fans.
- A save takes the file and the fans before any `await`, so one running during a switch lands in the file the fans came from. With nothing to save, `save()` returns how the last save went, so a switch waits for one still writing.

## Overlays

- `{ type: "tokio:fans", data: { fans } }` holds the `SENT_FANS` (100) highest levels, then the most recently seen.
- Each client gets it as it connects, whatever its id (Tokio's own pages ignore it), then after each load, and on changes through a `throttle` of `FANS_PUSH_MS` (5 s) that reads the list when it fires. `ServerService.sendToAll` sends it.
- Test sends a sample: `createTestLive` adds `tokio:fans` to every press, so previews and test overlays get it then, not when they load.
- The SDK (`@tokioapp/overlay`) types it as `TOKIO_EVENTS.FANS`. Overlays on an older version log it as an unknown type.
