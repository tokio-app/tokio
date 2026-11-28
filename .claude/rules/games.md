---
paths:
  - "src/main/services/games/index*"
  - "src/main/events/pages/games*"
  - "src/renderer/src/pages/Games/index*"
  - "src/renderer/src/pages/Games/helper*"
  - "src/renderer/src/pages/Games/sections/ActionsSection*"
  - "src/renderer/src/pages/Games/sections/MinecraftSection*"
  - "src/common/types/games.ts"
  - "src/common/util/games.ts"
---

# Games

The **Games** page connects Minecraft to Tokio: Bedrock Edition by itself, Java Edition through the Tokio mod (`tokio-app/minecraft-mod`, locally `../tokio-minecraft-mod`, with its own `AGENTS.md`). A game action is an Alerts-style trigger plus steps that run Minecraft commands, for one edition. The socket is in `.claude/rules/minecraft-connection.md`, the commands in `.claude/rules/minecraft-commands.md`, the overlay and the pictures library in `.claude/rules/games-overlay.md`.

## Actions

- `Profile.games.actions` holds `GameActionSchema`; its trigger is `TriggerSchema`, shared with alerts. `edition` defaults to `"bedrock"`, so actions saved before Java are Bedrock's.
- `settings.games` (the connections' switches) is in the store, the same for every profile; the actions belong to the profile.

## Runs

- `registerDispatch` (`src/main/events/init.ts`) calls `GamesService.handle` next to the alerts, whatever features are on. It returns when Minecraft is off or in error.
- Matching is `matchesTrigger` and `streakOf` (`.claude/rules/triggers.md`) `GamesService` keeps its own `GiftStreaks`, used once per event; `{count}` is the streak's total.
- **Every gift** runs once per gift added. A Like action runs once every `likes_every` likes from all viewers, counted per action in `_likes` with the rest carried over, as the timer does.
- Gifts and likes are never capped (the user's call: every gift and like count runs).
- Each action has a FIFO backlog (`_backlogs`) of batches (one run's filled commands, `times` left). `_pump` serves it one run at a time, `RUN_GAP_MS` after the answers; a lone run goes out at once, and actions pump side by side.
- An action on any other trigger takes no new runs while its backlog holds `MAX_BACKLOG` runs (the one being sent included): `_queue` reports `full` and resolves the skipped batch.
- Before each run `_pump` checks the latest `games` and the game; its comments say when the rest drop. Filled commands stay as accepted.
- Each batch keeps the `_switches` count it was queued at; a switch or a pause (`stopRuns`) bumps it. `_pump` drops the stale batches at the front, so runs queued after a Resume still go, and `MAX_BACKLOG` counts only current ones. The run being sent stops at its next gap between mobs (`{ wait, gap }`, from `spaced`), never inside a launch's wait: cut before its teleport, the player keeps rising and can fall to their death.
- Whatever changes the active profile's games calls `setGames` (`UPDATE_GAMES_SETTINGS` after a save, and `SET_PROFILE`). A switch passes `switched`, which stops every backlog (the user's call), since clones and imports keep action ids.
- A game replaced midway by one of its edition fails only the unanswered commands (`dropped`), with no notice: the run counts as done and the backlog goes on in the new game.
- `_pump` awaits `settled()` after a dropped run and before each run, so a game in its handshake, or one that took over, gets the backlog once ready.
- `handle` resolves once its own batches are served or dropped. `dispatchGames` isn't awaited, so a backlog never holds up other events.
- The connector's `DISCONNECTED` calls `clear`, which forgets streaks and counted likes, not backlogs. While paused, `skip` counts an event in the streaks, and nothing else (`.claude/rules/controls.md`).
- An action runs only while a game of its `edition` is connected (`_unreachable`); a game of the other edition counts as none, for `handle` and `test` alike, and mid-run `send(command, edition)` drops a command for it. A failure that leaves no game of the edition (it left, the other edition replaced it, Minecraft was turned off) stops `_send` there without waiting out its waits, so the backlog drops before Minecraft can come back.
- **Test** (`TEST_GAME_ACTION`, `notify: false`, carries `edition`) runs the steps once with `generateTriggerSample` (Emote uses a chat with an emote) on the platform the page or MCP resolved (`platform`, `samplePlatform`) and returns each command with the game's reply. It fails with no game or the other edition. The reply carries the action's `id` and echoes the request's `request`, failures included: the row numbers each Test with a module-level counter (`requests` in `ActionsSection`) and applies only its own, so a late reply from before leaving the page is dropped. It's in `PRIVATE_REPLIES`, so MCP's test (`request: 0`) never reaches the page.

## Notices and logs

- Logs go to `Files.logs.games`; the source is `games`. A status change is logged once, at debug (an error status at warn), never per command. An error status comes with an English `cause`, which `GamesService` logs, never the translated `status.error`.
- `onStatus` pushes `GAMES` on every change. A failed listen at startup keeps the setting on and warns once (`GAME_LISTEN_FAILED`); the page shows the status.
- `registerGames` (`src/main/events/init.ts`) turns `onError` into notices:
  - `GAME_NOT_CONNECTED`, key `game:minecraft:offline`, 60 s: an action ran with the toggle on and no game of its edition. It names the edition and its command (`MINECRAFT_CONNECT_COMMANDS`, also the page's).
  - `GAME_COMMAND_FAILED`, key `game:<action id>`, `REPEAT_NOTICE_MS`: the game refused a command, or Tokio failed it. Tokio's own failures carry their locale `key`, and the log line takes its English text.
  - `GAME_BACKLOG_FULL`, key `game:<action id>:full`, `REPEAT_NOTICE_MS`: an event's runs were skipped.
- `GAME_ACTION_FAILED` reports an unexpected throw from `dispatchGames`. The toggle, the autosave and Test send no success notices.

## Renderer

- The Java steps link to `MINECRAFT_MOD_DOCS_URL`, the website's `#java-edition` anchor: keep that heading there.
- The mod's README's commands must match the page's (`MINECRAFT_CONNECT_COMMANDS`).
- The trigger picker offers `GAME_TRIGGERS`: `TRIGGER_OPTIONS` without Super Fan join, Member join, Envelope, Super Fan Box and Music change (the user's call). The schema still takes them, so an action saved with one keeps running.
- A game action's trigger has a platform like an alert's (`.claude/rules/triggers.md`); the picker's events follow it and the profile's platforms, within `GAME_TRIGGERS`. Like shows `likes_every` in the filter's place. `min_coins` and `roles` aren't offered, in MCP either: actions keep defaults that match everything, and `handle` matches without them, so ones an older MCP saved can't skip events.
- **Actions** opens on the connected game's edition, else Bedrock unless only Java has actions, remounting per profile (`key={loads}`). It turns to a game's edition when one connects; one that leaves keeps the tab. An action whose edition changes takes the tab with it, so it stays in view.
- Its title folds it, so the overlay gets the room; the body is `hidden` so actions keep their state. Its one **Add action** sits in the body under the tab's actions, none in the header (the user's call).
- `MOBS` and `ITEMS` come from `src/common/games/minecraft-bedrock.json` and `minecraft-java.json` (`MINECRAFT_NAMES`, in common so main can name overlay rows). The `minecraft-lists` skill regenerates them.
- `withEdition(action, edition)` moves ids with `idIn`: the same id, else `PAIRS` (ids and names both differ), else the id with the same English name (Bedrock's `web` is Java's `cobweb`), else a zombie or a diamond. To Bedrock it drops morph and unmorph steps and swaps each mod hazard for its stand-in in `JAVA_ONLY_HAZARDS` (the meteor Falling TNT, the lasers lightning), keeping the step's other fields (the user's call).
- `STEP_KINDS[edition]` and `HAZARDS[edition]` offer the mod's only on Java. `MORPH_MOBS` is Java's mobs minus `NOT_MOBS` (`src/common/util/games.ts`): what summons but isn't a living mob, and the chicken jockey. MCP refuses them for morph too.
- Test results show the last `RESULTS_SHOWN`, so an earlier failure shows only in `testSummary`.

## Real-game check

- Drive the built app (`drive-app`), `/connect` with **Require Encrypted WebSockets** on, run each step kind, a bad command and a burst, then leave the world and come back.
- For Java, run the mod's dev client (`./gradlew runClient` in `../tokio-minecraft-mod`), `/tokio connect`, and **Test** a Java action.
