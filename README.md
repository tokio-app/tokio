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

Enter your TikTok username to connect to your LIVE. Turn each feature on or off for the session, and see what it will do: the TTS voice, whether music is connected, how many alerts are on and whether the overlay server is running.

While you're LIVE, the dashboard shows how long you've been on, the viewers, likes and views, and the new followers, shares, gifts and coins since you connected. Its activity feed lists chats, gifts, follows, shares and viewers joining as they come in, and keeps the last LIVE's until you connect again. The gear next to **Activity** picks which of them the feed shows; hidden ones still count toward the totals.

### Text-to-speech

Chat messages are read aloud as they come in.

- **Voices** from three engines, all in one list: TikTok's own voices, Microsoft Edge voices, and, on Windows, the voices installed on the system (SAPI and OneCore, including older 32-bit voices). Search the list, filter it by engine and language, and play any voice to hear a short line in its language before you pick it. Adjust speed, pitch and volume, and test a message to hear it the way chat is read.
- **Format**: choose which messages get read and how, for example `{username} {comment}` or only messages that start with a command, which isn't read aloud. Turn on **Remove Emojis** so the voice doesn't read them out; messages that are only emojis are then skipped.
- **Replacements**: teach the voice how to say acronyms, slang and names.
- **Permissions**: let everyone talk, or only followers, superfans or moderators. You can also set a minimum fan level, and a whitelist and a blacklist of @handles.
- **Protection**: a cooldown between messages and a maximum queue length keep the chat from flooding the voice. Messages over a maximum length are skipped, and so are messages with a banned word, in the comment or in the viewer's name.

### Music requests

Viewers request songs from chat, played from **YouTube** or **Spotify** in a separate player window. The chat commands can be renamed or turned off, and viewers can type them in any case:

| Command   | Action                                   |
| --------- | ---------------------------------------- |
| `!play`   | Request a song                           |
| `!next`   | Skip to the next song                    |
| `!last`   | Go back to the last song                 |
| `!revoke` | Remove a song from the queue by its name |

Music requests have their own permissions and protection settings, set the same way as text-to-speech's: who can request songs, a cooldown between requests and a maximum queue length.

### Alerts

Play a sound for LIVE events: chat messages, emotes, follows, shares, likes, gifts, envelopes, Super Fan events, new members and song changes.

- Upload your own sounds or search [MyInstants](https://www.myinstants.com) from inside the app. Your sound library is shared by all your profiles.
- Set each alert's volume. Gift alerts can react to any gift or only to the ones you pick, and fire once per combo. TikTok's gift list can miss some gifts, like ones from other regions, so Tokio also saves the ones viewers send that aren't on it, for all your profiles.
- Pick gifts from a list: search it by name, filter it by price (exactly, more than, less than, at least, at most or between two amounts of coins) and sort it by price or name. The gifts already picked come first. **Select all shown** checks every gift the filters leave, such as all the gifts worth 1,000 coins or more.
- Chat alerts can react to every message or only to messages with a keyword. Emote alerts can react to any emote or only to the ones you pick. TikTok doesn't list a LIVE's emotes, so each profile saves the ones viewers use.
- Member Join and Super Fan Join alerts can react to anyone or only to the viewer you name, by @handle or name.
- Instead of a sound, an alert can speak a message with text-to-speech, in its own voice, speed and pitch. Messages can include details of the event, such as `{username}`, `{gift}` or `{count}`, and the TTS page's banned words, replacements, emoji setting, cooldown and queue length apply.
- Play alerts one after another in a queue, or let different events play at the same time.

### Overlays

On the **Overlays** page, **Official Overlays** opens the overlays made for Tokio, with a preview of each. Install the ones you want, or remove them there. A dot on the button means a new version is out, and **Update** installs it and keeps your settings. To use your own overlays, import them in **Settings → Imported Overlays**, where you can also remove them.

Set them up from the gallery on the **Overlays** page: colors, text, the gifts they react to (picked from the same list as gift alerts), and anything else an overlay offers. Tokio gives each overlay its own URL on your computer, `http://tokio-app.local:37891/<overlay-id>/`. Copy it from the gallery and add it to your streaming app (see [Adding an overlay](#adding-an-overlay)).

### Profiles and settings

- **Profiles**: keep separate settings for different streams. Create a blank profile or clone an existing one, and switch between them from the title bar.
- **TikTok LIVE**: your [Euler Stream](https://www.eulerstream.com) API key. Euler Stream signs Tokio's connection to TikTok LIVE, and each user brings their own key: [sign up](https://www.eulerstream.com/register) for free and paste it here. Your [plan](https://www.eulerstream.com/pricing) sets how often you can connect.
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

1. Get a free API key from [Euler Stream](https://www.eulerstream.com/register), which signs the connection to TikTok LIVE, and paste it in **Settings → TikTok LIVE**. You only do this once.
2. On Tokio's **Home** page, turn on the features you want for this stream: text-to-speech, music, alerts. Add your overlays to OBS or TikTok LIVE Studio (see [Adding an overlay](#adding-an-overlay)).
3. Start your LIVE on TikTok.
4. Enter your `@username` on the **Home** page and connect. If the connection drops, Tokio reconnects on its own.

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
yarn dev          # run in development (close Tokio first)
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

Tokio connects to TikTok LIVE through [@tokioapp/connector](https://github.com/tokio-app/connector), which is also MIT-licensed.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for details. The **About** page in the app shows the same notices.

Tokio is not affiliated with or endorsed by TikTok or ByteDance.
