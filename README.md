<div align="center">
  <img src="resources/icon.png" alt="Tokio logo" width="96" />
  <h1>Tokio</h1>
  <p>Make your TikTok LIVE react to chat, gifts, likes and more: text-to-speech, music requests, alerts, Minecraft actions, a countdown and overlays.</p>
  <p>
    <a href="https://tokio.ialfaro.com/download/">Download</a> ·
    <a href="https://tokio.ialfaro.com/docs/">Docs</a> ·
    <a href="https://tokio.ialfaro.com">Website</a> ·
    <a href="https://github.com/tokio-app/tokio/issues">Report a bug</a>
  </p>
</div>

![Tokio's Home during a LIVE: the viewers with their line, the LIVE's numbers and top gifters, the features, and the activity feed with the song playing](.github/screenshots/dashboard.png)

Tokio is a desktop app for Windows, macOS and Linux that connects to your TikTok LIVE and reacts to what happens in it. Its overlays work in OBS, TikTok LIVE Studio and any streaming app that can show a web page.

## Features

<table>
  <tr>
    <td width="50%" valign="top">
      <img src=".github/screenshots/text-to-speech.png" alt="Picking a text-to-speech voice" />
      <p><a href="https://tokio.ialfaro.com/docs/features/text-to-speech/"><b>Text-to-speech</b></a>: chat read aloud with TikTok, Edge or Windows voices.</p>
    </td>
    <td width="50%" valign="top">
      <img src=".github/screenshots/alerts.png" alt="Alerts for follows, gifts, chat, shares and a viewer joining" />
      <p><a href="https://tokio.ialfaro.com/docs/features/alerts/"><b>Alerts</b></a>: sounds, spoken messages, images and videos for follows, gifts, likes and more.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src=".github/screenshots/overlays.png" alt="The overlay gallery with two official overlays" />
      <p><a href="https://tokio.ialfaro.com/docs/features/overlays/"><b>Overlays</b></a>: install the official ones or import your own, and set them up from the gallery.</p>
    </td>
    <td width="50%" valign="top">
      <img src=".github/screenshots/overlay-studio.png" alt="Overlay Studio's editor: the Elements list, a portrait canvas with a likes banner, a star, the logo, a follow message and a viewer's picture, and the star's settings" />
      <p><a href="https://tokio.ialfaro.com/docs/features/overlay-studio/"><b>Overlay Studio</b></a>: build your own overlays from text, images, your cameras and other overlays, each piece reacting to your LIVE.</p>
    </td>
  </tr>
  <tr>
    <td width="50%" valign="top">
      <img src=".github/screenshots/games.png" alt="Games actions for Bedrock: a follow that spawns a zombie named after the viewer, and a Rose that runs a say command" />
      <p><a href="https://tokio.ialfaro.com/docs/features/games/"><b>Games</b></a>: gifts and chat spawn mobs and run commands in Minecraft, Bedrock or Java with the Tokio mod.</p>
    </td>
    <td width="50%" valign="top">
      <img src=".github/screenshots/countdown-timer.png" alt="The countdown running" />
      <p><a href="https://tokio.ialfaro.com/docs/features/countdown-timer/"><b>Countdown</b></a>: a subathon clock that gifts, likes, follows and chat add time to.</p>
    </td>
  </tr>
</table>

- [Music](https://tokio.ialfaro.com/docs/features/music-requests/): viewers request songs from chat, played on YouTube or Spotify.
- [Coin stats](https://tokio.ialfaro.com/docs/features/coin-stats/): the coins and gifts of every LIVE and who sent them. Overlays can show your top gifters.
- [Fans](https://tokio.ialfaro.com/docs/features/fans/): the viewers with a fan level, which overlays can show too.
- [Profiles](https://tokio.ialfaro.com/docs/features/profiles-and-settings/): separate settings for different streams.

Tokio is in English and Spanish. It follows your system's language, and **Settings → Language** changes it.

## Getting started

1. [Download Tokio](https://tokio.ialfaro.com/download/) for Windows, macOS or Linux. The [install guide](https://tokio.ialfaro.com/docs/install/) covers the warnings shown the first time it opens.
2. Get a free API key from [Euler Stream](https://www.eulerstream.com/register) and paste it in **Settings → TikTok LIVE**.
3. Start your LIVE, enter your `@username` on the **Home** page and connect.

[What you need](https://tokio.ialfaro.com/docs/#what-you-need) lists the rest, like a streaming app for the overlays. The [docs](https://tokio.ialfaro.com/docs/) cover every feature, the [chat commands](https://tokio.ialfaro.com/docs/features/chat-commands/) your viewers can type and how to [add an overlay](https://tokio.ialfaro.com/docs/guides/adding-an-overlay/) to your streaming app.

## Building from source

Requires Node.js 24.18 or later and Yarn 1.22.22 or later.

```sh
yarn install
yarn dev          # run in development (quit Tokio first)
yarn test         # unit tests
yarn typecheck    # type-check every process
yarn lint         # lint
yarn build:win    # build the Windows setup into dist/
yarn build:mac    # build the macOS zips into dist/ (on macOS)
yarn build:linux  # build the Linux AppImage into dist/
```

To contribute, read [CONTRIBUTING.md](CONTRIBUTING.md) and the [code of conduct](CODE_OF_CONDUCT.md).

## License

Tokio's source code is licensed under the [MIT License](LICENSE). One file is an exception: `src/main/services/tts/providers/edge/common/drm-v2.ts` is derived from [edge-tts](https://github.com/rany2/edge-tts) and is licensed under the [GNU LGPL v3.0](LICENSES/LGPL-3.0.txt), which builds on the [GNU GPL v3.0](LICENSES/GPL-3.0.txt).

Tokio connects to TikTok LIVE through [@tokioapp/connector](https://github.com/tokio-app/connector), which is also MIT-licensed.

See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for details. The **About** page in the app shows the same notices.

Tokio is not affiliated with or endorsed by TikTok or ByteDance.
