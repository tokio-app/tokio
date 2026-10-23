---
name: live-event
description: "Add a TikTok LIVE event (a new TOKIO_EVENTS entry) or change an event's payload, end to end: connector, types, samples, alerts, the Home feed, overlays, the overlay SDK and the website. Use when the connector should emit a new kind of event, or an event's data changes."
argument-hint: "<event>"
---

# Add or change a live event

Event names (`tokio:event:<name>`) and payloads are public: overlays, saved alerts and the website depend on them. Never rename an event or remove a payload field; add new ones instead.

## In this repo

1. Types, in `src/common/types/connector.ts`: the `TOKIO_EVENTS` entry (`tokio:event:<name>`), the payload type next to the others, and its row in `TokioEventMap`. Typecheck then asks for:
   - its label in `ALERT_TRIGGER_LABELS` (same file)
   - its message variables in `ALERT_MESSAGE_VARIABLES` (`src/common/util/alerts.ts`)
   - its sample in `src/common/util/samples/index.ts`, which the alerts' TTS test and the unit tests use

   Also give it a place in `createTestLive` (same file), the LIVE an overlay's Test button plays one press at a time. Its test fails until each press sends every live event.

2. An internal event, one that doesn't come from the LIVE, goes instead in the `AppEvents` exclusions and in `INTERNAL_EVENTS` (same file; they mirror each other), and in the `exclude` list of `AlertTriggerSchema` (`src/common/schemas/profile.ts`). It then reaches neither overlays nor alerts.
3. The connector: listen to the `@tokioapp/connector` event (`WebcastEvent.<NAME>`, payloads in its README) in `_listen` of `src/main/services/connector/providers/default/index.ts`, and `this.emit(TOKIO_EVENTS.<NAME>, data)` with only the fields of the payload type. Candidates it already decodes: `subNotify`, `emote`, `roomPin`, `imDelete`, `questionNew`, `goalUpdate`, `pollMessage`, `linkMicBattle` and `linkMicArmies`, `giftBroadcast`, `controlMessage`.
4. Alerts: every live trigger reaches `AlertsService.handle` on its own (`registerConnectorEvents`, `src/main/events/init.ts`). If the trigger needs a filter or a picker, like gifts, keywords or users have, add it to `AlertsService` (`src/main/services/alerts/`) and to `AlertItem`'s switch (`src/renderer/src/components/AlertItem/`). An event that comes in combos fires once, on `repeatEnd`, like gifts.
5. The Home feed, when the event belongs in Activity:
   - `ACTIVITY_EVENTS` and its item in `src/main/services/live/index.ts`, and the `Activity` type in `src/common/types/live.ts`
   - its kind in `ActivityFeedSchema` (`src/common/schemas/store.ts`), with its default in `src/common/util/constants/store.ts`
   - `FeedModal` (`src/renderer/src/pages/Home/sections/`)
6. The countdown timer, when viewers doing it should add time:
   - its trigger in `TIMER_EVENTS` (`src/main/services/timer/index.ts`)
   - a field in the `seconds` and `names` groups of `TimerSettingsSchema` (`src/common/schemas/timer.ts`), and its carousel item in `timerTriggers` (`src/common/util/timer.ts`)
   - its row in `TRIGGERS` (`src/renderer/src/pages/Tools/helper.ts`)

   See `.claude/rules/timer.md`.

7. Overlays get every live event on their own: `ServerService` broadcasts each one `isLiveEvent` lets through.
8. Tests next to each file you changed: the connector mapping, alerts, the live session and the timer.
9. The README, where its alerts, overlays and countdown timer parts list events.

## Other repos

Tell the user which of these need a change and a release:

- The overlay SDK, `../tokio-event-loader` (`@tokioapp/overlay`): `src/types/index.ts` copies `TOKIO_EVENTS` and the payload types. Overlays get the new type once a new version is published; ask before publishing.
- The overlays repo, `../tokio-overlays`: the event list in `.github/ISSUE_TEMPLATE/overlay_request.yml`.
- The website, `../tokio-web`: `src/content/docs/docs/developers/events.md`, in its LIVE events and Data sections.

## Done when

The event reaches alerts, overlays and, if it belongs there, the feed, with tests; `yarn typecheck` passes; and the user knows what the other repos need.
