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

- `defs.ts` holds the contract, `registry.ts` the generic tools, and `tools/<area>.ts` each area's sections, kinds and verbs. An area imports `../defs` and `../common`, never `../registry` (a cycle).
- Keep the tool count low, since some clients cap it around 40. A new setting is a section field, a new item a kind; a tool of its own is only for a verb.
- Profiles are switched, made and renamed through the `profile` tool, and deleted with the generic `remove` (kind `profiles`, by name or id), which runs `DELETE_PROFILE`.
- Every input is a strict, plain `z.object`, so it converts to JSON Schema. The stored data is checked again with its real schema before it's saved: some store setters keep what they get, and one bad value makes every later save fail. `refuseUnknown` refuses keys Zod would strip, which would report success and change nothing, and a record's key outside its enum's options (`permissions.platforms.twich`), which the schema drops as a platform this Tokio doesn't know.
- Every tool sets all four annotations: MCP's defaults are destructive and open-world.

## Reads and writes

- Reads go straight to the services, never through `invoke`. A `GET_PROFILE` reply drops a page's pending save, `GET_GIFTERS` aborts LIVE history's read, `GET_VOICES` is huge, and `GET_SETTINGS` and `GET_VOICE_KEYS` carry decrypted keys.
- Results are built field by field. Keys come back only as `hasKey`.
- Writes run the existing handlers through `invoke`, one at a time on the `write()` chain, each after `flushWindow`. The window first sends its pending autosaves (`FLUSH_SETTINGS` → `SETTINGS_FLUSHED`), so a page's stale copy can't land after the write, or in another profile.
- The registry already runs every non-read-only tool, and the generic save, test and remove, on the chain. Area code that calls `write()` again deadlocks.
- A read-modify-write takes `guardProfile` before reading and checks it right before `invoke`, with no `await` between.
- Tools read the profile through `activeProfile` or `profileOf` (`common.ts`), which read it `fresh`. The store updates its copy only once a write ends, so a plain read right after the flush gets the section from before the page's save, and the write saves it back over the page's change.
- After a write, the window gets what shows it:
  - Profile sections: `pushProfile`, so open pages resync instead of saving their copy over it.
  - `ACTIVE_FEATURES` and `SET_ACTIVITY_FEED`: `pushSettings`.
  - Handlers that already reply their list or the settings need nothing.
  - `PRIVATE_REPLIES` never reach the window.
- Something a test plays goes on `ALERT_AUDIO`'s `alert-test` channel, since `useAlertTest` drops `TEST_ALERT` replies it didn't number. A game action's test sends `request: 0`: its reply is private, so no Games row takes it.

## Never exposed

- Twitch's sign-in and sign-out (`TWITCH_SIGN_IN`, `TWITCH_SIGN_OUT`): they need the streamer at a browser, with a code to type. `get_status` says only whether it's signed in (`live.twitch`), never the token.
- The dialog handlers, since they'd open dialogs on stream.
- `EXPORT_*`, `IMPORT_OVERLAY`, `REQ_FQDN`, `INSTALL_UPDATE`, `LOAD_APP` and the window events.
- `SET_SERVER`, which would cut MCP and every overlay, and the remote settings.
- `SEND_OVERLAY_DATA` and `CLONE_VOICE`.
- The window's own protocol: `TTS_PLAYED`, `SHOW_ALERT_MEDIA`, `CAMERA_*`, `GET_SOUND_DATA`, `ASK_MICROPHONE`.
- Any key read.

Paths to import (`add_to_library`) go through `checkPath`: absolute, a file, and no UNC or device path, which would send the Windows login's NTLM hash to another machine.

## Gotchas

- The SDK and the tools load with the first request past the checks (`createMcpRoutes`), not at startup, where they held 8 MB of main's heap. Code that runs at startup imports only `@/mcp` (the route) and `@/mcp/common`, which takes only types from the SDK: a value import of the SDK, `registry.ts` or `tools/*` from anywhere else loads them all again (`lazy.test.ts` checks it).
- `set_key` refuses a key with whitespace or a control character inside, and trims only the ends. Node's fetch rejects such a header value with the whole value in its error message, which the engines and the connector library log. Settings' key fields are single-line, so MCP is the only way one gets in.
- `music`'s `connect` returns at once and lets `CONNECT_MUSIC` finish on its own. Spotify waits for the streamer to log in, and holding the chain would stall every other write.
- `refuseUnknown` stops at arrays. Overlay Studio's save checks each item itself, an element against its own kind's schema (the union's check passes a key only another kind has), and each of their `also_triggers` and the overlay's `counters` too. An alert's save checks each of its `also_triggers` the same way and fills `gifts: []` into each, since arrays replace on merge and `gifts` has no default. A game step's unknown keys are still dropped quietly.
- `save_item` refuses a studio counter with an empty, repeated or taken name (a `STUDIO_NUMBERS` name or an event variable), which the schema takes for the editor's sake. Only the counters it was sent: `edit_studio_overlay` doesn't touch them.
- `edit_studio_overlay`'s ops are one object shape with optional fields, not a union: some clients choke on `anyOf`. They apply in order to a copy and save once, so a failed op saves nothing.
- An overlay settings save from MCP closes that overlay's settings dialog if it's open, since the page closes the dialog its save reply is for.
- A voice saved through `tts` replaces the whole voice: a partial one would keep the last engine's `id` (`.claude/rules/tts.md`).
- `preview_studio_overlay` (`tools/studio.ts`) draws the stored overlay, never the editor's unsaved copy, since it's read-only and doesn't flush. It loads the page's `?preview` in a hidden window on its own in-memory partition, `studio-preview`: the app's session cancels every WebSocket to the overlay server (`initSession`), and embeds need theirs. Permissions, new windows, navigation and sound are refused there. One preview runs at a time and its window is always destroyed, with a time limit; destroying it can't quit the app, since the main window only hides. Only `tools/studio.ts` imports `helper/studioPreview.ts`.
  - Windows clamps a window to the screen, hidden or offscreen, which squeezed the canvas. So the window takes the picture's shape within the work area, the capture is of the canvas's rect alone, and it's resized to the size asked: softer when the screen is smaller than the picture.
  - A hidden page rasters only when a capture asks, so the first capture of a busy canvas missed its texts: it's thrown away, and the second, `SETTLE_MS` later, is kept.
- The `shortcuts` section refuses what the recorder refuses (`shortcutProblem` in `tools/settings.ts`, `.claude/rules/controls.md`): `SET_SHORTCUTS` itself takes any string.

## Coupling

- The `platforms` section is the profile's platforms (`SET_PLATFORMS`): a change while live keeps a platform that's on and says so. Its `username`, `youtube` and `kick` are the names saved without connecting (`SET_CHANNELS`).
- A `platforms` write invokes only the handlers for what changed, each after `guardProfile`, so a switch between them can't land a name in another profile.
- `connect` joins every platform, or only its `platforms`, refused before invoking when empty or naming one the profile doesn't use. `disconnect` leaves them all, or only its `platform`.
- `connect`'s `youtube` (a channel or LIVE link) and `kick` (a channel or kick.com link) are saved per profile like `username`. It refuses a profile on either platform with its channel neither given nor saved.
- The alert and game action kinds describe a trigger's `platform` from `PLATFORM_NOTE`, built from `PLATFORM_TRIGGERS`, so a new platform needs nothing there.
- **Settings → AI assistants** shows each assistant's setup with the key in it, hidden until **Show** like the remote's (`ASSISTANTS`, `src/renderer/src/pages/Settings/helper.ts`). The website's MCP page has a tab for each assistant: change both when a client changes how it adds an HTTP server. Codex takes a static header only in `config.toml`, and Claude Desktop only through `mcp-remote`.
