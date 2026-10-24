---
paths:
  - "src/main/services/games/**"
  - "src/main/events/pages/games.ts"
  - "src/main/helper/triggers.ts"
  - "src/renderer/src/pages/Games/**"
  - "src/common/types/games.ts"
---

# Games

The **Games** page (`/games`, after Music) connects Minecraft to Tokio, Bedrock Edition by itself and Java Edition through the Tokio mod (`../tokio-minecraft-mod`, see "Minecraft mod repo" in `AGENTS.md`). Users make game actions: an Alerts-style trigger plus steps that run Minecraft commands, each action for one edition. The mod isn't published yet (it will be at `https://github.com/tokio-app/minecraft-mod/releases/latest`); the Games page links to its install steps on the website (`MINECRAFT_MOD_DOCS_URL`).

## Connection

- `MinecraftConnection` (`services/games/minecraft.ts`) is a `ws` server on `MINECRAFT_PORT` (37892, `NOTE: DO NOT CHANGE`, players type it), for both editions.
  - **Bedrock** connects with `/connect <this PC's address>:37892` from its chat, in a world with cheats on, after **Settings → General → Network settings → Enable WebSockets**.
  - **Java** connects with `/tokio connect <address>:37892` (`/tokio connect` alone is `localhost:37892`), from the Tokio mod: Fabric, Minecraft 26.3, single-player and LAN worlds the player hosts, no cheats (the mod runs commands as the host at command-block permission, and their feedback isn't shown in chat). The mod offers the subprotocol `MINECRAFT_JAVA_PROTOCOL` (`tokio.java.v1`, `NOTE: DO NOT CHANGE`); `handleProtocols` selects it when offered, otherwise the first offered (Bedrock's `wsencrypt`), and `socket.protocol` tells the edition. The mod never reconnects by itself and tells the player why a connection ended (Tokio's close reason).
  - The server has no host, so one command per address (`GET_NETWORK_ADDRESSES`) works from this PC and from another device; the page shows `localhost` only when the PC has no address.
- It listens only while `settings.games.minecraft.enabled` is on (off by default). `GamesService`'s constructor opens nothing; `configure` (startup and `SET_GAMES_SETTINGS`) turns it on or off.
- `verifyClient` refuses any upgrade with an `Origin` header: browsers always send one, the game never does, so web pages can't take the socket. This is the exception to "no Origin checks" on the overlay server.
- With **Require Encrypted WebSockets** on (the game's default) Bedrock offers the subprotocol `com.microsoft.minecraft.wsencrypt`. `ws` echoes it back; keep that.
- One game at a time: a new one, of either edition, replaces the old one, which is closed with 4000 "Another game connected to Tokio.". Turning Minecraft off closes it with 1001 "Minecraft was turned off in Tokio.". The Java mod shows those reasons in chat. `maxPayload` is 64 KiB. The server and each socket handle `error` (a bad frame would throw in main).

## Protocol

The Java mod's side is `../tokio-minecraft-mod/PROTOCOL.md`: change both together. Java skips Bedrock's encryption: no handshake, the game counts as connected as soon as the socket opens, and the same `commandRequest` / `commandResponse` frames go as plain text (`statusCode` 0 is ok, -1 failed). The mod reads only `header.requestId` and `body.commandLine` of a request, answers a Bedrock `enableencryption` line with -1 ("Update Tokio to use the Java mod."), and fails a command while the host isn't in the world. The rest of this section is Bedrock's.

- Tokio sends a `commandRequest` (header `version: 1`, a `requestId`) with `enableencryption "<publicKey>" "<salt>" cfb`: ECDH `secp384r1`, public keys as base64 SPKI DER (`SPKI_PREFIX` plus the raw point), a 16-byte salt, key = SHA-256(salt + secret), IV = key[0..16].
- The game answers in three frames: `ws:encrypt` (text, with `publicKey`), a text `commandResponse` with `publicKey`, then an encrypted binary `commandResponse` `{ statusCode: 0 }`. Set the keys in the message handler, never after an `await`: the third frame can arrive in the same chunk, and a missed frame desyncs the stream for good.
- After that, binary frames are encrypted and text frames plain, both ways. "Too many commands" errors come as plain text even after the handshake.
- The mode is `aes-256-cfb`, not `cfb8`: Electron's BoringSSL has no `aes-256-cfb8`, while Node's OpenSSL (Vitest) does, so only Electron itself proves the handshake.
- No answer within `handshakeMs` (5 s) means the player turned encryption off: commands go as plain text.
- Commands: body `version: 42` (1 fails on `execute … run`), `commandLine`, `origin: { type: "player" }`. They run as the connected player, so `~` is where they stand. A reply is a `commandResponse` or an `error`; `statusCode >= 0` is ok. Replies are in the game's language (`statusMessage`, or `message`, or nothing).
- Limits: the game allows 100 commands in flight; Tokio keeps 50 (`MAX_IN_FLIGHT`) and 500 waiting (`MAX_WAITING`), and fails the rest. A command with no answer fails after `timeoutMs` (10 s). A game that leaves fails every pending command with "Minecraft disconnected."

## Statuses

`GameStatus` is `off` (disabled), `waiting` (listening with no game, also after the game leaves and during Bedrock's handshake), `connected` (after Bedrock's handshake, or as soon as Java joins; carries `edition`, `"bedrock"` or `"java"`) or `error` (`error` is text for the user, like "Port 37892 is in use."). `GamesService.onStatus` pushes `GAMES` (`app:games:res:games`) with the settings and `{ minecraft: status }` on every change. A failed listen at startup keeps the setting on and warns once (`GAME_LISTEN_FAILED`); the page shows the status.

## Actions and commands

- `Profile.games.actions` holds `GameActionSchema` (`id`, `enabled`, `edition`, `trigger`, `steps`); `edition` defaults to `"bedrock"`, so actions saved before Java are Bedrock's; the trigger is `TriggerSchema`, shared with alerts. `settings.games` (the connections' switches) is in the store, the same for every profile; the actions belong to the profile.
- `gameCommands(step, fill, edition)` (`commands.ts`) turns a step into commands, spawn times `amount`:
  - Bedrock: `summon <mob>[ "<name>"] ~ ~ ~`, `give @p <item> <n>`;
  - Java: `summon minecraft:<mob> ~ ~ ~[ {CustomName:"<name>"}]`, `give @s minecraft:<item> <n>`;
  - both: `weather <w>`, `time set <t>`, and the command step's template, one leading `/` dropped.
  - Amounts are 1–100. A mob or item id that isn't `/^[a-z0-9_]+$/` runs nothing.
- Variables are `ALERT_MESSAGE_VARIABLES` per trigger, filled by `formatAlertMessage(text, payload, commandValue)`. `commandValue` strips `" ' \ { } [ ] § @` and control characters, collapses whitespace and caps at 100 characters, so a nickname can't inject NBT or selectors. A spawn name goes through it whole, then `JSON.stringify`. The command template is the user's own and isn't escaped.
- `GamesService.handle` (called from `registerConnectorEvents` next to the alerts, whatever features are on) returns when Minecraft is off or in error. It runs its own `GiftStreaks` once per event; `{count}` is the streak's total. An action on **Every gift** runs once per gift added, at most `MAX_REPEATS` (100), and an action sends at most `MAX_COMMANDS` (100) per event. Matching is `matchesTrigger` and `giftOf` in `src/main/helper/triggers.ts`, shared with `AlertsService` (see `.claude/rules/alerts.md`). `DISCONNECTED` calls `clear`.
- An action runs only while a game of its edition is connected (`GamesService._unreachable`): `handle` and `test` use the action's `edition`, and a game of the other edition counts as not connected.
- **Test** (`TEST_GAME_ACTION`, `notify: false`; the request carries `edition`) runs the steps once with `generateTikTokEventSample` (Emote uses Chat) and returns each command with the game's reply. It fails with "Turn on Minecraft and connect the game first." with no game, and "Connect Minecraft Java Edition first." (or Bedrock) when the other edition is connected. Its reply carries the action's `id`, failures included; the page ignores other ids.

## Notices and logs

- Logs go to `games.log` (`Files.logs.games`); the feedback source is `games`. A status change is logged once, never per command.
- `registerGames` (`src/main/events/init.ts`) turns `GamesService.onError` into notices, and logs only when the notice goes out:
  - `GAME_NOT_CONNECTED`, key `game:minecraft:offline`, 60 s: an action ran while the toggle is on and no game of its edition is connected. It names the edition: "Minecraft Java Edition isn't connected, so the X action didn't run. Type the /tokio connect command from Games in the game's chat." (Bedrock's says `/connect`);
  - `GAME_COMMAND_FAILED`, key `game:<action id>`, 30 s (`REPEAT_NOTICE_MS`): the game refused a command, with its reply.
- `GAME_ACTION_FAILED` reports an unexpected throw from `dispatchGames`. The toggle, the actions' autosave and Test send no success notices.

## Renderer

- `pages/Games`: `MinecraftSection` (toggle, status, then, until a game connects, the setup of both editions side by side: each edition's steps and a command per address of this PC, `connectCommand(host, edition)`, with copy buttons titled "Copy the Bedrock command" / "Copy the Java command" and a caret that blinks while waiting on each first one; the Java steps link to `MINECRAFT_MOD_DOCS_URL`, the website's `#java-edition` anchor, so keep that heading there) and `ActionsSection`. The status reads "Connected to Java Edition" or "Bedrock Edition" (`statusText`). `TriggerFilter` and `TRIGGER_OPTIONS` come from `components/AlertItem`; gifts and emotes load as on Alerts.
- An action's header has an **Edition** picker (`EDITIONS`) before its trigger, and a **Duplicate** button next to Test and Remove: the copy gets a new id and goes right after the original. A new action takes the connected game's edition, else Bedrock (`Games/index.tsx`).
- `MOBS[edition]` and `ITEMS[edition]` (`helper.ts`) come from `minecraft-bedrock.json` and `minecraft-java.json`, id → English name, sorted by name. `withEdition(action, edition)` moves an action's mobs and items to the other edition's ids (`idIn`): the same id, else `PAIRS` (ids that differ and whose names differ too: `ender_crystal`/`end_crystal`, the zombie pigman spawn egg, silver glazed terracotta, `undyed_shulker_box`/`shulker_box`), else the id with the same English name (Bedrock's `web` is Java's `cobweb`), else a zombie or a diamond. Add a pair when a regenerated list has an id no name matches. To regenerate the Bedrock list after a game update:
  - **Ids:** Mojang's `bedrock-samples` metadata: `metadata/vanilladata_modules/mojang-entities.json` and `mojang-items.json`, kept to the values of the `EntityType` and `Item` enums in `metadata/command_modules/mojang-commands.json` (what `summon` and `give` take).
  - **Left out:**
    - mobs: projectiles, boats and minecarts, the armor stand, `npc` and `cushion`;
    - items: command, structure, barrier, jigsaw and light blocks, and Education's `allow`, `deny` and `border_block`.
  - **Names:** the game's `en_US.lang`: `entity.<id>.name`, the item's `serialization_id`, `item.<id>.name` or `tile.<id>.name`, otherwise the id in title case. `tnt` is "Primed TNT".
  - **Check:** run every id in the game, with `testfor @e[type=<id>]` and `clear @p <id> 0 0`, which count without changing the world. An unknown id is a syntax error. The current list is 1.26.50, all 1,689 known.
  - **Java's ids differ for some:** Bedrock has `web` (Cobweb), `evocation_illager` (Evoker) and `zombie_pigman` (Zombified Piglin); `withEdition` maps them by name.
- To regenerate `minecraft-java.json` (the current list is 26.3: 95 mobs, 1,645 items), from Mojang's own data, with JDK 25:
  - **Ids:** download the version's server jar (`downloads.server.url` in its version JSON) and run `java -DbundlerMainClass=net.minecraft.data.Main -jar server.jar --reports --output generated` (in PowerShell quote the `-D…` argument). Read `generated/reports/registries.json`: `minecraft:entity_type` and `minecraft:item`.
  - **Names:** `assets/minecraft/lang/en_us.json` from the client jar: `entity.minecraft.<id>`, and for items `item.minecraft.<id>.new`, `item.minecraft.<id>` or `block.minecraft.<id>`. So no two items share a name, music discs are "Music Disc <song>" (from `item.minecraft.<id>.desc`, the part after " - ", capitalized), armor trims come from `trim_pattern.minecraft.<pattern>` and upgrades from `upgrade.minecraft.<id>`.
  - **Left out:** the same kinds as Bedrock's list: player, projectiles, boats and rafts, minecarts, armor stand, displays, marker, interaction, `area_effect_cloud`, `item`, `falling_block`, `leash_knot`, painting, item frames, `evoker_fangs`, `ominous_item_spawner`, `cushion`, `mannequin`; items: `air`, command blocks and their minecart, structure blocks and void, jigsaw, barrier, light, `debug_stick`, `test_block`, `test_instance_block`. Kept: `tnt` ("Primed TNT"), `lightning_bolt`, `end_crystal`, `firework_rocket`, `experience_orb`.
- Actions save through `useEditableSettings("games")`; the toggle emits `SET_GAMES_SETTINGS` at once.
- An action's **Test** results fold in a `<details>` under `testSummary` (how many commands ran or failed). It opens with the first results, and later tests keep a fold. The list shows the last 25 (`RESULTS_SHOWN`) of up to 100, so an earlier failure shows only in the summary.

## Tests

- `minecraft.test.ts` plays the game with a real `ws` client on port 0: it does the client side of Bedrock's handshake (the same `aes-256-cfb`, its three frames corked into one TCP chunk), plays the Java mod too (the `tokio.java.v1` subprotocol, plain frames), answers commands, and covers Origin, a port in use, the limits, drops, and one edition replacing the other. A port in use is made with a listen that has no host (macOS `SO_REUSEADDR`).
- `index.test.ts` and `commands.test.ts` test the service and the commands (both editions) with a stub connection. `Games/helper.test.ts` covers `withEdition` and the lists, `Games/index.test.tsx` the setup, the Edition picker and Duplicate.
- The protocol facts were measured with a throwaway probe script run under Electron as Node (`ELECTRON_RUN_AS_NODE=1`, so BoringSSL), using `ws` from the repo, listening on 37892 and logging the upgrade headers, against the real game (Bedrock 1.26, GDK). Redo it that way when the game changes: unit tests can't catch a cipher or frame change.
- Real-game check: drive the built app (`drive-app`), `/connect` with **Require Encrypted WebSockets** left on, run each step kind, a bad command and a burst, then leave the world and come back. For Java, run the mod's dev client (`./gradlew runClient` in `../tokio-minecraft-mod`), `/tokio connect`, and use **Test** on a Java action.
