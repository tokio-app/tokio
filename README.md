<div align="center">
  <img src="resources/icon.png" alt="Tokio logo" width="96" />
  <h1>Tokio</h1>
  <p>Make your TikTok LIVE react to chat, gifts, likes and more: text-to-speech, music requests, sound alerts and overlays.</p>
  <p>
    <a href="https://tokio.ialfaro.com">Website</a> ·
    <a href="https://github.com/tokio-app/tokio/releases">Download</a> ·
    <a href="https://github.com/tokio-app/tokio/issues">Report a bug</a>
  </p>
</div>

Tokio is a desktop app for Windows, macOS and Linux that connects to your TikTok LIVE and reacts to what happens in it. It reads chat aloud, takes song requests, plays sounds when someone follows or sends a gift, and drives overlays you add to **OBS**, **TikTok LIVE Studio** or any streaming app that can show a web page.

## Features

### Dashboard

Enter your TikTok username to connect to your LIVE. Turn each feature on or off for the session and watch the live stats as viewers join, like and send gifts.

### Text-to-speech

Chat messages are read aloud as they come in.

- **Voices** from three engines, all in one list: TikTok's own voices, Microsoft Edge voices, and, on Windows, the voices installed on the system (SAPI and OneCore, including older 32-bit voices). Search the list, filter it by engine and language, and play any voice to hear it before you pick it. Adjust speed, pitch and volume.
- **Format**: choose which messages get read and how, for example `{username} {comment}` or only messages that start with a command.
- **Replacements**: teach the voice how to say acronyms, slang and names.
- **Permissions**: let everyone talk, or only followers, superfans or moderators. You can also set a minimum fan level, a whitelist and a blacklist.
- **Protection**: a cooldown per viewer and a maximum queue length keep the chat from flooding the voice.

### Music requests

Viewers request songs from chat, played from **YouTube** or **Spotify** in a separate player window. The chat commands can be renamed or turned off:

| Command   | Action                             |
| --------- | ---------------------------------- |
| `!play`   | Request a song                     |
| `!next`   | Skip to the next song              |
| `!last`   | Go back to the last song           |
| `!revoke` | Remove your request from the queue |

Music requests use the same permissions and protection settings as text-to-speech.

### Alerts

Play a sound for LIVE events: chat messages, emotes, follows, shares, likes, gifts, envelopes, Super Fan events, new members and song changes.

- Upload your own sounds or search [MyInstants](https://www.myinstants.com) from inside the app. Your sound library is shared by all your profiles.
- Set each alert's volume. Gift alerts can react to any gift or only to the ones you pick, and fire once per combo.
- Chat alerts can react to every message or only to messages with a keyword. Emote alerts can react to any emote or only to the ones you pick. TikTok doesn't list a LIVE's emotes, so each profile saves the ones viewers use.
- Member Join and Super Fan Join alerts can react to anyone or only to the viewer you name, by @handle or name.
- Instead of a sound, an alert can speak a message with text-to-speech, in its own voice, speed and pitch. Messages can include details of the event, such as `{username}`, `{gift}` or `{count}`, and the TTS page's banned words, replacements, cooldown and queue length apply.
- Play alerts one after another in a queue, or let different events play at the same time.

### Overlays

Import overlays in **Settings → Imported Overlays**, where you can also remove them, and set them up from the gallery on the **Overlays** page: colors, text, the gifts they react to, and anything else an overlay offers. Each overlay gets its own URL on your computer (`http://tokio-app.local:37891/...`). Copy it from the gallery and add it to your streaming app (see [Adding an overlay](#adding-an-overlay)).

### Profiles and settings

- **Profiles**: keep separate settings for different streams. Create a blank profile or clone an existing one, and switch between them from the title bar.
- **Voice engines**: optionally add your TikTok session ID, which the TikTok voices use when it's set.
- **Overlay server**: turn the local server for overlays on or off.
- **Updates**: Tokio checks GitHub for new releases on startup and every few hours, downloads them in the background and installs them when you restart from the title bar. On macOS, where the app isn't signed, the button opens the release page instead. Turn automatic checks off in Settings, or check any time from About.
- **Notifications**: when something fails, such as a voice that can't be generated or a sound that's missing, Tokio tells you what went wrong. The bell in the title bar keeps the session's history.

### Tools for overlay developers

Building your own overlay? Create a test ID on the **Tools** page and send your overlay sample LIVE events without importing it.

## Getting started

### Install

Download Tokio from the [latest release](https://github.com/tokio-app/tokio/releases/latest).

- **Windows**: run `tokio-<version>-setup.exe`. It installs Tokio for your user and opens it.
- **macOS and Linux**: download the app itself: `tokio-<version>-mac-arm64.zip` (Apple Silicon), `tokio-<version>-mac-x64.zip` (Intel) or `tokio-<version>-x86_64.AppImage`.

### Platforms

| Platform | Status    |
| -------- | --------- |
| Windows  | Supported |
| macOS    | Supported |
| Linux    | Supported |

Every release has builds for Windows (x64), macOS (Apple Silicon and Intel) and Linux (x64). The voices installed on the system are only available on Windows; TikTok and Edge voices work everywhere.

- **macOS**: unzip the download and move **Tokio** to your Applications folder. Tokio isn't notarized yet, so macOS may block it the first time. Open it from Finder with right-click → **Open**, or allow it in **System Settings → Privacy & Security**.
- **Linux**: make the AppImage executable with `chmod +x` (or in the file's properties) and run it. It needs FUSE.

### Connect to your LIVE

Set everything up before you go live: Tokio can only connect once your LIVE has started.

1. On Tokio's **Home** page, turn on the features you want for this stream: text-to-speech, music, alerts. Add your overlays to OBS or TikTok LIVE Studio (see [Adding an overlay](#adding-an-overlay)).
2. Start your LIVE on TikTok.
3. Enter your `@username` on the **Home** page and connect.

### Adding an overlay

Overlays are served by Tokio's overlay server. Turn it on first in **Settings → Overlay Server**, then copy the overlay's URL from the **Overlays** page.

TikTok LIVE Studio doesn't accept `localhost` links, so overlays use their own address, `tokio-app.local`. The first time you turn on the server, your system asks for administrator rights (your password on macOS and Linux) so Tokio can add this address to your hosts file, pointing to your own computer. Accept the prompt, or the server stays off. You won't be asked again while the entry is there.

**OBS Studio**

1. In **Sources**, click **+** and choose **Browser**.
2. Paste the overlay URL and set the width and height to your canvas size.

**TikTok LIVE Studio**

1. Click **Add source** and choose **Link**.
2. Paste the overlay URL and place the overlay on your scene.

Tokio has to stay open while you stream so the overlays keep getting events.

## Building from source

Requires Node.js 24+ and Yarn 1.

```sh
yarn install
yarn dev          # run in development
yarn test         # unit tests
yarn typecheck    # type-check every process
yarn lint         # lint
yarn build:win    # build the Windows setup into dist/
yarn build:mac    # build the macOS zips into dist/ (on macOS)
yarn build:linux  # build the Linux AppImage into dist/
```

Want to help? Read [CONTRIBUTING.md](CONTRIBUTING.md) and the [code of conduct](CODE_OF_CONDUCT.md).

## License

Tokio's source code is licensed under the [MIT License](LICENSE). One file is an exception: `src/main/services/tts/providers/edge/common/drm-v2.ts` is derived from [edge-tts](https://github.com/rany2/edge-tts) and is licensed under the [GNU LGPL v3.0](LICENSES/LGPL-3.0.txt), which builds on the [GNU GPL v3.0](LICENSES/GPL-3.0.txt).

The **distributed application** includes [tiktok-live-connector](https://github.com/zerodytrash/TikTok-Live-Connector) and its protocol package, which are licensed under the [GNU AGPL v3.0](LICENSES/AGPL-3.0.txt). So the application as a whole is distributed under the AGPL-3.0-only.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for details. The **About** page in the app shows the same notices.

Tokio is not affiliated with or endorsed by TikTok or ByteDance.
