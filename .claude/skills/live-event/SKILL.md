---
name: live-event
description: "Add a LIVE event (a new TOKIO_EVENTS entry) or change an event's payload, end to end: connector, types, samples, alerts, the Home feed, overlays, the overlay SDK and the website. Use when the connector should emit a new kind of event, or an event's data changes."
argument-hint: "<event>"
---

# Add or change a live event

Event names (`tokio:event:<name>`) and payloads are public: overlays, saved alerts and the website depend on them. Never rename an event or remove a payload field; add new ones instead.

Each platform's provider (`.claude/rules/platforms.md`) maps its own events to `TOKIO_EVENTS`. An event TikTok has no equivalent for, like Twitch's Bits, is still one `TOKIO_EVENTS` entry.

## In this repo

1. Types, in `src/common/types/connector.ts`: the `TOKIO_EVENTS` entry (`tokio:event:<name>`), the payload type next to the others, and its row in `TokioEventMap`. Typecheck then asks for:
   - its label in `ALERT_TRIGGER_LABELS` (same file), a `triggers.*` key added to every locale file (`.claude/rules/i18n.md`)
   - its message variables in `ALERT_MESSAGE_VARIABLES` (`src/common/util/alerts.ts`)
   - its sample in `src/common/util/samples/index.ts`, in `SAMPLES` under each platform that sends it, shaped as that platform's mapping sends it (`generateEventSample(type, platform)`), which alerts' and games' tests, Studio and the unit tests use

   Also give it a place in each sending platform's press in `createTestLive` (same file), the LIVE an overlay's Test button plays. Its test fails until every live event and each platform's `PLATFORM_TRIGGERS` row is sent.

2. An internal event, one that doesn't come from the LIVE, goes instead in the `AppEvents` exclusions and in `INTERNAL_EVENTS` (same file; they mirror each other), and in the `exclude` list of `AlertTriggerSchema` (`src/common/schemas/profile.ts`). It then reaches neither overlays nor alerts.
3. The platforms that send it, each in its own provider under `src/main/services/connector/providers/`: Twitch's, YouTube's and Kick's `common/mapping.ts` in `twitch/`, `youtube/` and `kick/`. TikTok: listen to the `@tokioapp/connector` event (`WebcastEvent.<NAME>`, payloads in its README) in `_listen` of `default/index.ts`, and `this.emit(TOKIO_EVENTS.<NAME>, data)` with only the fields of the payload type. Every provider sets `user.platform`, and namespaces the ids it sends (`twitch:<id>`, `youtube:<id>`, `kick:<id>`). Then add the event to each sending platform's row in `PLATFORM_TRIGGERS` (`src/common/util/platforms.ts`), which the trigger pickers, the feed's kinds, the stat tiles and the timer rows follow. Candidates it already decodes: `subNotify`, `emote`, `roomPin`, `imDelete`, `questionNew`, `goalUpdate`, `pollMessage`, `linkMicBattle` and `linkMicArmies`, `giftBroadcast`, `controlMessage`.
4. Alerts and game actions: every live trigger reaches `AlertsService.handle` and `GamesService.handle` on its own (`registerDispatch`, `src/main/events/init.ts`). If the trigger needs a filter or a picker, like gifts, keywords or users have, add it to `matchesTrigger` (`src/main/helper/triggers.ts`, shared by both) and to `TriggerFilter` (`src/renderer/src/components/AlertItem/`, which the Games page uses too). An event that comes in combos fires once, on `repeatEnd`, like gifts.
5. The Home feed, when the event belongs in Activity:
   - `ACTIVITY_EVENTS` and its item in `src/main/services/live/index.ts`, and the `Activity` type in `src/common/types/live.ts`
   - its kind in `ActivityFeedSchema` (`src/common/schemas/store.ts`), with its default in `src/common/util/constants/store.ts`
   - its row in `FEED_KINDS` (`src/renderer/src/pages/Home/helper.ts`), which `FeedModal` lists
6. The countdown timer, when viewers doing it should add time:
   - its trigger in `TIMER_EVENTS` (`src/main/services/timer/index.ts`)
   - a field in the `seconds` and `names` groups of `TimerSettingsSchema` (`src/common/schemas/timer.ts`), its automatic name as `timer.names.<field>` in the locale files, and its carousel item in `timerTriggers` (`src/common/util/timer.ts`)
   - its event in `TIMER_TRIGGERS` (`src/common/util/timer.ts`) and its row in `TRIGGERS` (`src/renderer/src/pages/CountdownTimer/helper.ts`)

   See `.claude/rules/timer.md`.

7. An event that carries money or gifted subs goes in `HISTORY_EVENTS` with its recorder in `src/main/services/history/index.ts`, which counts it on the LIVE's platform part, its minute and the viewer's record. See `.claude/rules/history.md`.
8. Overlays get every live event on their own (`ServerService`, `isLiveEvent`). An event whose payload has a `user` also goes in `FAN_EVENTS` (`src/main/services/fans/index.ts`), so the profile keeps its viewers' fan levels for `tokio:fans`, and in `SUPERFAN` there when it tells whether the viewer is a Super Fan (`.claude/rules/fans.md`).
9. Tests next to each file you changed: the connector mapping, alerts, the live session, the timer and the history.

## Other repos

Tell the user which of these need a change and a release:

- The overlay SDK, `../tokio-event-loader` (`@tokioapp/overlay`): `src/types/index.ts` copies `TOKIO_EVENTS` and `src/types/events.ts` the payload types (a new one is exported from `src/index.ts`), and its `README.md`'s event and Data tables describe them. Overlays get the new type once a new version is published; ask before publishing.
- The overlays repo, `../tokio-overlays`: the event list in `.github/ISSUE_TEMPLATE/overlay_request.yml`.
- The website, `../tokio-web`: `src/content/docs/docs/developers/events.md`, in its LIVE events and Data sections, and the events `features/alerts.mdx`, `features/games.mdx` and `features/countdown-timer.mdx` list, each with its Spanish copy under `src/content/docs/es/docs/`.

## Done when

The event reaches alerts, overlays and, if it belongs there, the feed, with tests; `yarn typecheck` passes; and the user knows what the other repos need.
