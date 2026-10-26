---
paths:
  - "src/main/services/games/**"
  - "src/main/events/pages/games*"
  - "src/main/helper/triggers.ts"
  - "src/renderer/src/pages/Games/**"
  - "src/common/types/games.ts"
  - "src/common/util/games.ts"
---

# Games

The **Games** page connects Minecraft to Tokio: Bedrock Edition by itself, Java Edition through the Tokio mod (`../tokio-minecraft-mod`, published as `tokio-app/minecraft-mod`; see "Minecraft mod repo" in `AGENTS.md`). A game action is an Alerts-style trigger plus steps that run Minecraft commands, for one edition.

The overlay, its stylesheet and the Minecraft pictures library are in `.claude/rules/games-overlay.md`.

## Connection

- `MinecraftConnection` (`services/games/minecraft.ts`) is a `ws` server on `MINECRAFT_PORT` (37892, `NOTE: DO NOT CHANGE`: players type it), for both editions.
- **Bedrock** joins with `/connect <this PC's address>:37892` from its chat, in a world with cheats on, after **Settings → General → Network settings → Enable WebSockets**.
- **Java** joins with `/tokio connect <address>:37892` (`/tokio connect` alone means `localhost:37892`) from the mod: Fabric, Minecraft 26.3, single-player and LAN worlds the player hosts, no cheats. The mod runs commands as the host at command-block permission, and their feedback isn't shown in chat. It never reconnects by itself, and shows Tokio's close reason in chat.
- The mod offers the subprotocol `MINECRAFT_JAVA_PROTOCOL` (`tokio.java.v1`, `NOTE: DO NOT CHANGE`). `handleProtocols` selects it when offered, otherwise the first offered (Bedrock's `wsencrypt`); `socket.protocol` tells the edition.
- With **Require Encrypted WebSockets** on (the game's default), Bedrock offers `com.microsoft.minecraft.wsencrypt`. `ws` echoes it back; keep that.
- The server has no host, so the command for each of this PC's addresses (`GET_NETWORK_ADDRESSES`) works from this PC and from another device. The page shows `localhost` only when the PC has no address.
- It listens only while `settings.games.minecraft.enabled` is on (off by default). `GamesService`'s constructor opens nothing; `configure` (startup and `SET_GAMES_SETTINGS`) turns it on or off.
- `verifyClient` refuses any upgrade with an `Origin` header: browsers always send one, the game never does, so web pages can't take the socket. This is the exception to "no Origin checks" on the overlay server.
- One game at a time: a new one, of either edition, replaces the old one, closed with 4000 "Another game connected to Tokio.". Turning Minecraft off closes it with 1001 "Minecraft was turned off in Tokio.".
- Turning it off stops listening at once: `_stop` doesn't wait for the server's close, which waits for every socket to end (up to `ws`'s 30 s for a game that never answers the close frame).
- The server and each socket handle `error`: a bad frame would throw in main.

## Protocol

Measured against the real game (see Tests): unit tests can't re-derive these.

The Java mod's side is `../tokio-minecraft-mod/PROTOCOL.md`: change both together.

- Java skips Bedrock's encryption: no handshake, the game counts as connected as soon as the socket opens, and the same `commandRequest` / `commandResponse` frames go as plain text (`statusCode` 0 is ok, -1 failed).
- The mod reads only `header.requestId` and `body.commandLine` of a request, answers a Bedrock `enableencryption` line with -1 ("Update Tokio to use the Java mod."), and fails a command while the host isn't in the world.

The rest is Bedrock's.

- Tokio sends a `commandRequest` (header `version: 1`, a `requestId`) with `enableencryption "<publicKey>" "<salt>" cfb`: ECDH `secp384r1`, public keys as base64 SPKI DER (`SPKI_PREFIX` plus the raw point), a 16-byte salt, key = SHA-256(salt + secret), IV = key[0..16].
- The game answers in three frames: `ws:encrypt` (text, with `publicKey`), a text `commandResponse` with `publicKey`, then an encrypted binary `commandResponse` `{ statusCode: 0 }`.
- Set the keys in the message handler, never after an `await`: the third frame can arrive in the same chunk, and a missed frame desyncs the stream for good.
- After that, binary frames are encrypted and text frames plain, both ways. "Too many commands" errors come as plain text even after the handshake.
- The mode is `aes-256-cfb`, not `cfb8`: Electron's BoringSSL has no `aes-256-cfb8`, while Node's OpenSSL (Vitest) does, so only Electron itself proves the handshake.
- No answer within `handshakeMs` means the player turned encryption off: commands go as plain text.
- Commands: body `version: 42` (1 fails on `execute … run`), `commandLine`, `origin: { type: "player" }`. They run as the connected player, so `~` is where they stand.
- A reply is a `commandResponse` or an `error`; `statusCode >= 0` is ok. Replies are in the game's language (`statusMessage`, or `message`, or nothing).
- The game allows 100 commands in flight. Tokio keeps `MAX_IN_FLIGHT` in flight and `MAX_WAITING` waiting, and fails the rest. `MAX_WAITING` is only a safety net: `GamesService` paces each action's runs.
- A command with no answer fails after `timeoutMs`. A game that leaves fails every pending command with "Minecraft disconnected."

## Statuses

- `GameStatus` is `off` (disabled), `waiting` (listening with no game, also after the game leaves and during Bedrock's handshake), `connected` (after Bedrock's handshake, or as soon as Java joins; carries `edition`) or `error` (`error` is text for the user).
- `GamesService.onStatus` pushes `GAMES` (`app:games:res:games`) with the settings and `{ minecraft: status }` on every change.
- A failed listen at startup keeps the setting on and warns once (`GAME_LISTEN_FAILED`); the page shows the status.

## Actions and commands

- `Profile.games.actions` holds `GameActionSchema`. `edition` defaults to `"bedrock"`, so actions saved before Java are Bedrock's. The trigger is `TriggerSchema`, shared with alerts.
- `settings.games` (the connections' switches) is in the store, the same for every profile; the actions belong to the profile.
- `gameCommands(step, fill, edition)` (`commands.ts`) turns a step into commands in the edition's syntax: Java's ids take `minecraft:` and its `give` targets `@s`, Bedrock's `@p`. A mob or item id that isn't `/^[a-z0-9_]+$/` runs nothing.
- Variables are `ALERT_MESSAGE_VARIABLES` per trigger, filled by `formatAlertMessage(text, payload, commandValue)`. `commandValue` strips `" ' \ { } [ ] § @` and control characters, so a nickname can't inject NBT or selectors. A spawn name goes through it whole, then `JSON.stringify`. The command step's template is the user's own and isn't escaped.

### Hazards and helps

- Hazard steps (`GAME_HAZARDS`, named by `HAZARD_NAMES`) are built-in ways to try to kill or prank the player, with fixed commands per edition in `hazardCommands`.
- They were checked against Java 26.3's command tree and registries and Bedrock's `mojang-commands.json` (bedrock-samples). They carry no NBT but the creeper's and the fuse.
- The charged creeper uses Bedrock's `minecraft:become_charged` spawn event and Java's `powered`. Evoker fangs are Bedrock's `evocation_fang`.
- Only `REPEATED_HAZARDS` (lightning, charged creeper, evoker fangs) repeat by the amount, and only they show it. The rest run once (the user's call for TNT).
- **Fuse** (the TNT's, in seconds): Java's `fuse` in ticks. Bedrock's TNT can't take one: it burns 4 s, or 0.5–2 s at random with its `from_explosion` event, used at 2 s or less. The page says which next to the field on Bedrock actions.
- **Anvil:** `setblock ~ ~20 ~ anvil keep`, because Bedrock can't summon a falling block. It never replaces a block, fails when there's no room, and the anvil stays in the world. Java 26.3 schedules a setblock'd anvil's fall unless the mode is `strict`.
- **Launch:** `launchPlan(height, seconds)` plays Java's physics (speed eases toward 0.05 × level by a fifth a tick, 2% drag, gravity 0.08 after the push) to find the weakest levitation level that gets there within `seconds`, up to `MAX_LEVEL` (amplifier 255, the command's most; Java 26.3 sends it as a VarInt), and when to stop.
- Its commands are the effect, a `{ wait }` and `teleport ~ ~ ~`, which zeroes the climb's speed in Java 26.3 (`TeleportCommand` sends no `DELTA` relatives), so the fall starts at the top instead of drifting up on momentum.
- The stop is never before the push ends, which would lift the player again. Past the top level's reach (about 190 blocks in 1 s) the climb goes on on momentum and stops when it gets there. Bedrock's levitation may differ.
- **Waits:** `gameCommands` returns `GameCommand`s, a command or `{ wait: ms }`. `GamesService._send` sends the commands up to a wait at once, then waits for their answers and the time before the rest, so a launch holds its action's next run, and Test, until it stops. A wait has no result.
- **Help steps** (`GAME_HELPS`, named by `HELP_NAMES`, `helpCommands`): netherite armor, a full heal and potion effects at the levels in `HELP_EFFECTS`. Every id is in both editions' lists, Java 26.3's registries and Bedrock's command enums.
- The armor is put on at once over whatever the player wears, which is lost (the user's call): Java's `item replace entity @s armor.<slot> with`, Bedrock's `replaceitem entity @p slot.armor.<slot> 0`. Only `replace` works: the Java mod counts an `execute if` that runs nothing as failed, and Bedrock can't tell an empty slot.
- Migration: `GameStepsSchema` drops saved steps of the creeper's hiss (no longer a hazard) and makes the removed armor-set helps netherite, since a profile that fails to load can't be used and a rebuilt store replaces such a Default profile (after backing it up as `default.corrupted-<time>.json`).

### Runs

- `GamesService.handle` is called from `registerConnectorEvents` next to the alerts, whatever features are on. It returns when Minecraft is off or in error.
- Matching is `matchesTrigger` and `streakOf` in `src/main/helper/triggers.ts`, shared with `AlertsService` (see `.claude/rules/alerts.md`). `GamesService` runs its own `GiftStreaks` once per event through `streakOf`; `{count}` is the streak's total.
- An action on **Every gift** runs once per gift added. A Like action runs once every `likes_every` likes from all viewers, counted per action in `_likes` with the rest carried over, as the countdown timer counts them.
- Gifts and likes are never capped (the user's call: every gift and like count runs).
- Each action has a FIFO backlog (`_backlogs`) of batches (one run's filled commands, `times` left) that `_pump` serves: one run's commands at once, then `RUN_GAP_MS` after their answers before the next run. A lone run goes out at once, and actions pump side by side.
- An action on any other trigger takes no new runs while its backlog holds `MAX_BACKLOG` (the `times` left of every batch, the one being sent included): `_queue` reports `full` and resolves the skipped batch at once.
- Before each run, `_pump` checks the latest `games` (given to `handle`, and to `setGames`, which `UPDATE_GAMES_SETTINGS` calls after a save and `SET_PROFILE` after a switch) and the game; its comments say when the rest drop. Filled commands stay as they were accepted.
- A game replaced midway by another of its edition fails only the commands it hadn't answered (`DISCONNECTED`), with no notice: the run counts as done and the backlog goes on in the new game.
- `handle` resolves once its own batches are served or dropped. `dispatchGames` isn't awaited, so a backlog never holds up other events.
- The connector's `DISCONNECTED` calls `clear` (`registerGames`), which forgets the streaks and the likes counted, not the backlogs.
- An action runs only while a game of its edition is connected (`GamesService._unreachable`): `handle` and `test` use the action's `edition`, and a game of the other edition counts as not connected.
- **Test** (`TEST_GAME_ACTION`, `notify: false`; the request carries `edition`) runs the steps once with `generateTikTokEventSample` (Emote uses Chat) and returns each command with the game's reply. It fails with no game, or with the other edition connected. Its reply carries the action's `id`, failures included; the page ignores other ids.

## Notices and logs

- Logs go to `games.log` (`Files.logs.games`); the feedback source is `games`. A status change is logged once, never per command.
- `registerGames` (`src/main/events/init.ts`) turns `GamesService.onError` into notices, and logs only when the notice goes out:
  - `GAME_NOT_CONNECTED`, key `game:minecraft:offline`, 60 s: an action ran while the toggle is on and no game of its edition is connected. It names the edition and its connect command;
  - `GAME_COMMAND_FAILED`, key `game:<action id>`, `REPEAT_NOTICE_MS`: the game refused a command, with its reply;
  - `GAME_BACKLOG_FULL`, key `game:<action id>:full`, `REPEAT_NOTICE_MS`: an action had `MAX_BACKLOG` runs waiting, so an event's were skipped.
- `GAME_ACTION_FAILED` reports an unexpected throw from `dispatchGames`. The toggle, the actions' autosave and Test send no success notices.

## Renderer

- `MinecraftSection` shows, until a game connects, both editions' setup side by side, with a command per address of this PC (`connectCommand(host, edition)`). The Java steps link to `MINECRAFT_MOD_DOCS_URL`, the website's `#java-edition` anchor: keep that heading there.
- Actions save through `useEditableSettings("games")`; the toggle emits `SET_GAMES_SETTINGS` at once.
- The trigger picker offers `GAME_TRIGGERS` (`helper.ts`): `TRIGGER_OPTIONS` without Super Fan Join, Member Join, Envelope, Super Fan Box and Music Change (the user's call). The schema still takes them, so an action saved with one keeps running, its picker empty until another is picked.
- `TriggerFilter` comes from `components/AlertItem`; gifts and emotes load as on Alerts, through `useTriggerChoices`. Like shows its own `likes_every` field in the filter's place.
- The trigger's `min_coins` and `roles` (the Alerts editor's conditions) aren't offered here; actions keep their defaults, which match everything.
- A new action takes the connected game's edition, else Bedrock (`Games/index.tsx`).
- `MOBS[edition]` and `ITEMS[edition]` (`helper.ts`) come from `src/common/games/minecraft-bedrock.json` and `minecraft-java.json` (`MINECRAFT_NAMES`, in common so main can name the overlay's rows). The `minecraft-lists` skill regenerates them.
- `withEdition(action, edition)` moves an action's mobs and items to the other edition's ids (`idIn`): the same id, else `PAIRS` (ids that differ and whose names differ too), else the id with the same English name (Bedrock's `web` is Java's `cobweb`), else a zombie or a diamond.
- **Test** results show the last `RESULTS_SHOWN`, so an earlier failure shows only in the summary (`testSummary`).

## Tests

- `minecraft.test.ts` plays the game with a real `ws` client on port 0. For Bedrock it does the client side of the handshake (the same `aes-256-cfb`), its three frames corked into one TCP chunk. For Java it offers `tokio.java.v1` and sends plain frames.
- It makes a port in use with a listen that has no host (macOS `SO_REUSEADDR`).
- The protocol facts were measured with a throwaway probe script run under Electron as Node (`ELECTRON_RUN_AS_NODE=1`, so BoringSSL), using `ws` from the repo, listening on 37892 and logging the upgrade headers, against the real game (Bedrock 1.26, GDK). Redo it that way when the game changes: unit tests can't catch a cipher or frame change.
- Real-game check: drive the built app (`drive-app`), `/connect` with **Require Encrypted WebSockets** left on, run each step kind, a bad command and a burst, then leave the world and come back. For Java, run the mod's dev client (`./gradlew runClient` in `../tokio-minecraft-mod`), `/tokio connect`, and use **Test** on a Java action.
