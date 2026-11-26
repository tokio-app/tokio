---
paths:
  - "src/main/services/games/minecraft*"
---

# Minecraft connection

Builds on `.claude/rules/games.md`.

## Connection

- `MinecraftConnection` (`services/games/minecraft.ts`) is one `ws` server on `MINECRAFT_PORT` (`NOTE: DO NOT CHANGE`: players type it) for both editions.
- **Bedrock** joins with `/connect <address>:37892` in a world with cheats on, after **Settings → General → Network settings → Enable WebSockets**.
- **Java** joins with `/tokio connect [<address>:37892]` (alone, `localhost`) from the mod: Fabric, Minecraft 26.3, single-player and LAN worlds the player hosts, no cheats. The mod runs commands as the host at command-block permission, hides their feedback, never reconnects by itself and shows Tokio's close reason in chat.
- `handleProtocols` selects `MINECRAFT_JAVA_PROTOCOL` (`NOTE: DO NOT CHANGE`) when offered, else the first offered; `socket.protocol` tells the edition. With **Require Encrypted WebSockets** on (the game's default), Bedrock offers `com.microsoft.minecraft.wsencrypt` and `ws` must echo it back.
- The server binds no host, so each of this PC's addresses (`GET_NETWORK_ADDRESSES`) works from this PC and from other devices.
- It listens only while `settings.games.minecraft.enabled` is on (off by default): the constructor opens nothing, `configure` (startup and `SET_GAMES_SETTINGS`) does.
- `verifyClient` refuses any upgrade with an `Origin` header: browsers always send one and the game never does, so web pages can't take the socket. This is the exception to "no Origin checks".
- One game at a time: a new one of either edition replaces the old, closed with 4000 "Another game connected to Tokio.". Turning Minecraft off closes it with 1001 "Minecraft was turned off in Tokio.", and `_stop` doesn't wait for the server's close, which waits on every socket (up to `ws`'s 30 s for a game that never answers).
- The server and each socket handle `error`: a bad frame would throw in main.
- `GameStatus` is `off`, `waiting` (no game, also after one leaves and during Bedrock's handshake), `connected` (with `edition`) or `error` (text for the user).

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

## Tests

- `minecraft.test.ts` plays the game with a real `ws` client on port 0: for Bedrock the client side of the handshake (the same `aes-256-cfb`), its three frames corked into one TCP chunk; for Java `tokio.java.v1` and plain frames.
- It makes a port in use with a listen that has no host (macOS `SO_REUSEADDR`).
- The protocol was measured with a throwaway probe under Electron as Node (`ELECTRON_RUN_AS_NODE=1`, so BoringSSL), using the repo's `ws` on 37892 and logging the upgrade headers, against Bedrock 1.26 (GDK). Redo it when the game changes: unit tests can't catch a cipher or frame change.
