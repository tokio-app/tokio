---
paths:
  - "src/main/services/fans/**"
  - "src/renderer/src/pages/Fans/**"
---

# Fans

`FansService` (`src/main/services/fans`) keeps the fans the active profile has seen in its LIVEs: TikTok's fan club, and the other platforms' subscribers (Twitch, Kick) and members (YouTube), the user's call. Overlays get TikTok's as `tokio:fans`, and **Tools → Fans** lists every platform's. TikTok sends a viewer's fan level only when they do something in the LIVE, so an overlay learns from here about fans it hasn't seen since it loaded.

## Recording

- A fan is keyed by `UserData.userId`, since handles change. Viewers without one are skipped.
- The user of each `FAN_EVENTS` event with a fan level of 1 or more updates their entry: name, handle, level, `fanBadge` and `seenAt`. A level of 0 changes nothing, since a missing badge isn't proof they left the fan club. ROOM_USER's ranks carry no badges, so they're left out.
- `superfan`: chat and gifts carry TikTok's flag (`isSubscriberOfAnchor`), so they set it either way, and `SUPER_FAN` and `SUPER_FAN_JOIN` set it. The other events keep what's known, since the connector fills their flag with `false` (`SUPERFAN`).
- **Twitch's, Kick's and YouTube's fans** are their subscribers and members:
  - Recorded when an event's viewer wears the subscriber, founder or member badge (`superfan`, which the providers set), or on a `SUBSCRIBE`. A missing badge changes nothing, not even `seenAt`.
  - Their records have `platform`, `fanLevel` 0, `fanBadge` "" and `superfan` true.
  - `months` is the most known of the record's own, the badge's (`UserData.subMonths`, `.claude/rules/platforms.md`) and a sub's `months`: YouTube's badge says only its milestone.
- A new live event with a `user` goes in `FAN_EVENTS`, and in `SUPERFAN` when it tells whether they're a Super Fan. Kick's Kicks stay out, as Twitch's cheers do: their viewer comes without badges, so they'd record nothing.
- Up to `MAX_FANS` per platform in each profile, when recording and when loading. Each platform drops its own fan not seen for the longest first, in the `Map`'s order, which the file keeps.
- No profile pictures (the user's call): TikTok signs their links (`x-expires`) and they expire about 2 days after they're sent. An overlay takes a fan's picture from their live events.
- `fanBadge` is the fan badge's picture, which the connector reads with the level (`getFanBadge`): TikTok's fixed, unsigned file on `p16-webcast.tiktokcdn.com`, a heart with a tier mark and no number, one per 10 levels, so overlays draw `fanLevel` next to it.
- A file saved without `superfan` or `fanBadge` loads with `false` and `""`.

## The file

- `fans/<profile file>` in the app folder (`folders.fansFolder`). Clones and imports start with no fans.
- `load(file)` runs at startup even when the profile didn't load. A file that's there but doesn't load (held at startup too) is left as it is, and nothing is recorded for that profile until a later load. `load` then gives false, and startup and a profile switch warn (`FANS_LOAD_FAILED`).
- Saved when it changed, as Persistence in `AGENTS.md` describes, and also on `DISCONNECTED`. A failed background save warns once per `REPEAT_NOTICE_MS` (`FANS_SAVE_FAILED`).
- With nothing to save, `save()` returns how the last save went, so a switch waits for one still writing.

## Overlays

- `{ type: "tokio:fans", data: { fans } }` holds TikTok's `SENT_FANS` highest levels, then the most recently seen (`list()`). The other platforms' stay out, so a fan-level overlay never fills up with subs (the user's call).
- Each client gets it as it connects, whatever its id (Tokio's own pages ignore it), then after each load, and on changes through a `FANS_PUSH_MS` `throttle` that reads the list when it fires.
- Test sends a sample (see Previews in `.claude/rules/overlays.md`).
- The SDK (`@tokioapp/overlay`) types it as `TOKIO_EVENTS.FANS`. Overlays on an older version log it as an unknown type.

## The Fans page

- `GET_FANS` replies `FANS` with every platform's fans (`all()`), each platform's together in `PLATFORMS` order: TikTok's by level, the others by months (unknown last), then the most recently seen. Nothing is pushed:
  - Tools' list asks on mount and again on each `GET_PROFILE` reply (a profile switch).
  - The page has no `PlatformsContext`, so it asks for the profile itself on mount, for its platforms. It asks for the fans after each `GET_PROFILE` reply, a failed one too, so a switch reloads both.
- **Tabs** (the user's call), as LIVE history's:
  - The profile's platforms plus any a saved fan is on, in `PLATFORMS` order, then All with two or more. With one platform there's no tab row.
  - A picked tab stays while it's there.
- **TikTok's tab:** the level is the row's one bold element, with its badge; a badge picture that's missing or fails leaves it alone.
- **Twitch's, YouTube's and Kick's tabs:** main's order, each row led by the months (the number bold), else "Subscriber" (or "Member" on YouTube). There's no Super Fan word, since every one of them is a subscriber or member.
- **All:** the most recently seen first, each row with its platform's icon and its own number. Nothing is ranked across platforms (the user's call).
- Rows out of view skip layout (`content-visibility`), so `MAX_FANS` rows stay cheap.
- The search filters the tab shown, through `viewerMatcher` (see `.claude/rules/history.md`). Each tab has its own empty text.
- **Super Fans only** (the user's request) lists just them, together with the search. It sits at the end of the tab row and shows on TikTok's tab alone; with one platform it's in the header, after the search.
- Fans can't be removed from the page.
