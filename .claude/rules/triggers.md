---
paths:
  - "src/main/helper/triggers.ts"
  - "src/main/helper/streaks.ts"
  - "src/main/helper/chat.ts"
  - "src/common/util/rows.ts"
  - "src/common/util/alerts.ts"
  - "src/renderer/src/components/AlertItem/**"
  - "src/renderer/src/pages/Alerts/useTriggerChoices*"
---

# Trigger rows

Alerts, game actions and Overlay Studio share the trigger rows.

## Rows

- `AlertTriggerSchema` derives the triggers from `TOKIO_EVENTS` (a new event: the `live-event` skill). `ROOM_USER` is left out there and from `AlertTrigger`: it comes every few seconds and is meant for overlays.
- Alerts and Games share `TriggerSchema`, `TriggerFilter` and `TRIGGER_OPTIONS`; Games leaves five out (`GAME_TRIGGERS`). Game actions keep one trigger.
- An alert or a Studio element plays on its `trigger` or any of its `also_triggers` (Or rows, `MAX_TRIGGERS` in all, `triggersOf`), kept apart from `trigger` so an older Tokio still plays on the first.
- `TriggerRows` (`components/AlertItem`) draws the rows in the Alerts editor and Overlay Studio: the first under **Event**, each other under **Or** with a remove button, then **Add a trigger**, `MAX_TRIGGERS` in all. Each row keeps its own filter, minimum and roles.
- A trigger row is `[platform] [event]` (the user's call). The platform select shows only once the profile uses two or more platforms, or when the row already has one saved.
- A trigger's `platform` limits it to that platform's events. It's missing for any platform, and one a newer Tokio saved that this one doesn't know reads as any (`.catch`). `matchesTrigger` skips a row whose platform isn't the event's, and Music change matches only a row for any.
- A new alert, game action or Studio element starts on Follow where the profile's platforms send follows, else a subscription (`newRowTrigger`), a new Studio counter on gifts where they come, and a new list ranks the profile's first platform's gifters. MCP's new alerts, actions and Studio elements do the same.
- Changing a row's platform to one without its event moves it to that platform's first event (`withPlatform`; Studio's rows through `retype`).
- Only TikTok's gifts come in streaks: YouTube's come whole, a combo in one event (`comboCount` its size, `repeatEnd` true), so their rows have no **When it plays** choice, streak note or streak summary (`rowStreaks`).

## Matching

- `matchesTrigger` (`src/main/helper/triggers.ts`) is shared by `AlertsService`, `GamesService` and `StudioService`. They get `added` and `total` from `streakOf` (same file), which counts the event in their `GiftStreaks` once; `total` is the `{count}`.
- `GiftStreaks` (`src/main/helper/streaks.ts`) counts what each gift event adds to its sender's streak. Every service that counts gifts keeps its own.
- The Emote trigger (`EMOTE_TRIGGER`) isn't a live event: `matchesTrigger` matches it on `CHAT`. TikTok can't list a LIVE's emotes, so `StoreManagerService.recordEmotes` saves the ones seen in chat to `Profile.emotes`.
- The Redeem trigger's `keyword` is the reward's title, matched in any case, empty for any reward. Its variables are `{reward}`, with `{comment}` for what the viewer typed.
- Keywords (`hasKeyword`, `src/main/helper/chat.ts`) match whole words (`wholeWord`), ignoring case, accents and emojis, an emoji counting as a space. An end that isn't a letter, digit or `_` (":)", "加油") matches anywhere, and letters of scripts written without spaces (Han, Kana, Thai, Lao, Khmer, Myanmar) don't make a word longer.

## A row offers what its platforms send

The user's call. `rowPlatforms` gives them: the row's own platform, else the profile's that send its event. Alerts, Overlay Studio and Games follow it:

- The emote picker lists the emotes of those platforms, told by their id's prefix (`idPlatform`), and keeps picked ones to clear.
- The variables are the event's minus the ones no such platform fills (`rowVariables`): Kick's subs have no `{comment}`. Studio's texts are still filled with every variable; only the editor's offer follows the row.
- A Like alert offers `{username}`, `{handle}` and `{count}` (the batch's likes), since it plays each viewer's batch. Game actions and Overlay Studio, which count likes from every viewer, take `countedVariables`: the same lists with none on Like (the user's call). A text there that already has them still gets the last batch's, since `messageValues` reads the payload.
- The Alerts and Games pages read TikTok's gift list and the custom gifts through `useTriggerChoices` (`pages/Alerts`), with the emotes; `giftOptions` merges them. Overlay gift settings use TikTok's list only. Picked gifts match TikTok's ids only, so `TriggerFilter` offers the picker on TikTok rows, on rows for any platform when the profile has TikTok, and wherever gifts are already picked, so they can be cleared.

## Minimum and roles

Only the Alerts editor offers these, and Overlay Studio's reaction rows the minimum too; game actions keep the defaults, which match everything.

- `min_coins` is a row's minimum in its event's own unit (the user's call: each money event its own). The saved name stays, for older files and an older Tokio. The matcher reads it through `worthOf`, and every other trigger ignores it.
  - **Gift:** the streak's worth when it ends (`gift.coins × total`), or each gift's with `every_gift`, in TikTok's coins. It applies only to any gift: picked gifts are the alert's choice, so the matcher, the editor and the summary ignore it then.
  - **Bits:** the cheer's Bits.
  - **Kicks:** the Kicks sent, like Bits (the user's call).
  - **Super Chat:** its `usd`. One without dollars (null or missing) fires, so a missing rate never silences an alert.
  - **Gifted subs:** the event's `count`.
- The editor and the summary name the unit by the row (`minUnit`): coins on a gift row that can get TikTok's gifts, none on a YouTube gift row (its gifts have no price) unless a minimum is already saved, and Bits, Kicks, US dollars ("worth $5+", without cents, since a minimum is whole) or gifted subs on those events' rows.
- `MinimumField` (`components/AlertItem`) draws it under a row, in the Alerts editor and Overlay Studio's reaction rows alike (the user's call).
- `roles` (`[]` is anyone): only Chat, Emote and Gift carry the viewer's roles, so `takesRoles` (`src/common/util/alerts.ts`, shared by the matcher, the editor and the summary) allows only them. Other triggers' saved roles are ignored.
  - The editor offers a row the roles its platforms' events say (`rowRoles`): TikTok's chat, emotes and gifts say followers, moderators and Super Fans; Twitch's, YouTube's and Kick's chat and emotes say Moderators and their subscribers or members, from badges, and Twitch's and Kick's VIPs (`vip`, the user's call), but never who follows; their gifts say none.
  - A role saved earlier stays shown to clear, and the matcher is unchanged.
  - `roleName` names the Super Fan role as the row's platforms call it: Subscribers on Twitch and Kick, Members on YouTube, and every term on a row for any platform ("Super Fans, subscribers, and members", the user's call).
