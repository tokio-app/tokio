# Drive-app recipes

Checks that need more than clicks. Each worked in the real app; the names were checked against the code when they were written down.

## Live events without a LIVE

Emit fake live events on the connector's emitter in main, so the feed, chat TTS, music requests, alerts, game actions and the timer react as on a LIVE.

```js
// First thing in the steps file, before LOAD_APP wires the listeners.
// Main is ESM, so no require: walk up from app to EventEmitter.prototype.
await app.evaluate(({ app }) => {
  let proto = app;
  while (!Object.hasOwn(proto, "listenerCount"))
    proto = Object.getPrototypeOf(proto);
  const record = (original) =>
    function (event, listener) {
      if (event === "tokio:event:chat")
        (globalThis.__chat ??= new Set()).add(this);
      return original.call(this, event, listener);
    };
  proto.on = record(proto.on);
  proto.addListener = record(proto.addListener);
});

// The connector's emitter is the one that also listens for connected
const emit = (event, data) =>
  app.evaluate(
    (_, [event, data]) => {
      [...globalThis.__chat]
        .find((e) => e.listenerCount("tokio:event:connected") > 0)
        .emit(event, data);
    },
    [event, data],
  );

await emit("tokio:event:connected", undefined);
await emit("tokio:event:chat", {
  user: { username: "Ana", handle: "ana", profilePictures: [], follower: true },
  comment: { content: "hello", emotes: [], lang: "en" },
});
```

- Several emitters get chat listeners: `ServerService.initEvents` listens for every live event on the music service too. Only the connector's also listens for `tokio:event:connected`. `TokioEmitter` keeps an inner `EventEmitter`, which is the one recorded.
- Payloads are typed by `TokioEventMap` (`src/common/types/connector.ts`). `tokio:event:disconnected` takes `{ reason: "ended" }` for a LIVE that ended.
- `tokio:event:connected` starts the LIVE session, so Home's feed lists what follows. The page still says Offline, since its LIVE state comes from the `CONNECTED` reply: `push` that too (SKILL.md).
- Don't look for the emitter with `node:inspector`'s `Runtime.queryObjects`: it killed main on Electron 45 every time.

## Counting what main sends

```js
await app.evaluate(({ BrowserWindow }) => {
  const win = BrowserWindow.getAllWindows().find((w) =>
    w.webContents.getURL().includes("index.html"),
  );
  const send = win.webContents.send.bind(win.webContents);
  globalThis.__sent = [];
  win.webContents.send = (channel, ...args) => {
    globalThis.__sent.push(channel);
    return send(channel, ...args);
  };
});
```

- Read `globalThis.__sent` with another `app.evaluate`. An alert's sound goes out on `app:alerts:audio`.
- Count a request the window makes with one more `ipcMain.on` listener, such as `app:alerts:get:sound:data` for the alert sounds main sends by key.

## Test media

- Never put the user's own files (their videos, recordings, pictures) in a check or a screenshot. Make test media.
- **Sound:** write a WAV like `tone()` in this skill's `scripts/screenshots.mjs`, or on Windows copy `C:\Windows\Media\Alarm01.wav`. Give a test alert `volume: 0` so nothing plays out loud.
- **Video:** in a headless browser (Playwright's `chromium`, or the installed Edge with `channel: "msedge"`), draw on a `<canvas>`, record `canvas.captureStream(30)` with `MediaRecorder` (`video/webm`) for 3 s, and return the bytes as base64. About 18 KB, and it plays in the app.
- **Upload:** stub `dialog.showOpenDialog` to return the file (SKILL.md's `app.evaluate`), then click the section's **Upload** (`page.locator("section", { has: heading })`).

## Minimized or hidden windows

Playwright turns on Chromium's focus emulation for every page it drives, so `document.visibilityState` stays `visible` when the window is minimized or hidden. Neither drive.mjs nor `e2e/` can show what a hidden page does (throttling, audio).

- Start Electron yourself: `<electron> . --remote-debugging-port=<port>` from the repo root, where `<electron>` is what `node -p "require('electron')"` prints. Use a temporary `TOKIO_HOME`, and remove `ELECTRON_RUN_AS_NODE` from its environment.
- Read the page's `webSocketDebuggerUrl` from `http://127.0.0.1:<port>/json/list`, and send `Runtime.evaluate` over Node's global `WebSocket`, with no Playwright attached.
- Minimize or close the window from the page: `window.api.emit("app:window:req:minimize")` or `"app:window:req:close"`.
- Hidden pages change only after about 5 minutes, so wait 6. That's how a minimized window's AudioContext clock was caught running at about 0.65× real time while timers and workers kept time, before the main window got `backgroundThrottling: false`.
- To probe Tone.js in a bare page, evaluate `node_modules/tone/build/Tone.js` there first.

## Overlays

- **Import a local build:** stub `dialog.showOpenDialog` to return `../tokio-overlays/overlays/<id>/dist` (build it there first), then click the Overlay library's `button[title="Import"]`: Settings has two Import buttons.
- **Watch what main sends overlays:** create an ID in Tools → Test overlays (placeholder "Overlay name", **Create ID**), then connect Node's global `WebSocket` to `ws://localhost:37891?id=<id>`. Messages are `{ type, data }`, `type` a `TOKIO_EVENTS` name. Each press of Test plays the next moment of that ID's test LIVE.
- **The games overlay:** seed a `--home` with the profile's `games.actions`, the store's `minecraftPictures` and the server on. Then open `http://localhost:37891/games/minecraft/` in a separate browser, through a page that iframes it over a game-like backdrop, to see the pictures float over a game.

## Gotchas

- Sidebar link names repeat on Home: scope them with `page.getByRole("navigation")`.
- A shell started by a VS Code extension (Claude Code's, for one) inherits `ELECTRON_RUN_AS_NODE=1`, which makes Electron run as plain Node ("Process failed to launch!"). drive.mjs drops it. Unset it for any other launch, such as `yarn dev` or `npx electron .` (`env -u ELECTRON_RUN_AS_NODE …`).
- Google refuses sign-ins in a browser Playwright drives. For YouTube Music, sign in once in a normal launch (`TOKIO_HOME=<dir>`, `ELECTRON_RUN_AS_NODE` unset), then pass `--home <dir>` to drive.mjs.
- Closing YouTube Music's page sends Playwright a `beforeunload` dialog: accept it with a `dialog` handler on every window, or Playwright throws.
- A Music change alert plays only when a song starts, while overlays get `tokio:event:music:change` on every queue change.
