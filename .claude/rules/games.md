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
- A command with no answer fails after `timeoutMs`. A game that leaves or is replaced fails every pending command with `main.minecraft.disconnected` ("Minecraft disconnected.", in the app's language) and `dropped: true` on its `CommandResult`.
- `settled()` waits while a game is still in Bedrock's handshake, until it's ready or gone (`handshakeMs` or the socket's close end it). `send()` waits on it when a game is there but not ready, so the commands after a launch's `{ wait }` reach a game that took over. With no game it fails at once.

## Statuses

- `GameStatus` is `off` (disabled), `waiting` (listening with no game, also after the game leaves and during Bedrock's handshake), `connected` (after Bedrock's handshake, or as soon as Java joins; carries `edition`) or `error` (`error` is text for the user).
- `GamesService.onStatus` pushes `GAMES` (`app:games:res:games`) with the settings and `{ minecraft: status }` on every change.
- A failed listen at startup keeps the setting on and warns once (`GAME_LISTEN_FAILED`); the page shows the status.

## Actions and commands

- `Profile.games.actions` holds `GameActionSchema`. `edition` defaults to `"bedrock"`, so actions saved before Java are Bedrock's. The trigger is `TriggerSchema`, shared with alerts.
- `settings.games` (the connections' switches) is in the store, the same for every profile; the actions belong to the profile.
- `gameCommands(step, fill, edition)` (`commands.ts`) turns a step into commands in the edition's syntax: Java's ids take `minecraft:` and its `give` targets `@s`, Bedrock's `@p`. A mob or item id that isn't `/^[a-z0-9_]+$/` runs nothing.
- **Chicken Jockey** (`chicken_jockey`) is Tokio's own mob in both editions: `MINECRAFT_NAMES` adds it after Chicken to the generated lists (`withJockey`), so the picker, the overlay's name and `withEdition` have it. Java runs `summon minecraft:chicken ~ ~ ~ {Passengers:[{id:"minecraft:zombie",IsBaby:1b}]}`, a name as the baby zombie's `CustomName` (the mod's tests check these forms).
- **Java leaves the rest to the mod:** it keeps every mob Tokio's commands spawn, passengers included, from burning in daylight, and sets hostiles on the player once their 1-second grace is over (`GRACE_TICKS` in the mod's `Spawned`, the user's call). In the grace they attack no one: they appear at the player's feet, and a crowd's first hits could kill at once. Tokio sends nothing extra.
  - Bedrock has no grace: no command holds a mob back, so its hostiles hit as soon as they see the player.
  - The mod keeps what Tokio's commands make on the world's host alone (the user's call; the mod's `AGENTS.md`, "Only the host"). In a LAN world, no other player is targeted by its mobs, hurt or pushed by its blasts, lightning, evoker fangs or projectiles, or reached by its witches' potions or its dragons' breath. Only the host sees the meteors and lasers, their particles and sounds, and a super laser's night, which no longer changes the world's clock. Their particles follow the host's **Particles** setting.
  - Bedrock has no mod, so there its commands' mobs and blasts reach whoever is near.
- **One at a time:** the mobs of a Spawn mob step, and the Charged creeper hazard's, come `SPAWN_GAP_MS` (250 ms) apart: `spaced` puts a `{ wait }` between each mob's commands (the user's request). A run of 100 takes about 25 s, which holds the action's next run and Test meanwhile. Lightning and evoker fangs still strike at once.
- **Bedrock** does it with commands (`bedrockMob`, one mob's), checked against bedrock-samples' `mojang-commands.json` and `behavior_pack/entities`. What follows a summon goes to `@e[type=<mob>,r=2,c=1]`, the one just summoned at the player's feet, before it moves:
  - A jockey is `summon zombie ~ ~ ~ 0 0 minecraft:as_baby [name]`, then `ride @e[type=zombie,r=2,c=1] summon_ride chicken no_ride_change minecraft:spawn_adult`. Summoning the rider leaves chickens already nearby alone; `spawn_adult` because a baby chicken has no seat (its `rideable` is in `chicken_adult`, for `baby_undead` only).
  - Mobs with `minecraft:burns_in_daylight` (`DAYLIGHT_BURNERS`, without the fire-immune magma cube; the jockey's zombie counts) then get `effect @e[type=<mob>,r=2,c=1] fire_resistance infinite 0 true`.
  - `ANGER_EVENTS` are the spawn events that set a neutral hostile on the player, passed as summon's event (a name goes after it). Only the cave spider's `minecraft:become_angry` adds a player target. The zombie pigman's and enderman's anger has no target until hit, the spider's `become_hostile` ends in daylight (its brightness sensor), and piglins and brutes already attack. A spawn event replaces `minecraft:entity_spawned`, so it's no use where that sets the mob up (the zombie pigman's adult group).
- Variables are `ALERT_MESSAGE_VARIABLES` per trigger, filled by `formatAlertMessage(text, payload, commandValue)`. `commandValue` strips `" ' \ { } [ ] § @` and control characters, so a nickname can't inject NBT or selectors. A spawn name goes through it whole, then `JSON.stringify`. The command step's template is the user's own and isn't escaped.

### Hazards and helps

- Hazard steps (`GAME_HAZARDS`, named by `HAZARD_NAMES`) are built-in ways to try to kill or prank the player, with fixed commands per edition in `hazardCommands`.
- They were checked against Java 26.3's command tree and registries and Bedrock's `mojang-commands.json` (bedrock-samples). They carry no NBT but the creeper's and the fuse. Block ids go through `block(java, id)`, which adds Java's `minecraft:`.
- The charged creeper uses Bedrock's `minecraft:become_charged` spawn event and Java's `powered`. Evoker fangs are Bedrock's `evocation_fang`.
- Only `REPEATED_HAZARDS` (lightning, charged creeper, evoker fangs) repeat by the amount. The rest run once (the user's call for TNT), the traps, the lava lake, the hole and Clear inventory included. `COUNTED_HAZARDS`, the repeated ones plus the meteor, show the amount in the editor and count it in the overlay's name ("Meteor ×5").
- **The Tokio mod's own commands** (Java only, sent without a slash, run as the host): the meteor (`tokio meteor <amount>`, one command: the mod drops them all around the player), the laser, super laser and super duper laser (`tokio laser`, `tokio laser super`, `tokio laser super duper`), and two step kinds, **Turn into mob** (`morph`: `tokio morph minecraft:<mob>` plus its `seconds`, 1–600, or `null` until turned back, the default, the user's call) and **Back to normal** (`unmorph`: `tokio unmorph`). They run nothing on Bedrock. While a timed morph runs, the mod makes new ones wait their turn, and an unmorph drops them; a death keeps the morph for the respawn, its time held while the player is dead (the user's calls). A morphed host also gets the mob's own attack on the mod's attack key, R by default (the mod's `AGENTS.md`, "Attacks"); Tokio sends nothing for it, and nothing it fires hurts a player. `JAVA_ONLY_STEPS` and `JAVA_ONLY_HAZARDS` (`src/common/util/games.ts`) say which they are; the overlay names a morph "{mob} form", the mob in English.
- **Fuse** (the TNT's, in seconds): Java's `fuse` in ticks. Bedrock's TNT can't take one: it burns 4 s, or 0.5–2 s at random with its `from_explosion` event, used at 2 s or less. The page says which next to the field on Bedrock actions.
- **Anvil:** `setblock ~ ~20 ~ anvil keep`, because Bedrock can't summon a falling block. It never replaces a block, fails when there's no room, and the anvil stays in the world. Java 26.3 schedules a setblock'd anvil's fall unless the mode is `strict`.
- **Launch:** `launchPlan(height, seconds)` plays Java's physics (speed eases toward 0.05 × level by a fifth a tick, 2% drag, gravity 0.08 after the push) to find the weakest levitation level that gets there within `seconds`, up to `MAX_LEVEL` (amplifier 255, the command's most; Java 26.3 sends it as a VarInt), and when to stop.
- Its commands are the effect, a `{ wait }` and `teleport ~ ~ ~`, which zeroes the climb's speed in Java 26.3 (`TeleportCommand` sends no `DELTA` relatives), so the fall starts at the top instead of drifting up on momentum.
- The stop is never before the push ends, which would lift the player again. Past the top level's reach (about 190 blocks in 1 s) the climb goes on on momentum and stops when it gets there. Bedrock's levitation may differ.
- Before the effect, both launches clear the way up (`clearUp`): the 3×3 column from 2 over the feet to `height + 2`, where the head is at the top, set to air in fills of `SHAFT_ROWS` (32) rows. Air fills drop nothing (replace mode), and take bedrock too, so from under the Nether's roof the player goes through it: neither edition's `fill` filter can leave a block out.
- A fill with a corner past the world's top fails whole, in both editions, so only the pieces up there fail (2 failures each). The player's height is unknown to Tokio.
- **`sureFill`:** both editions refuse a fill that changes nothing (Java's "No blocks were filled", Bedrock's `commands.fill.failed`), as under an open sky or over a trap already there. So each fill comes after `setblock <cell> structure_void`, on a cell the fill writes; a keep fill, which writes only air, gets the cell set back to air before it. The cell is on the fill's farthest row, so a fill out of the world fails with its marker and leaves none behind.
- **Cobweb trap:** webs (Bedrock's `web`) into the air of the 3×3×3 around the player, their own cells included (`keep`), the marker on their head's cell.
- **Honey trap** and **Obsidian prison:** a 5×5×5 `outline` around the 3×3 space they stand in, floor and roof included, what's inside left as it is. Honey can't be in the player's cells as webs are (they'd choke), so its floor slows them and stops their jumps. Both replace what's in the shell, without drops.
- **Lava lake:** the ground ring 2 blocks wide around the player (`~-1`, 5×5) turns to lava, and the block under them to obsidian, an island. They jump the ring or build off it; falling in sets them on fire. Filling the island too means a lake already there still changes.
- **Hole below:** air from the feet's own row (slabs, carpets) down `depth` blocks (1–64, default 10), 3×3 so any player falls. Both commands are `execute unless block ~ ~-<depth> ~ bedrock run …`, so a hole whose bottom is the world's floor (always bedrock at its lowest layer) digs nothing and never opens the void; one past the world's bottom fails whole. The End has no floor, so a hole deeper than an island opens onto the void.
- **Clear inventory:** both editions refuse to clear an empty inventory, so a stick goes into the first hotbar slot first (`item replace entity @s hotbar.0` / `replaceitem entity @p slot.hotbar 0`), then `clear`.
- The new forms were checked against Java 26.3's `FillCommand`, `SetBlockCommand` and `BlockPosArgument` (Vineflower), Bedrock's `mojang-commands.json` (fill's modes, `execute unless block`, `replaceitem` slots, the `web`, `honey_block`, `structure_void` ids) and `en_US.lang` (fill's failure messages), and the Java forms run in the mod's `CommandRunnerTest`, each twice in a row.
- **Random boss** (`random_boss`): one of `BOSSES` (the Warden, the Wither, a Ravager, an Evoker; Bedrock's `evocation_illager`), summoned where the player stands. A summoned Ender Dragon is left out: its fight origin defaults to `0,0,0`, so it circles the world's center and only goes after players near it. An Elder Guardian can't move on land.
  - On Java, the mod's host-only rule doesn't reach all of them: an Evoker's vexes come after the command, so they aren't tagged and can go after LAN guests, and a Ravager's roar hurts and pushes whoever is around it.
- **Waits and picks:** `gameCommands` returns `GameCommand`s: a command, `{ wait: ms }`, `{ mayFail: command }` or `{ oneOf: commands }`. `GamesService._send` sends the commands up to a wait at once, then waits for their answers and the time before the rest, so a launch holds its action's next run, and Test, until it stops. A wait has no result.
  - A batch keeps one run's commands and repeats them `times`, so `_send` picks a `oneOf`'s command at random each time it sends: each run of a streak gets its own boss, and so does each Test.
  - A `mayFail` whose game answers with a failure counts as done (`ok: true`, the game's message kept), so it sends no notice and Test shows ✓. A `dropped` one (the game left) still fails.
- **Help steps** (`GAME_HELPS`, named by `HELP_NAMES`, `helpCommands`): netherite armor, the Netherite kit, a full heal and potion effects at the levels in `HELP_EFFECTS`. Every id is in both editions' lists, Java 26.3's registries and Bedrock's command enums.
- **Netherite kit** (`netherite_kit`): the Netherite armor help's commands, then gives of `NETHERITE_KIT` (`src/common/util/games.ts`): a netherite sword, a bow, 64 arrows (on Java the bow has Infinity, but a plain Bedrock bow needs them), a netherite pickaxe and a netherite axe. On Java it's all always enchanted (the user's request), whatever `enchanted` says.
- **Replacing yours** (`replace`, on Give item and the kit): each give comes after `{ mayFail: "clear @s minecraft:<item>" }` (Bedrock's `clear @p <item>`), which takes all of the player's own of that item first, enchanted or not, so gifts don't fill the inventory. Both editions fail a clear that finds none (Java 26.3's `ClearInventoryCommands` throws), hence `mayFail`. The mod's `CommandRunnerTest` runs the Java forms. On armor it takes the worn piece too, and the new one goes to the inventory.
- The armor is put on at once over whatever the player wears, which is lost (the user's call): Java's `item replace entity @s armor.<slot> with`, Bedrock's `replaceitem entity @p slot.armor.<slot> 0`. Only `replace` works: the Java mod counts an `execute if` that runs nothing as failed, and Bedrock can't tell an empty slot.
- **Enchanted** (Java only): Give item and the Netherite armor help take `enchanted` (false by default; the kit is always enchanted). `bestEnchantments(...items)` (`src/common/games/enchantments.ts`) gives every enchantment the items take in Java 26.3, curses aside, at its highest level, in the order the game's tooltips list them (`#tooltip_order`). Where two can't go together, Protection, Depth Strider, Infinity (so the bow has no Mending), Multishot, Sharpness, Density, Fortune and Loyalty stay.
  - It was checked against Java 26.3's `data/minecraft/enchantment`, `tags/item/enchantable` and `tags/enchantment/exclusive_set`: all 92 items the game lets take an enchantment. Items that take none, or only curses, give plain.
  - The commands carry them as the item's `enchantments` component, a map of levels since 1.21.5: `give @s minecraft:netherite_sword[enchantments={sharpness:5,…}] 1`, `item replace entity @s armor.feet with minecraft:netherite_boots[enchantments={…}]`. The mod's `CommandRunnerTest` runs both.
  - Bedrock can't: its `give` and `replaceitem` take no enchantments (only `can_place_on`-style components), and its `enchant` works only on the item in the player's hand. Its actions give plain items, and keep the field for a switch back to Java.
- Migration: `GameStepsSchema` drops saved steps of the creeper's hiss (no longer a hazard) and makes the removed armor-set helps netherite, since a profile that fails to load can't be used and a rebuilt store replaces such a Default profile (after backing it up as `default.corrupted-<time>.json`).

### Runs

- `GamesService.handle` is called from `registerConnectorEvents` next to the alerts, whatever features are on. It returns when Minecraft is off or in error.
- Matching is `matchesTrigger` and `streakOf` in `src/main/helper/triggers.ts`, shared with `AlertsService` (see `.claude/rules/alerts.md`). `GamesService` runs its own `GiftStreaks` once per event through `streakOf`; `{count}` is the streak's total.
- An action on **Every gift** runs once per gift added. A Like action runs once every `likes_every` likes from all viewers, counted per action in `_likes` with the rest carried over, as the countdown timer counts them.
- Gifts and likes are never capped (the user's call: every gift and like count runs).
- Each action has a FIFO backlog (`_backlogs`) of batches (one run's filled commands, `times` left) that `_pump` serves: one run's commands at once, then `RUN_GAP_MS` after their answers before the next run. A lone run goes out at once, and actions pump side by side.
- An action on any other trigger takes no new runs while its backlog holds `MAX_BACKLOG` (the `times` left of every batch, the one being sent included): `_queue` reports `full` and resolves the skipped batch at once.
- Before each run, `_pump` checks the latest `games` (given to `handle`, and to `setGames`, which `UPDATE_GAMES_SETTINGS` calls after a save and `SET_PROFILE` after a switch) and the game; its comments say when the rest drop. Filled commands stay as they were accepted.
- A game replaced midway by another of its edition fails only the commands it hadn't answered (`dropped`), with no notice: the run counts as done and the backlog goes on in the new game.
- `_pump` awaits `settled()` after a dropped run and before each run. So a Bedrock game still in its handshake, or one that took over between runs, gets the backlog once it's ready. A run that comes during a first connect's handshake waits for it too.
- `handle` resolves once its own batches are served or dropped. `dispatchGames` isn't awaited, so a backlog never holds up other events.
- The connector's `DISCONNECTED` calls `clear` (`registerGames`), which forgets the streaks and the likes counted, not the backlogs.
- An action runs only while a game of its edition is connected (`GamesService._unreachable`): `handle` and `test` use the action's `edition`, and a game of the other edition counts as not connected.
- **Test** (`TEST_GAME_ACTION`, `notify: false`; the request carries `edition`) runs the steps once with `generateTikTokEventSample` (Emote uses Chat) and returns each command with the game's reply. It fails with no game, or with the other edition connected. Its reply carries the action's `id`, failures included; the page ignores other ids.

## Notices and logs

- Logs go to `games.log` (`Files.logs.games`); the feedback source is `games`. A status change is logged once, never per command. `MinecraftConnection.onStatus` passes an English `cause` with an error status (the listen error's `formatError`), and `GamesService` logs it, never the translated `status.error`.
- `registerGames` (`src/main/events/init.ts`) turns `GamesService.onError` into notices, and logs only when the notice goes out:
  - `GAME_NOT_CONNECTED`, key `game:minecraft:offline`, 60 s: an action ran while the toggle is on and no game of its edition is connected. It names the edition and its connect command (`MINECRAFT_CONNECT_COMMANDS`, `src/common/types/games.ts`);
  - `GAME_COMMAND_FAILED`, key `game:<action id>`, `REPEAT_NOTICE_MS`: the game refused a command, with its reply;
  - `GAME_BACKLOG_FULL`, key `game:<action id>:full`, `REPEAT_NOTICE_MS`: an action had `MAX_BACKLOG` runs waiting, so an event's were skipped.
- `GAME_ACTION_FAILED` reports an unexpected throw from `dispatchGames`. The toggle, the actions' autosave and Test send no success notices.

## Renderer

- `MinecraftSection` shows, until a game connects, both editions' setup side by side, with a command per address of this PC (`connectCommand(host, edition)`, from `MINECRAFT_CONNECT_COMMANDS` like the notice's). The Java steps link to `MINECRAFT_MOD_DOCS_URL`, the website's `#java-edition` anchor: keep that heading there.
- Actions save through `useEditableSettings("games")`; the toggle emits `SET_GAMES_SETTINGS` at once.
- The trigger picker offers `GAME_TRIGGERS` (`helper.ts`): `TRIGGER_OPTIONS` without Super Fan join, Member join, Envelope, Super Fan Box and Music change (the user's call). The schema still takes them, so an action saved with one keeps running, its picker empty until another is picked.
- `TriggerFilter` comes from `components/AlertItem`; gifts and emotes load as on Alerts, through `useTriggerChoices`. Like shows its own `likes_every` field in the filter's place.
- The trigger's `min_coins` and `roles` (the Alerts editor's conditions) aren't offered here; actions keep their defaults, which match everything.
- **Actions** shows one edition at a time, in `Tabs` of `EDITIONS`. It opens on the connected game's edition, else on Bedrock unless only Java has actions: the page remounts it for each profile loaded (`key={loads}`, from `useEditableSettings`' `switched`). It turns to a game's edition when one connects (`connected`); a game that leaves keeps the tab. A new action takes the tab's edition, and an action whose edition picker changes takes the tab with it, so it stays in view.
- Its title is the button that folds it, like an accordion (`aria-expanded` inside the heading, the test results' chevron), so the overlay gets the room. The body is `hidden`, so the actions keep their state; it opens again on each visit and profile.
- Its one **Add action** button sits under the tab's actions, in the body, so it folds with them. The header has none (the user's call).
- `MOBS[edition]` and `ITEMS[edition]` (`helper.ts`) come from `src/common/games/minecraft-bedrock.json` and `minecraft-java.json` (`MINECRAFT_NAMES`, in common so main can name the overlay's rows). The `minecraft-lists` skill regenerates them.
- `withEdition(action, edition)` moves an action's mobs and items to the other edition's ids (`idIn`): the same id, else `PAIRS` (ids that differ and whose names differ too), else the id with the same English name (Bedrock's `web` is Java's `cobweb`), else a zombie or a diamond.
- To Bedrock, it also drops the morph and unmorph steps and gives each Tokio mod hazard its stand-in in `JAVA_ONLY_HAZARDS` (the meteor Falling TNT, the lasers lightning), keeping the step's other fields (the user's call).
- On Java actions, a Give item step whose item takes enchantments and the Netherite armor help show an **enchanted** `Check`. Checked, what it adds shows on a line of its own under the step, which also describes the box: `enchantmentsText`, the game's names (the four pieces' between them for the armor).
- Give item and the Netherite kit show a **replacing yours** `Check` in both editions. The kit has no box for its enchantments: on Java its line (`NETHERITE_KIT_ITEMS` between them) always shows. Neither has a duration.
- The step kind and hazard pickers (`STEP_KINDS[edition]`, `HAZARDS[edition]`) offer the Tokio mod's only on Java actions. Turn into mob lists `MORPH_MOBS`: Java's mobs without what summons but isn't a living mob (`NOT_MOBS`: TNT, lightning bolt, end crystal, experience orb, firework rocket) and the chicken jockey.
- **Test** results show the last `RESULTS_SHOWN`, so an earlier failure shows only in the summary (`testSummary`).

## Tests

- `minecraft.test.ts` plays the game with a real `ws` client on port 0. For Bedrock it does the client side of the handshake (the same `aes-256-cfb`), its three frames corked into one TCP chunk. For Java it offers `tokio.java.v1` and sends plain frames.
- It makes a port in use with a listen that has no host (macOS `SO_REUSEADDR`).
- The protocol facts were measured with a throwaway probe script run under Electron as Node (`ELECTRON_RUN_AS_NODE=1`, so BoringSSL), using `ws` from the repo, listening on 37892 and logging the upgrade headers, against the real game (Bedrock 1.26, GDK). Redo it that way when the game changes: unit tests can't catch a cipher or frame change.
- Real-game check: drive the built app (`drive-app`), `/connect` with **Require Encrypted WebSockets** left on, run each step kind, a bad command and a burst, then leave the world and come back. For Java, run the mod's dev client (`./gradlew runClient` in `../tokio-minecraft-mod`), `/tokio connect`, and use **Test** on a Java action.
