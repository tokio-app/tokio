<div align="center">
  <img src="resources/icon.png" alt="Tokio logo" width="96" />
  <h1>Tokio</h1>
  <p>Make your TikTok LIVE react to chat, gifts, likes and more: text-to-speech, music requests, alerts, a countdown timer and overlays.</p>
  <p>
    <a href="https://tokio.ialfaro.com">Website</a> ·
    <a href="https://github.com/tokio-app/tokio/releases">Download</a> ·
    <a href="https://github.com/tokio-app/tokio/issues">Report a bug</a>
  </p>
</div>

Tokio is a desktop app for Windows, macOS and Linux that connects to your TikTok LIVE and reacts to what happens in it. It reads chat aloud, takes song requests, plays sounds and shows images or videos when someone follows or sends a gift, runs a countdown that viewers add time to, and drives overlays you add to **OBS**, **TikTok LIVE Studio** or any streaming app that can show a web page.

## Features

### Dashboard

Enter your TikTok username to connect to your LIVE. Turn each feature on or off for the session, and see what it will do: the TTS voice, whether music is connected, how many alerts are on and whether the overlay server is running.

While you're LIVE, a rose line at the top of the window shows it on every page, and the dashboard shows how long you've been on, the viewers, likes and views, and the new followers, shares, gifts and coins since you connected. Its activity feed lists chats, gifts, follows, shares and viewers joining as they come in, and keeps the last LIVE's until you connect again. The gear next to **Activity** picks which of them the feed shows; hidden ones still count toward the totals.

### Text-to-speech

Chat messages are read aloud as they come in.

- **Voices** from three engines, all in one list: TikTok's voices (see **Voice engines** under [Profiles and settings](#profiles-and-settings)), Microsoft Edge voices, and, on Windows, the voices installed on the system (SAPI and OneCore, including older 32-bit voices). Search the list, filter it by engine and language, and play any voice to hear a short line in its language before you pick it. Adjust speed, pitch and volume, and test a message to hear it the way chat is read.
- **Format**: choose which messages get read and how, for example `{username} {comment}` or only messages that start with a command, which isn't read aloud. Turn on **Remove Emojis** so the voice doesn't read them out; messages that are only emojis are then skipped.
- **Replacements**: teach the voice how to say acronyms, slang and names.
- **Permissions**: let everyone talk, or only followers, superfans or moderators. You can also set a minimum fan level, and a whitelist and a blacklist of @handles: blacklisted viewers are never read, even when everyone can talk, and a whitelist with names in it lets only those viewers talk.
- **Protection**: a cooldown between messages and a maximum queue length keep the chat from flooding the voice. Messages over a maximum length are skipped, and so are messages with a banned word, in the comment or in the viewer's name. Banned words are caught even when they're written with capitals, accents, look-alike letters or hidden characters.

### Music requests

Viewers request songs from chat. **YouTube** songs play in Tokio's own player window, and **Spotify** songs in the Spotify app you have open, on your computer or your phone. The chat commands can be renamed or turned off, and viewers can type them in any case:

| Command   | Action                                                                                     |
| --------- | ------------------------------------------------------------------------------------------ |
| `!play`   | Request a song                                                                             |
| `!next`   | Skip to the next song                                                                      |
| `!last`   | Go back to the last song                                                                   |
| `!revoke` | Remove a song from the queue by its name, as typed in the request or as shown in the queue |

Music requests have their own permissions and protection settings, set the same way as text-to-speech's: who can use the commands, a cooldown and a maximum queue length. After a command, Tokio ignores every command until the cooldown has passed, whoever sends it. `!play` or `!revoke` with nothing after it does nothing and doesn't start the cooldown.

Turn on **One request per viewer** in **Music → Protection** to keep one viewer from filling the queue. While a viewer's song waits, Tokio ignores their next `!play`, and a song that's already playing or waiting isn't added again. Neither starts the cooldown. It's off by default.

When songs keep failing to start, for example because the Spotify app is closed, the queue waits at the first of them and keeps the rest; the next request tries again. Disconnecting music, or connecting it again, empties the queue.

Both services need a **Premium** account. On YouTube Music, a free account plays ads, which can delay songs or cut them short. On Spotify, only Premium accounts let apps control playback, and creating the Spotify app whose Client ID Tokio uses needs Premium too.

### Alerts

Play a sound, show an image or a video, or both, for LIVE events: chat messages, emotes, follows, shares, likes, gifts, envelopes, Super Fan events, new members and song changes.

- Upload your own sounds or search [MyInstants](https://www.myinstants.com) from inside the app. Sounds can be up to 8 MB. Your sound library is shared by all your profiles.
- **Clear** takes a sound, message, image or video off an alert and keeps it in your library. Deleting one from the library removes it from your computer and from every alert that uses it, in all your profiles, after you confirm.
- Pick an image or a video under the alert's **Media**, from thumbnails of your media library with the alert's own marked: png, jpg, gif, webp, mp4 or webm, up to 50 MB. It shows with the alert's sound or message, or on its own, and a video plays with its own sound at the alert's volume. Your media library is shared by all your profiles too: upload, preview and delete files in **Settings → Media Library**.
- Each alert shows its image or video on its own overlay, at `http://tokio-app.local:37891/alerts/<alert-id>/`. Copy the URL from the alert's media and add it to your streaming app like any overlay (see [Adding an overlay](#adding-an-overlay)), so you can place each alert where you want.
- An image or video stays on screen for the alert's **Duration** (5 seconds unless you change it), or while its sound plays if that's longer. With **Match video** on, it follows the video's length, up to 60 seconds, also after you pick another video. A longer video is cut. The next alert in the queue waits for it, so for events that come often, like likes, keep the duration short or let alerts play at the same time.
- Set each alert's volume. Gift alerts can react to any gift or only to the ones you pick, and play once when the combo ends or for every gift sent. TikTok's gift list can miss some gifts, like ones from other regions, so Tokio also saves the ones viewers send that aren't on it, for all your profiles.
- Pick gifts from a list: search it by name, filter it by price (exactly, more than, less than, at least, at most or between two amounts of coins) and sort it by price or name. The gifts already picked come first. **Select all shown** checks every gift the filters leave, such as all the gifts worth 1,000 coins or more.
- Chat alerts can react to every message or only to messages with a keyword, which can be a word, a phrase or an emoji. Emote alerts can react to any emote or only to the ones you pick. TikTok doesn't list a LIVE's emotes, so each profile saves the ones viewers use.
- Member Join and Super Fan Join alerts can react to anyone or only to the viewer you name, by @handle or name.
- Instead of a sound, an alert can speak a message with text-to-speech, in its own voice, speed and pitch. Messages can include details of the event, such as `{username}`, `{gift}` or `{count}`, and the TTS page's banned words, replacements, emoji setting, cooldown and queue length apply. Banned words are looked for in the event's details, such as the viewer's name, not in your own message.
- Play alerts one after another in a queue, or let different events play at the same time.

### Overlays

On the **Overlays** page, **Official Overlays** opens the overlays made for Tokio, with a preview of each. Install the ones you want, or remove them there. A dot on the button means a new version is out, and **Update** installs it and keeps your settings. To use your own overlays, import them in **Settings → Overlay Library**, where you can also remove them.

Set them up from the gallery on the **Overlays** page: colors, text, the gifts they react to (picked from the same list as gift alerts), and anything else an overlay offers. Tokio gives each overlay its own URL on your computer, `http://tokio-app.local:37891/<overlay-id>/`. Copy it from the gallery and add it to your streaming app (see [Adding an overlay](#adding-an-overlay)).

### Countdown timer

Run a subathon-style countdown on your stream that viewers add time to. Set it up on the **Tools** page, and add its overlay, `http://tokio-app.local:37891/timer/`, to your streaming app like any overlay (see [Adding an overlay](#adding-an-overlay)).

- **Start**, **Pause**, **Stop** and **Reset** the clock. While it's paused, LIVE events still add time; once it's stopped, they don't until you press **Start** again. **Reset** puts the starting time back after you confirm, since the time added so far is lost. **Add** and **Remove** change the clock by the minutes you enter.
- Choose how many seconds each event adds: per coin of the gifts sent, every so many likes, and for each new Super Fan, follow, share or chat message. Set an event to 0 to leave it out. The **Multiplier** applies to all of them, for a double-time hour, and the overlay shows it, like ×2. **Maximum time** stops added time once the clock reaches it.
- Chat messages can add time only when they have a keyword or phrase, matched like a chat alert's, and each viewer's messages add time at most once in the cooldown you set.
- On stream, the overlay shows the clock, an optional title, and the time each event adds as it comes in. In **Timer Look**, right under the preview, pick its colors, fonts installed on the computer that runs your streaming app, and how many minutes before the end the clock turns to its warning color. Turn on **Show the triggers, one at a time** to show what each event adds, one after another under the clock, with names you can write in your audience's language.
- Each profile has its own timer. The clock keeps running when you leave the **Tools** page, and pauses when the LIVE ends or Tokio disconnects from it, unless you turn that off. If Tokio closes while the clock runs, it comes back paused with about the time it had.

### Profiles and settings

- **Profiles**: keep separate settings for different streams. Create a blank profile or clone an existing one, and switch between them from the title bar.
- **TikTok LIVE**: your [Euler Stream](https://www.eulerstream.com) API key. Euler Stream signs Tokio's connection to TikTok LIVE, and each user brings their own key: [sign up](https://www.eulerstream.com/register) for free and paste it here. Your [plan](https://www.eulerstream.com/pricing) sets how often you can connect.
- **Voice engines**: optionally add your TikTok session ID. With it, the TikTok voices come straight from TikTok. Without it, they go through `tiktok-tts.weilnet.workers.dev`, a proxy run by a third party, which gets the text of every message they read.
- **Overlay server**: turn the local server for overlays on or off. It also shows your computer's network address, for a streaming app on another computer (see [Adding an overlay](#adding-an-overlay)).
- **Updates**: Tokio checks GitHub for new releases on startup and every few hours, downloads them in the background and installs them when you restart from the title bar. On macOS, where the app isn't signed, the button opens the release page instead. Turn automatic checks off in Settings, or check any time from About.
- **Notifications**: when something fails, such as a voice that can't be generated, a sound that's missing or a change that couldn't be saved, Tokio tells you what went wrong. The bell in the title bar keeps the session's history.

### Tools for overlay developers

Building your own overlay? Create a test ID on the **Tools** page and send your overlay sample LIVE events without importing it.

## Getting started

### Install

Download Tokio from the [latest release](https://github.com/tokio-app/tokio/releases/latest).

- **Windows**: run `tokio-<version>-setup.exe`. It installs Tokio for your user and opens it.
- **macOS and Linux**: download the app itself: `tokio-<version>-mac-arm64.zip` (Apple Silicon), `tokio-<version>-mac-x64.zip` (Intel) or `tokio-<version>-x86_64.AppImage`.

### Platforms

| Platform | Status                        |
| -------- | ----------------------------- |
| Windows  | Supported                     |
| macOS    | Supported (macOS 13 or later) |
| Linux    | Supported                     |

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

Overlays are served by Tokio's overlay server. Turn it on first in **Settings → Overlay Server**, then copy the overlay's URL from the **Overlays** page, an alert's from its media on the **Alerts** page, or the countdown timer's from **Tools**.

TikTok LIVE Studio doesn't accept `localhost` links, so overlays use their own address, `tokio-app.local`. The first time you turn on the server, your system asks for administrator rights (your password on macOS and Linux) so Tokio can add this address to your hosts file, pointing to your own computer. Accept the prompt, or the server stays off. You won't be asked again while the entry is there.

**OBS Studio**

1. In **Sources**, click **+** and choose **Browser**.
2. Paste the overlay URL and set the width and height to your canvas size.

**TikTok LIVE Studio**

1. Click **Add source** and choose **Link**.
2. Paste the overlay URL and place the overlay on your scene.

**On another computer**

If your streaming app runs on another computer on your network, `tokio-app.local` there points to that computer. Point it to the one Tokio runs on instead, at the address shown in **Settings → Overlay Server**:

- On the other computer, add a line with that address and `tokio-app.local` to its hosts file, for example `192.168.1.20 tokio-app.local`. The file is `C:\Windows\System32\drivers\etc\hosts` on Windows and `/etc/hosts` on macOS and Linux, and you edit it as administrator.
- Or add a DNS entry for `tokio-app.local` with that address on your router.

The overlay URLs then work there as they are, and the overlays get their events from Tokio.

The first time the server starts, Windows may ask whether to allow Tokio through the firewall. Allow it, or the other computer can't connect.

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
