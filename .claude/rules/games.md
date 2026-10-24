---
paths:
  - "src/main/services/games/**"
  - "src/main/events/pages/games.ts"
  - "src/main/helper/triggers.ts"
  - "src/renderer/src/pages/Games/**"
  - "src/common/types/games.ts"
---

# Games

The **Games** page (`/games`, after Music) connects Minecraft Bedrock to Tokio. Users make game actions: an Alerts-style trigger plus steps that run Minecraft commands. Bedrock only; the Java mod that would connect to the same port isn't built, so don't document Java as available.

## Connection

- `MinecraftConnection` (`services/games/minecraft.ts`) is a `ws` server on `MINECRAFT_PORT` (37892, `NOTE: DO NOT CHANGE`, players type it). The game connects to Tokio with `/connect localhost:37892` from its chat, in a world with cheats on, after **Settings → General → Network settings → Enable WebSockets**. Other devices use the PC's address (the server has no host; `GET_NETWORK_ADDRESSES` lists the addresses).
- It listens only while `settings.games.minecraft.enabled` is on (off by default). `GamesService`'s constructor opens nothing; `configure` (startup and `SET_GAMES_SETTINGS`) turns it on or off.
- `verifyClient` refuses any upgrade with an `Origin` header: browsers always send one, the game never does, so web pages can't take the socket. This is the exception to "no Origin checks" on the overlay server.
- With **Require Encrypted WebSockets** on (the game's default) the game offers the subprotocol `com.microsoft.minecraft.wsencrypt`. `ws` echoes it back; keep that.
- A new game replaces the old one. `maxPayload` is 64 KiB. The server and each socket handle `error` (a bad frame would throw in main).

## Protocol

- Tokio sends a `commandRequest` (header `version: 1`, a `requestId`) with `enableencryption "<publicKey>" "<salt>" cfb`: ECDH `secp384r1`, public keys as base64 SPKI DER (`SPKI_PREFIX` plus the raw point), a 16-byte salt, key = SHA-256(salt + secret), IV = key[0..16].
- The game answers in three frames: `ws:encrypt` (text, with `publicKey`), a text `commandResponse` with `publicKey`, then an encrypted binary `commandResponse` `{ statusCode: 0 }`. Set the keys in the message handler, never after an `await`: the third frame can arrive in the same chunk, and a missed frame desyncs the stream for good.
- After that, binary frames are encrypted and text frames plain, both ways. "Too many commands" errors come as plain text even after the handshake.
- The mode is `aes-256-cfb`, not `cfb8`: Electron's BoringSSL has no `aes-256-cfb8`, while Node's OpenSSL (Vitest) does, so only Electron itself proves the handshake.
- No answer within `handshakeMs` (5 s) means the player turned encryption off: commands go as plain text.
- Commands: body `version: 42` (1 fails on `execute … run`), `commandLine`, `origin: { type: "player" }`. They run as the connected player, so `~` is where they stand. A reply is a `commandResponse` or an `error`; `statusCode >= 0` is ok. Replies are in the game's language (`statusMessage`, or `message`, or nothing).
- Limits: the game allows 100 commands in flight; Tokio keeps 50 (`MAX_IN_FLIGHT`) and 500 waiting (`MAX_WAITING`), and fails the rest. A command with no answer fails after `timeoutMs` (10 s). A game that leaves fails every pending command with "Minecraft disconnected."

## Statuses

`GameStatus` is `off` (disabled), `waiting` (listening with no game, also after the game leaves), `connected` (after the handshake) or `error` (`error` is text for the user, like "Port 37892 is in use."). `GamesService.onStatus` pushes `GAMES` (`app:games:res:games`) with the settings and `{ minecraft: status }` on every change. A failed listen at startup keeps the setting on and warns once (`GAME_LISTEN_FAILED`); the page shows the status.

## Actions and commands

- `Profile.games.actions` holds `GameActionSchema` (`id`, `enabled`, `trigger`, `steps`); the trigger is `TriggerSchema`, shared with alerts. `settings.games` (the connections' switches) is in the store, the same for every profile; the actions belong to the profile.
- `gameCommands` (`commands.ts`) turns a step into commands: spawn `summon <mob>[ "<name>"] ~ ~ ~` times `amount`, give `give @p <item> <n>`, weather `weather <w>`, time `time set <t>`, command (the template, one leading `/` dropped). Amounts are 1–100. A mob or item id that isn't `/^[a-z0-9_]+$/` runs nothing.
- Variables are `ALERT_MESSAGE_VARIABLES` per trigger, filled by `formatAlertMessage(text, payload, commandValue)`. `commandValue` strips `" ' \ { } [ ] § @` and control characters, collapses whitespace and caps at 100 characters, so a nickname can't inject NBT or selectors. A spawn name goes through it whole, then `JSON.stringify`. The command template is the user's own and isn't escaped.
- `GamesService.handle` (called from `registerConnectorEvents` next to the alerts, whatever features are on) returns when Minecraft is off or in error. It runs its own `GiftStreaks` once per event; `{count}` is the streak's total. An action on **Every gift** runs once per gift added, at most `MAX_REPEATS` (100), and an action sends at most `MAX_COMMANDS` (100) per event. Matching is `matchesTrigger` and `giftOf` in `src/main/helper/triggers.ts`, shared with `AlertsService` (see `.claude/rules/alerts.md`). `DISCONNECTED` calls `clear`.
- **Test** (`TEST_GAME_ACTION`, `notify: false`) runs the steps once with `generateTikTokEventSample` (Emote uses Chat) and returns each command with the game's reply. It fails with "Turn on Minecraft and connect the game first." unless a game is connected. Its reply carries the action's `id`, failures included; the page ignores other ids.

## Notices and logs

- Logs go to `games.log` (`Files.logs.games`); the feedback source is `games`. A status change is logged once, never per command.
- `registerGames` (`src/main/events/init.ts`) turns `GamesService.onError` into notices, and logs only when the notice goes out:
  - `GAME_NOT_CONNECTED`, key `game:minecraft:offline`, 60 s: an action ran while the toggle is on and no game is connected;
  - `GAME_COMMAND_FAILED`, key `game:<action id>`, 30 s (`REPEAT_NOTICE_MS`): the game refused a command, with its reply.
- `GAME_ACTION_FAILED` reports an unexpected throw from `dispatchGames`. The toggle, the actions' autosave and Test send no success notices.

## Renderer

- `pages/Games`: `MinecraftSection` (toggle, status, the setup steps, then the `/connect` commands under **From this device**, with a caret that blinks while waiting, and **From another device**; the setup hides once connected) and `ActionsSection`. `TriggerFilter` and `TRIGGER_OPTIONS` come from `components/AlertItem`; gifts and emotes load as on Alerts.
- `MOBS` and `ITEMS` (`helper.ts`) are Bedrock ids checked in the game; add one only after trying it there (`testfor @e[type=<id>]` and `clear @p <id> 0 0` count without changing the world, and an unknown id is a syntax error). Some differ from Java's: Bedrock has `web` (Cobweb), `evocation_illager` (Evoker) and `zombie_pigman` (Zombified Piglin), which the Java mod will need mapped.
- Actions save through `useEditableSettings("games")`; the toggle emits `SET_GAMES_SETTINGS` at once.

## Tests

- `minecraft.test.ts` plays the game with a real `ws` client on port 0: it does the client side of the handshake (the same `aes-256-cfb`, its three frames corked into one TCP chunk), answers commands, and covers Origin, a port in use, the limits and drops. A port in use is made with a listen that has no host (macOS `SO_REUSEADDR`).
- `index.test.ts` and `commands.test.ts` test the service and the commands with a stub connection.
- The protocol facts were measured with a throwaway probe script run under Electron as Node (`ELECTRON_RUN_AS_NODE=1`, so BoringSSL), using `ws` from the repo, listening on 37892 and logging the upgrade headers, against the real game (Bedrock 1.26, GDK). Redo it that way when the game changes: unit tests can't catch a cipher or frame change.
- Real-game check: drive the built app (`drive-app`), `/connect` with **Require Encrypted WebSockets** left on, run each step kind, a bad command and a burst, then leave the world and come back.
