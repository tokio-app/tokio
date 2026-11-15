---
paths:
  - "src/main/mcp/**"
  - "src/main/events/pages/mcp.ts"
  - "test/main/mcp.ts"
---

# MCP

`/mcp` serves an MCP server (`@modelcontextprotocol/server`, stateless, JSON answers) that AI assistants use to drive and configure the app. It covers everything a user can do in the app, not only the live controls (the user's call).

## Access

- It shares the phone remote's switch and key (`settings.remote`, `.claude/rules/controls.md`), but answers only on loopback. The phone sends the key unencrypted over Wi-Fi, so the LAN gets only `/remote/api`.
- Before the key, the route refuses any `Origin` header (browsers always send one, MCP clients never do) and any socket address but `127.0.0.1`, `::1` and `::ffff:127.0.0.1`. It reads `req.socket.remoteAddress`, never `req.ip` or a header. Clients in WSL2 need its mirrored networking.
- The server's instructions and the tools' texts are English, for the model, as logs are. Viewer text (chat, nicknames, gift and sound names) is data: it stays in named fields, never in sentences of ours.

## Tools

- `defs.ts` holds the contract, `registry.ts` the generic tools (`get_status`, `get_settings`, `describe`, `update_settings`, `list`, `get`, `save_item`, `test`, `remove`), and `tools/<area>.ts` each area's sections, kinds and verbs. An area imports `../defs` and `../common`, never `../registry` (a cycle).
- Keep the tool count low, since some clients cap it around 40. A new setting is a section field, a new item a kind; a tool of its own is only for a verb.
- Every input is a strict, plain `z.object`, so it converts to JSON Schema. The stored data is checked again with its real schema before it's saved: some store setters keep what they get, and one bad value makes every later save fail. `refuseUnknown` refuses keys Zod would strip, which would report success and change nothing.
- Every tool sets all four annotations: MCP's defaults are destructive and open-world.

## Reads and writes

- Reads go straight to the services, never through `invoke`. A `GET_PROFILE` reply drops a page's pending save, `GET_GIFTERS` aborts Coin stats' read, `GET_VOICES` is huge, and `GET_SETTINGS` and `GET_VOICE_KEYS` carry decrypted keys.
- Results are built field by field. Keys come back only as `hasKey`.
- Writes run the existing handlers through `invoke`, one at a time on the `write()` chain, each after `flushWindow`. The window first sends its pending autosaves (`FLUSH_SETTINGS`, then `flushSettings()`, then `SETTINGS_FLUSHED`), so a page's stale copy can't land after the write, or in another profile.
- The registry already runs every non-read-only tool, and the generic save, test and remove, on the chain. Area code that calls `write()` again deadlocks.
- A read-modify-write takes `guardProfile` before reading and checks it right before `invoke`, with no `await` between.
- After a write, the window gets what shows it:
  - Profile sections: `pushProfile`, so open pages resync instead of saving their copy over it.
  - `ACTIVE_FEATURES` and `SET_ACTIVITY_FEED`: `pushSettings`.
  - Handlers that already reply their list or the settings need nothing.
  - `PRIVATE_REPLIES` never reach the window.
- Something a test plays goes on `ALERT_AUDIO`'s `alert-test` channel, since `useAlertTest` drops `TEST_ALERT` replies it didn't number.

## Never exposed

- The dialog handlers, since they'd open dialogs on stream.
- `EXPORT_*`, `IMPORT_OVERLAY`, `REQ_FQDN`, `INSTALL_UPDATE`, `LOAD_APP` and the window events.
- `SET_SERVER`, which would cut MCP and every overlay, and the remote settings.
- `SEND_OVERLAY_DATA` and `CLONE_VOICE`.
- The window's own protocol: `TTS_PLAYED`, `SHOW_ALERT_MEDIA`, `CAMERA_*`, `GET_SOUND_DATA`, `ASK_MICROPHONE`.
- Any key read.

Paths to import (`add_to_library`) go through `checkPath`: absolute, a file, and no UNC or device path, which would send the Windows login's NTLM hash to another machine.

## Gotchas

- `music`'s `connect` returns at once and lets `CONNECT_MUSIC` finish on its own. Spotify waits for the streamer to log in, and holding the chain would stall every other write.
- `refuseUnknown` stops at arrays. Overlay Studio's save checks each item itself; a game step's unknown keys are still dropped quietly.
- An overlay settings save from MCP closes that overlay's settings dialog if it's open, since the page closes the dialog its save reply is for.
- A voice saved through `tts` replaces the whole voice: a partial one would keep the last engine's `id` (`.claude/rules/tts.md`).
- The `shortcuts` section refuses what the recorder refuses (`shortcutProblem` in `tools/settings.ts`, `.claude/rules/controls.md`): `SET_SHORTCUTS` itself takes any string.

## Coupling

- A new user-facing setting or action needs its section field, kind or tool in its area's file, with a test.
- The SDK compiles other packages into its files (`THIRD_PARTY_NOTICES.md`, "Code bundled in the MCP SDK"). On an upgrade, list them from its `dist`'s `//#region ../../node_modules/…` lines and update `LICENSES/MCP-SDK-bundled.txt`, the notices and About's component.
