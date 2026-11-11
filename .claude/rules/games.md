---
paths:
  - "src/main/services/games/**"
  - "src/main/events/pages/games*"
  - "src/renderer/src/pages/Games/index*"
  - "src/renderer/src/pages/Games/helper*"
  - "src/renderer/src/pages/Games/sections/ActionsSection*"
  - "src/renderer/src/pages/Games/sections/MinecraftSection*"
  - "src/common/types/games.ts"
  - "src/common/util/games.ts"
---

# Games

The **Games** page connects Minecraft to Tokio: Bedrock Edition by itself, Java Edition through the Tokio mod (see "Minecraft mod repo" in `AGENTS.md`). A game action is an Alerts-style trigger plus steps that run Minecraft commands, for one edition. The overlay and the pictures library are in `.claude/rules/games-overlay.md`.

## Connection

- `MinecraftConnection` (`services/games/minecraft.ts`) is one `ws` server on `MINECRAFT_PORT` (`NOTE: DO NOT CHANGE`: players type it) for both editions.
- **Bedrock** joins with `/connect <address>:37892` in a world with cheats on, after **Settings → General → Network settings → Enable WebSockets**.
- **Java** joins with `/tokio connect [<address>:37892]` (alone, `localhost`) from the mod: Fabric, Minecraft 26.3, single-player and LAN worlds the player hosts, no cheats. The mod runs commands as the host at command-block permission, hides their feedback, never reconnects by itself and shows Tokio's close reason in chat.
- `handleProtocols` selects `MINECRAFT_JAVA_PROTOCOL` (`NOTE: DO NOT CHANGE`) when offered, else the first offered; `socket.protocol` tells the edition. With **Require Encrypted WebSockets** on (the game's default), Bedrock offers `com.microsoft.minecraft.wsencrypt` and `ws` must echo it back.
- The server binds no host, so each of this PC's addresses (`GET_NETWORK_ADDRESSES`) works from this PC and from other devices.
- It listens only while `settings.games.minecraft.enabled` is on (off by default): the constructor opens nothing, `configure` (startup and `SET_GAMES_SETTINGS`) does.
- `verifyClient` refuses any upgrade with an `Origin` header: browsers always send one and the game never does, so web pages can't take the socket. This is the exception to "no Origin checks".
- One game at a time: a new one of either edition replaces the old, closed with 4000 "Another game connected to Tokio.". Turning Minecraft off closes it with 1001 "Minecraft was turned off in Tokio." and `_stop` doesn't wait for the server's close, which waits on every socket (up to `ws`'s 30 s for a game that never answers).
- The server and each socket handle `error`: a bad frame would throw in main.

## Protocol

Measured against the real game (see Tests); unit tests can't re-derive these. The mod's side is `../tokio-minecraft-mod/PROTOCOL.md`: change both together.

- Java has no encryption: it counts as connected when the socket opens, and the same `commandRequest` / `commandResponse` frames go as plain text (`statusCode` 0 ok, -1 failed).
- The mod reads only `header.requestId` and `body.commandLine`, answers a Bedrock `enableencryption` with -1 ("Update Tokio to use the Java mod."), and fails a command while the host isn't in the world.

The rest is Bedrock's:

- Tokio sends a `commandRequest` (header `version: 1`, a `requestId`) with `enableencryption "<publicKey>" "<salt>" cfb`: ECDH `secp384r1`, public keys as base64 SPKI DER (`SPKI_PREFIX` plus the raw point), a 16-byte salt, key = SHA-256(salt + secret), IV = key[0..16].
- The game answers in three frames: `ws:encrypt` (text, with `publicKey`), a text `commandResponse` with `publicKey`, then an encrypted binary `commandResponse` `{ statusCode: 0 }`.
- Set the keys in the message handler, never after an `await`: the third frame can come in the same chunk, and a missed frame desyncs the stream for good.
- Then binary frames are encrypted and text frames plain, both ways. "Too many commands" errors stay plain text.
- The mode is `aes-256-cfb`, not `cfb8`: Electron's BoringSSL has no `aes-256-cfb8` while Node's OpenSSL (Vitest) does, so only Electron proves the handshake.
- No answer within `handshakeMs` means the player turned encryption off: commands go as plain text.
- Commands: body `version: 42` (1 fails on `execute … run`), `commandLine`, `origin: { type: "player" }`. They run as the connected player, so `~` is where they stand.
- A reply is a `commandResponse` or an `error`; `statusCode >= 0` is ok. Replies are in the game's language (`statusMessage`, or `message`, or nothing).
- The game allows 100 commands in flight. Tokio keeps `MAX_IN_FLIGHT` in flight and `MAX_WAITING` waiting and fails the rest; `MAX_WAITING` is only a safety net, since `GamesService` paces runs.
- A command with no answer fails after `timeoutMs`. A game that leaves or is replaced fails every pending command with `main.minecraft.disconnected` and `dropped: true`.
- `settled()` waits while a game is in Bedrock's handshake, until it's ready or gone. `send()` waits on it when a game is there but not ready, so the commands after a launch's `{ wait }` reach a game that took over. With no game it fails at once.

## Statuses

- `GameStatus` is `off`, `waiting` (no game, also after one leaves and during Bedrock's handshake), `connected` (with `edition`) or `error` (text for the user). `onStatus` pushes `GAMES` on every change.
- A failed listen at startup keeps the setting on and warns once (`GAME_LISTEN_FAILED`); the page shows the status.

## Actions and commands

- `Profile.games.actions` holds `GameActionSchema`; its trigger is `TriggerSchema`, shared with alerts. `edition` defaults to `"bedrock"`, so actions saved before Java are Bedrock's.
- `settings.games` (the connections' switches) is in the store, the same for every profile; the actions belong to the profile.
- `gameCommands(step, fill, edition)` (`commands.ts`) writes the edition's syntax: Java's ids take `minecraft:` and its `give` targets `@s`, Bedrock's `@p`. A mob or item id that isn't `/^[a-z0-9_]+$/` runs nothing.
- **Chicken Jockey** (`chicken_jockey`) is Tokio's own mob: `withJockey` adds it after Chicken in `MINECRAFT_NAMES`, so the picker, the overlay and `withEdition` know it. Java runs `summon minecraft:chicken ~ ~ ~ {Passengers:[{id:"minecraft:zombie",IsBaby:1b}]}`, a name as the zombie's `CustomName` (the mod's tests check these forms).
- On Java the mod keeps every mob Tokio spawns, passengers included, from burning in daylight, and sets hostiles on the player after a 1-second grace (`GRACE_TICKS` in the mod's `Spawned`, the user's call): they spawn at the player's feet, and a crowd's first hits could kill at once. Tokio sends nothing for it. Bedrock has no grace: no command holds a mob back.
- The mod keeps what Tokio's commands make on the host alone (the user's call; the mod's `AGENTS.md`, "Only the host"): in a LAN world its mobs, blasts, lightning, fangs, projectiles, potions and dragon breath reach no other player, and only the host sees the meteors, lasers and a super laser's night (which leaves the world's clock alone), their particles following the host's **Particles** setting. On Bedrock they reach whoever is near.
- The mobs of a Spawn mob step, and the Charged creeper's, come `SPAWN_GAP_MS` (250 ms) apart (`spaced`, the user's request): 100 take about 25 s, which holds the action's next run and Test. Lightning and evoker fangs still strike at once.
- **Bedrock** mobs (`bedrockMob`), checked against bedrock-samples' `mojang-commands.json` and `behavior_pack/entities`. What follows a summon targets `@e[type=<mob>,r=2,c=1]`, the one just summoned, before it moves:
  - A jockey is `summon zombie ~ ~ ~ 0 0 minecraft:as_baby [name]`, then `ride @e[type=zombie,r=2,c=1] summon_ride chicken no_ride_change minecraft:spawn_adult`. Summoning the rider leaves nearby chickens alone; `spawn_adult` because a baby chicken has no seat (`rideable` is in `chicken_adult`, for `baby_undead` only).
  - `DAYLIGHT_BURNERS` (mobs with `minecraft:burns_in_daylight`, minus the fire-immune magma cube; the jockey's zombie counts) get `effect … fire_resistance infinite 0 true`.
  - `ANGER_EVENTS` are spawn events that set a neutral mob on the player, passed as summon's event (a name goes after it). Only the cave spider's `minecraft:become_angry` adds a player target: the zombie pigman's and enderman's anger has none until hit, the spider's `become_hostile` ends in daylight, piglins and brutes already attack. A spawn event replaces `minecraft:entity_spawned`, so it's no use where that sets the mob up (the zombie pigman's adult group).
- Variables are the trigger's `countedVariables` (`.claude/rules/alerts.md`), filled by `formatAlertMessage(text, payload, commandValue)`. `commandValue` strips `" ' \ { } [ ] § @ *` and control characters so a nickname can't inject NBT or selectors, nor name every score holder (`*`, which stripping alone makes of `[*]`); a spawn name goes through it whole, then `JSON.stringify`. The command step's template is the user's own and isn't escaped.

### Hazards and helps

Checked against Java 26.3's command tree, registries and decompiled commands (Vineflower: `FillCommand`, `SetBlockCommand`, `BlockPosArgument`, `TeleportCommand`, `ClearInventoryCommands`), and Bedrock's `mojang-commands.json` and `en_US.lang`. The Java forms run in the mod's `CommandRunnerTest`, each twice in a row.

- `GAME_HAZARDS` (named by `HAZARD_NAMES`, commands in `hazardCommands`) try to kill or prank the player. They carry no NBT but the creeper's and the fuse. Block ids go through `block(java, id)`.
- The charged creeper is Bedrock's `minecraft:become_charged` spawn event and Java's `powered`. Evoker fangs are Bedrock's `evocation_fang`.
- Only `REPEATED_HAZARDS` (lightning, charged creeper, evoker fangs) repeat by the amount; the rest run once (the user's call for TNT). `COUNTED_HAZARDS`, those plus the meteor, show the amount in the editor and the overlay's name ("Meteor ×5").
- **The mod's own commands** (Java only, no slash, run as the host): `tokio meteor <amount>` (the mod drops them all around the player), `tokio laser`, `tokio laser super`, `tokio laser super duper`, and the steps **Turn into mob** (`morph`: `tokio morph minecraft:<mob>` with `seconds` 1–600, or `null` until turned back, the default, the user's call) and **Back to normal** (`unmorph`: `tokio unmorph`). `JAVA_ONLY_STEPS` and `JAVA_ONLY_HAZARDS` list them; they run nothing on Bedrock.
- While a timed morph runs, the mod makes new ones wait their turn and an unmorph drops them; a death keeps the morph for the respawn, its time held while dead (the user's calls). A morphed host fires the mob's attack on the mod's key, R by default (the mod's `AGENTS.md`, "Attacks"); Tokio sends nothing for it.
- **Fuse** (seconds): Java's `fuse` in ticks. Bedrock's TNT takes none: it burns 4 s, or 0.5–2 s at random with its `from_explosion` event, used at 2 s or less. The page says so on Bedrock actions.
- **Anvil:** `setblock ~ ~20 ~ anvil keep`, since Bedrock can't summon a falling block. It never replaces a block, fails with no room, and stays in the world. Java 26.3 schedules a setblock'd anvil's fall unless the mode is `strict`.
- **Launch:** `launchPlan(height, seconds)` plays Java's physics (speed eases toward 0.05 × level by a fifth a tick, 2% drag, gravity 0.08 after the push) to find the weakest levitation level that gets there within `seconds`, up to `MAX_LEVEL` (amplifier 255, sent as a VarInt), and when to stop.
  - Its commands are the effect, a `{ wait }` and `teleport ~ ~ ~`, which zeroes the climb's speed (`TeleportCommand` sends no `DELTA` relatives), so the fall starts at the top.
  - The stop is never before the push ends, which would lift the player again. Past the top level's reach (about 190 blocks in 1 s) the climb coasts and stops when it gets there. Bedrock's levitation may differ.
  - First `clearUp` sets to air the 3×3 column from 2 over the feet to `height + 2`, in fills of `SHAFT_ROWS` rows. Air fills drop nothing and take bedrock too, so under the Nether's roof the player goes through it: neither edition's `fill` filter can leave a block out.
  - A fill with a corner past the world's top fails whole, so only the pieces up there fail (2 failures each). Tokio doesn't know the player's height.
- **`sureFill`:** both editions refuse a fill that changes nothing (under open sky, over a trap already there). So each fill comes after `setblock <cell> structure_void` on a cell it writes; a keep fill, which writes only air, gets the cell set back to air first. The cell is on the farthest row, so a fill out of the world fails with its marker and leaves none.
- **Cobweb trap:** webs (Bedrock's `web`) into the air of the 3×3×3 around the player, their own cells included (`keep`), the marker on the head's cell.
- **Honey trap** and **Obsidian prison:** a 5×5×5 `outline` around the 3×3 space, floor and roof included, the inside left alone, the shell replaced without drops. Honey can't fill the player's cells (they'd choke), so its floor slows them and stops jumps.
- **Lava lake:** a 2-wide ground ring around the player (`~-1`, 5×5) turns to lava and the block under them to obsidian. Filling the island too means a lake already there still changes.
- **Hole below:** air from the feet's row (slabs, carpets) down `depth` blocks (1–64, default 10), 3×3 so any player falls. Both are `execute unless block ~ ~-<depth> ~ bedrock run …`, so a hole reaching the world's floor digs nothing and never opens the void; one past the bottom fails whole. The End has no floor, so a deep hole there opens onto the void.
- **Clear inventory:** both editions refuse to clear an empty inventory, so a stick goes in the first hotbar slot first (`item replace entity @s hotbar.0` / `replaceitem entity @p slot.hotbar 0`), then `clear`.
- **Random boss:** one of `BOSSES` (Warden, Wither, Ravager, Evoker; Bedrock's `evocation_illager`) at the player. No Ender Dragon: a summoned one circles `0,0,0` and only chases players near it. An Elder Guardian can't move on land. On Java the host-only rule misses an Evoker's vexes (spawned after the command, untagged) and a Ravager's roar.
- **Waits and picks:** `gameCommands` returns `GameCommand`s: a command, `{ wait: ms }`, `{ mayFail: command }` or `{ oneOf: commands }`. `_send` sends up to a wait, waits for the answers and the time, then the rest, so a launch holds its action's next run and Test. A wait has no result.
  - A batch repeats one run's commands `times`, so `_send` picks each `oneOf` at random as it sends: every run of a streak, and every Test, gets its own boss.
  - A `mayFail` the game fails counts as done (`ok: true`, the message kept): no notice, ✓ in Test. A `dropped` one still fails.
- `GAME_HELPS` (named by `HELP_NAMES`, commands in `helpCommands`): netherite armor, the Netherite kit, a full heal and effects at `HELP_EFFECTS`' levels. Every id is in both editions.
- **Netherite kit:** the armor's commands, then `NETHERITE_KIT`'s gives (64 arrows: Java's bow has Infinity, a plain Bedrock bow needs them). On Java it's always enchanted (the user's request).
- **Replacing yours** (`replace`, Give item and the kit): each give follows `{ mayFail: "clear @s minecraft:<item>" }` (Bedrock's `clear @p <item>`), taking all the player's own of that item, so gifts don't fill the inventory; both editions fail a clear that finds none. On armor it takes the worn piece too, and the new one goes to the inventory.
- Armor goes on at once over what the player wears, which is lost (the user's call): Java's `item replace entity @s armor.<slot> with`, Bedrock's `replaceitem entity @p slot.armor.<slot> 0`. Only replacing works: the mod counts an `execute if` that runs nothing as failed, and Bedrock can't tell an empty slot.
- **Enchanted** (Java only; Give item and the armor, false by default): `bestEnchantments(...items)` (`src/common/games/enchantments.ts`) gives every non-curse enchantment the items take, at its top level, in `#tooltip_order`. Of exclusive ones, Protection, Depth Strider, Infinity (so no Mending on the bow), Multishot, Sharpness, Density, Fortune and Loyalty stay.
  - Checked against Java 26.3's `data/minecraft/enchantment`, `tags/item/enchantable` and `tags/enchantment/exclusive_set`: all 92 enchantable items. Items that take none, or only curses, give plain.
  - They go as the `enchantments` component, a map of levels since 1.21.5: `give @s minecraft:netherite_sword[enchantments={sharpness:5,…}] 1`.
  - Bedrock can't: `give` and `replaceitem` take no enchantments and `enchant` works only on the held item. Its actions give plain items and keep the field for a switch back to Java.
- Migration: `GameStepsSchema` drops saved creeper's hiss steps and makes the removed armor-set helps netherite, since a profile that fails to load can't be used and a rebuilt store replaces such a Default profile.

### Runs

- `registerConnectorEvents` calls `GamesService.handle` next to the alerts, whatever features are on. It returns when Minecraft is off or in error.
- Matching is `matchesTrigger` and `streakOf` (`.claude/rules/alerts.md`). `GamesService` keeps its own `GiftStreaks`, used once per event; `{count}` is the streak's total.
- **Every gift** runs once per gift added. A Like action runs once every `likes_every` likes from all viewers, counted per action in `_likes` with the rest carried over, as the timer does.
- Gifts and likes are never capped (the user's call: every gift and like count runs).
- Each action has a FIFO backlog (`_backlogs`) of batches (one run's filled commands, `times` left) that `_pump` serves one run at a time, `RUN_GAP_MS` after the answers. A lone run goes out at once; actions pump side by side.
- An action on any other trigger takes no new runs while its backlog holds `MAX_BACKLOG` runs (the one being sent included): `_queue` reports `full` and resolves the skipped batch.
- Before each run `_pump` checks the latest `games` and the game; its comments say when the rest drop. Filled commands stay as accepted. Whatever changes the active profile's games calls `setGames` (now `UPDATE_GAMES_SETTINGS` after a save and `SET_PROFILE`).
- A game replaced midway by one of its edition fails only the unanswered commands (`dropped`), with no notice: the run counts as done and the backlog goes on in the new game.
- `_pump` awaits `settled()` after a dropped run and before each run, so a game in its handshake, or one that took over, gets the backlog once ready.
- `handle` resolves once its own batches are served or dropped. `dispatchGames` isn't awaited, so a backlog never holds up other events.
- The connector's `DISCONNECTED` calls `clear`, which forgets streaks and counted likes, not backlogs.
- An action runs only while a game of its `edition` is connected (`_unreachable`); a game of the other edition counts as none, for `handle` and `test` alike. Mid-run too: `send(command, edition)` drops a command for the other edition's game, and `_send` stops there, without waiting out the rest of its waits.
- **Test** (`TEST_GAME_ACTION`, `notify: false`, carries `edition`) runs the steps once with `generateTikTokEventSample` (Emote uses Chat) and returns each command with the game's reply. It fails with no game or the other edition. The reply carries the action's `id`.

## Notices and logs

- Logs go to `Files.logs.games`; the source is `games`. A status change is logged once, never per command. An error status comes with an English `cause`, which `GamesService` logs, never the translated `status.error`.
- `registerGames` (`src/main/events/init.ts`) turns `onError` into notices:
  - `GAME_NOT_CONNECTED`, key `game:minecraft:offline`, 60 s: an action ran with the toggle on and no game of its edition. It names the edition and its command (`MINECRAFT_CONNECT_COMMANDS`, `src/common/types/games.ts`, also the page's).
  - `GAME_COMMAND_FAILED`, key `game:<action id>`, `REPEAT_NOTICE_MS`: the game refused a command.
  - `GAME_BACKLOG_FULL`, key `game:<action id>:full`, `REPEAT_NOTICE_MS`: an event's runs were skipped.
- `GAME_ACTION_FAILED` reports an unexpected throw from `dispatchGames`. The toggle, the autosave and Test send no success notices.

## Renderer

- The Java steps link to `MINECRAFT_MOD_DOCS_URL`, the website's `#java-edition` anchor: keep that heading there.
- The trigger picker offers `GAME_TRIGGERS`: `TRIGGER_OPTIONS` without Super Fan join, Member join, Envelope, Super Fan Box and Music change (the user's call). The schema still takes them, so an action saved with one keeps running.
- `TriggerFilter` and `useTriggerChoices` come from Alerts; Like shows `likes_every` in the filter's place. `min_coins` and `roles` aren't offered: actions keep defaults that match everything.
- **Actions** opens on the connected game's edition, else Bedrock unless only Java has actions, remounting per profile (`key={loads}`). It turns to a game's edition when one connects; one that leaves keeps the tab. An action whose edition changes takes the tab with it, so it stays in view.
- Its title folds it, so the overlay gets the room; the body is `hidden` so actions keep their state. Its one **Add action** sits in the body under the tab's actions, none in the header (the user's call).
- `MOBS` and `ITEMS` come from `src/common/games/minecraft-bedrock.json` and `minecraft-java.json` (`MINECRAFT_NAMES`, in common so main can name overlay rows). The `minecraft-lists` skill regenerates them.
- `withEdition(action, edition)` moves ids with `idIn`: the same id, else `PAIRS` (ids and names both differ), else the id with the same English name (Bedrock's `web` is Java's `cobweb`), else a zombie or a diamond. To Bedrock it drops morph and unmorph steps and swaps each mod hazard for its stand-in in `JAVA_ONLY_HAZARDS` (the meteor Falling TNT, the lasers lightning), keeping the step's other fields (the user's call).
- `STEP_KINDS[edition]` and `HAZARDS[edition]` offer the mod's only on Java. `MORPH_MOBS` is Java's mobs minus `NOT_MOBS`: what summons but isn't a living mob, and the chicken jockey.
- Test results show the last `RESULTS_SHOWN`, so an earlier failure shows only in `testSummary`.

## Tests

- `minecraft.test.ts` plays the game with a real `ws` client on port 0: for Bedrock the client side of the handshake (the same `aes-256-cfb`), its three frames corked into one TCP chunk; for Java `tokio.java.v1` and plain frames.
- It makes a port in use with a listen that has no host (macOS `SO_REUSEADDR`).
- The protocol was measured with a throwaway probe under Electron as Node (`ELECTRON_RUN_AS_NODE=1`, so BoringSSL), using the repo's `ws` on 37892 and logging the upgrade headers, against Bedrock 1.26 (GDK). Redo it when the game changes: unit tests can't catch a cipher or frame change.
- Real-game check: drive the built app (`drive-app`), `/connect` with **Require Encrypted WebSockets** on, run each step kind, a bad command and a burst, then leave the world and come back. For Java, run the mod's dev client (`./gradlew runClient` in `../tokio-minecraft-mod`), `/tokio connect`, and **Test** a Java action.
