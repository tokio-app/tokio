---
paths:
  - "src/main/services/server/camera*"
  - "src/main/services/server/mp4*"
  - "src/renderer/src/helper/camera*"
  - "src/renderer/src/hooks/useCameraCapture*"
---

# Overlay Studio's cameras

Builds on `.claude/rules/studio.md`.

- A camera element shows a camera on this PC, each element its own (`camera`, `{ id, label }` or null for the default camera), at `quality` 720p or 1080p. The user's calls: a Studio element instead of a webcam overlay or page, the camera per element, the quality setting, a secret in the URL and hardware video. A camera alone is a studio overlay with one Camera element.

## Capture

- The main window captures (`useCameraCapture` in `router/Layout`, `helper/camera.ts`): OBS's browser source refuses `getUserMedia` without `--enable-media-stream`, and a page opened from another computer isn't a secure context. `MediaStreamTrackProcessor` doesn't wait for paint, so it keeps going with the window in the tray, which `requestVideoFrameCallback` wouldn't.
- It matches a saved camera by id, then by name: ids are per origin, so `yarn dev` and the packaged app list different ones.
- It encodes with WebCodecs' `VideoEncoder`: H.264 on the GPU when it can, else in software, with a keyframe every 2 s. A GPU can take a config and then fail to start it (OBS holding its encoder sessions): a frame size whose hardware encoder fails before its first chunk encodes in software until Tokio quits (`noHardware`, with no notice: the user's call), while one that fails later gets the GPU again.
- On the user's laptop at 720p30, JPEG frames cost Tokio about 45% of a core and 220 KB each; H.264 about 17% and 16 KB.
- Chunks go to main (`CAMERA_FRAME`, each keyframe with its `CameraConfig`), which muxes them into fragmented MP4 (`services/server/mp4.ts`) and streams them (`CameraFeeds`, `services/server/camera.ts`). Not WebRTC: signaling, ICE and an encoder per page, under the app's `webrtc-ip-handling-policy`.
- A capture that fails warns `CAMERA_FAILED` once per camera per `REPEAT_NOTICE_MS`, and the window tries again every 5 s.
- On macOS, main asks for camera access (`askForMediaAccess`) the first time a capture is wanted while it's `not-determined`, without waiting: the window retries. Electron's Info.plist has `NSCameraUsageDescription`, and the mac build isn't hardened.

## The stream

- Pages play it through MediaSource (`playCamera` in `stage.ts`), never WebCodecs: `VideoDecoder` exists only in secure contexts, and an overlay at `tokio-app.local` or a LAN address isn't one (`localhost` is). So it's H.264 only, which MP4 carries: the encoder gives length-prefixed NAL units (`avc` format), an MP4 sample as is, and its description (the avcC) with its first keyframe.
- Its H.264 carries no colors, and Chromium takes HD video without them for BT.709, so main writes the color space the encoder reports into the init segment (`colr`): without it a camera's BT.601 greens play darker.
- The stream is a WebSocket to the element's src (`studioCameraPath`, ws: or wss: as the page): its codec string (`video/mp4; codecs="…"`) as the first text message, then the init segment and each fragment as binary ones. Never a `fetch`: OBS's browser sources share one network context, with 6 HTTP/1.1 connections per host, so 6 camera elements would stall every other request to Tokio (alert media, new sources); WebSockets have their own pool. Camera sockets are never overlay clients (no `onConnect`).
- The src carries `ServerService.cameraKey`, new on every `start()`, never saved or logged: the server is open to the whole network, and only pages main sent a view know the key. A wrong key or a bad query closes the socket with 1008, which the page never retries: the new key on a restart also changes every camera's src, so a new view starts a new stream. `stop()` closes the camera sockets itself (ws's `close()` leaves its clients open), and `closeAllConnections()` ends the HTTP connections still busy, which `server.close()` leaves serving.
- A stream starts once its feed has a config: the type, the init segment, then one fragment per chunk. A page appends it in sequence mode, trims behind it (MediaSource's quota fills in minutes), and opens again 2 s after it ends.
- A page decodes only from a keyframe. One that connects gets the init segment at once and waits for the next keyframe, which main asks the window for (`CAMERA_KEYFRAME`, once until it comes) and gets about a frame later. Not the fragments since the last keyframe: the page would play them from there, up to 2 s behind, and stay that late. A page that can't keep up (16 KB unsent on its socket) gets nothing until the next keyframe: a missed delta breaks every frame up to it. A changed config ends the streams that got the old init segment, and their pages open again.
- A page stays near its stream's end: past 0.15 s behind it plays at 1.5× until it's within 0.07 s, and past 1 s it skips ahead. A skip decodes from the last keyframe, so it lands later, and the page doesn't skip again while it decodes, which a slow PC could keep starting over.
  - Frames that come in a burst would leave it late for good: a new capture's first ones do, as the GPU encoder starts (about 0.5 s of them), and so does a busy main process. A steady 30 fps stays under 0.15 s: speeding up there tripled the frames dropped at 1080p.
  - On the user's laptop a page plays 35 to 50 ms behind Tokio's window at 720p, 65 to 100 at 1080p.
- One feed per camera (device and name), whose id names its frames, at the highest quality its pages ask for. A camera no page shows stops `CAMERA_LINGER_MS` after its last page closed, so an OBS source reloading doesn't turn it off and on. A hidden element is left out of the view and the stage stops its player, so hiding it turns its camera off too.
- The editor never plays the stream: the stage takes its `camera` option (`previewCamera`), which shows the camera from the window's own capture, so the editor alone encodes nothing and shows the camera without the overlay server. Its src only names the camera and its quality.

## Memory

- After a camera's first use, Tokio stays about 100 MB over idle until it quits, which is kept (the user's call, with a note on the website). Chromium's video capture process stays alive: 55 MB with the user's camera, 6 with the test camera. The GPU process keeps about 46 MB of the hardware encoder's memory. The next camera reuses both, so neither grows. A GC or a reload of the window frees neither, and Edge keeps its capture process the same way, even after its tab closes. Ending that process from main was offered and declined.

## Checking

- Check a change in the real app with Chromium's test camera: `drive-app`'s `--fake-camera`, as `e2e/` launches. A dark or covered camera sends about 10 fps; for a steady 30 fps with camera-like detail, launch with `--use-file-for-fake-video-capture=<a .y4m>` too. To measure the delay, draw each frame's number in the .y4m and read it with `requestVideoFrameCallback` on the page and on a video of the same camera in the window.
