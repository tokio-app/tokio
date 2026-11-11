---
paths:
  - "src/main/services/fans/**"
  - "src/renderer/src/pages/Fans/**"
---

# Fans

`FansService` (`src/main/services/fans`) keeps the fans the active profile has seen in its LIVEs. Overlays get them as `tokio:fans`, and **Tools → Fans** lists them. TikTok sends a viewer's fan level only when they do something in the LIVE, so an overlay learns from here about fans it hasn't seen since it loaded.

## Recording

- A fan is keyed by `UserData.userId`, since handles change. Viewers without one are skipped.
- The user of each `FAN_EVENTS` event with a fan level of 1 or more updates their entry: name, handle, level, `fanBadge` and `seenAt`. A level of 0 changes nothing, since a missing badge isn't proof they left the fan club. ROOM_USER's ranks carry no badges, so they're left out.
- `superfan`: chat and gifts carry TikTok's flag (`isSubscriberOfAnchor`), so they set it either way, and `SUPER_FAN` and `SUPER_FAN_JOIN` set it. The other events keep what's known, since the connector fills their flag with `false` (`SUPERFAN`).
- A new live event with a `user` goes in `FAN_EVENTS`, and in `SUPERFAN` when it tells whether they're a Super Fan.
- Up to `MAX_FANS` per profile. The one not seen for the longest is dropped first, in the `Map`'s order, which the file keeps.
- No profile pictures (the user's call): TikTok signs their links (`x-expires`) and they expire about 2 days after they're sent. An overlay takes a fan's picture from their live events.
- `fanBadge` is the fan badge's picture, which the connector reads with the level (`getFanBadge`): TikTok's fixed, unsigned file on `p16-webcast.tiktokcdn.com`, a heart with a tier mark and no number, one per 10 levels, so overlays draw `fanLevel` next to it.
- A file saved without `superfan` or `fanBadge` loads with `false` and `""`.

## The file

- `fans/<profile file>` in the app folder (`folders.fansFolder`). Clones and imports start with no fans.
- `load(file)` runs at startup even when the profile didn't load. A file that's there but doesn't load (held at startup too) is left as it is, and nothing is recorded for that profile until a later load. `load` then gives false, and startup and a profile switch warn (`FANS_LOAD_FAILED`).
- Saved when it changed, as Persistence in `AGENTS.md` describes, and also on `DISCONNECTED`. A failed background save warns once per `REPEAT_NOTICE_MS` (`FANS_SAVE_FAILED`).
- With nothing to save, `save()` returns how the last save went, so a switch waits for one still writing.

## Overlays

- `{ type: "tokio:fans", data: { fans } }` holds the `SENT_FANS` highest levels, then the most recently seen.
- Each client gets it as it connects, whatever its id (Tokio's own pages ignore it), then after each load, and on changes through a `FANS_PUSH_MS` `throttle` that reads the list when it fires.
- Test sends a sample (see Previews in `.claude/rules/overlays.md`).
- The SDK (`@tokioapp/overlay`) types it as `TOKIO_EVENTS.FANS`. Overlays on an older version log it as an unknown type.

## The Fans page

- `GET_FANS` replies `FANS` with every fan, the highest levels first, then the most recently seen. Nothing is pushed: the page and Tools' list ask on mount and again on each `GET_PROFILE` reply (a profile switch).
- Rows out of view skip layout (`content-visibility`), so `MAX_FANS` rows stay cheap.
- The level is the row's one bold element; a badge picture that's missing or fails leaves it alone.
- The search runs in the window over every fan, through `viewerMatcher` (see `.claude/rules/history.md`).
- **Super Fans only** (the user's request) lists just them, together with the search.
- Fans can't be removed from the page.
