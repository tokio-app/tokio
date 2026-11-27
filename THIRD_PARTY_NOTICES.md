# Third-party notices

## Summary

| What                                                    | License                                                                                                                          |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Tokio's own source code in this repository              | MIT ([`LICENSE`](LICENSE)), except the file below                                                                                |
| `src/main/services/tts/providers/edge/common/drm-v2.ts` | LGPL-3.0-only ([`LICENSES/LGPL-3.0.txt`](LICENSES/LGPL-3.0.txt), which builds on [`LICENSES/GPL-3.0.txt`](LICENSES/GPL-3.0.txt)) |
| **The distributed application**                         | MIT, with the LGPL-3.0-only file above and the third-party components below under their own licenses                             |

**Source.** The complete source of Tokio is published at <https://github.com/tokio-app/tokio>, and every released version is built from it. The exact dependency versions are pinned in `yarn.lock`. See the README for build instructions (`yarn build:win`).

**Licenses in the app.** `LICENSE`, this notice and the `LICENSES/` folder are installed with the application, in its `resources/licenses` folder. Every npm dependency ships with its own license file inside `resources/app.asar`, under `node_modules/<package>/`. The About page of the app shows these notices, the license texts and the license of every npm package it ships.

## LGPL-3.0-only code: edge-tts

|                      |                                                                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **File**             | [`src/main/services/tts/providers/edge/common/drm-v2.ts`](src/main/services/tts/providers/edge/common/drm-v2.ts)                                     |
| **Derived from**     | `src/edge_tts/drm.py` (`generate_sec_ms_gec_v2`) of [edge-tts](https://github.com/rany2/edge-tts), commit `b2ffbdd9f43f28f03cc939b5de0f3964aa62d60e` |
| **Original authors** | rany \<ranygh@riseup.net\> and the edge-tts contributors (v2 token support co-authored by HarryXiaoCN)                                               |
| **Modifications**    | Ported from Python to TypeScript by Italo Alfaro, 2026-10-14                                                                                         |

This file generates the `Sec-MS-GEC` token required by Microsoft Edge's Read Aloud service, which the "Edge" TTS provider uses. You may modify it, or replace it with a modified version, and rebuild the application from the repository. The rest of the Edge provider (`src/main/services/tts/providers/edge/`, except `common/drm-v2.ts`) is an independent MIT implementation of the same service protocol; edge-tts is only used there as a reference for the protocol's behavior.

## Other dependencies

All other npm dependencies are under permissive licenses, except the font files of the Archivo typeface (`@fontsource-variable/archivo`), which are under the SIL Open Font License 1.1: it allows bundling them with any software, and only modified versions of the fonts must stay under the OFL. A scan of the 135 production packages on 2026-10-22 found MIT, BSD-2-Clause, BSD-3-Clause, ISC, 0BSD, Unlicense, BlueOak-1.0.0, Python-2.0 and OFL-1.1. Among them, `@tokioapp/connector` (MIT, <https://github.com/tokio-app/connector>) connects to TikTok LIVE and provides the stream events. Since then, the MCP server SDK (`@modelcontextprotocol/server` and `@modelcontextprotocol/core`) came in under Apache-2.0, with MIT for the contributions made before its relicensing: its license file holds both. Their license files are shipped with the application as described above, including those of libraries bundled into the user interface (such as React). That scan reads package-level licenses only. Content inside a package can carry its own license, as the icons below do.

Re-check when adding or upgrading dependencies, since licenses can change between versions. Electron's and Chromium's licenses are included by Electron as `LICENSE.electron.txt` and `LICENSES.chromium.html` in the installation folder.

## Code bundled in the MCP SDK

The MCP server SDK compiles these packages into its own files and ships them without their license files, so their texts are in [`LICENSES/MCP-SDK-bundled.txt`](LICENSES/MCP-SDK-bundled.txt):

| Package                     | Author                                  | License      |
| --------------------------- | --------------------------------------- | ------------ |
| ajv 8.18.0                  | Evgeny Poberezkin                       | MIT          |
| ajv-formats 3.0.1           | Evgeny Poberezkin                       | MIT          |
| json-schema-traverse 1.0.0  | Evgeny Poberezkin                       | MIT          |
| @cfworker/json-schema 4.1.1 | Jeremy Danyow                           | MIT          |
| fast-uri 3.1.8              | Gary Court and the Fastify team         | BSD-3-Clause |
| json-schema-typed 8.0.2     | Remy Rylan, and the JSON Schema authors | BSD-2-Clause |

It also compiles in content-type and fast-deep-equal (MIT), which the app ships as packages with their own license files too.

## YouTube's Gift prices

What each YouTube Gift costs in Jewels (`src/common/util/youtube.ts`) comes from `interfaz/compartido/regalos-youtube.js` of [tiktok-tts](https://github.com/iKhunsa/tiktok-tts) by iKhunsa (MIT, see [`LICENSES/YouTube-gift-prices.txt`](LICENSES/YouTube-gift-prices.txt)), which copied it from YouTube's "Send a gift" panel on 2026-11-02. The prices of Yes and Heart come from the test data of [YTLiveChat](https://github.com/Agash/YTLiveChat) by Agash Thamo (MIT). The gifts' pictures aren't shipped: they load from YouTube.

## Icons

The [react-icons](https://github.com/react-icons/react-icons) package (MIT) bundles icon sets that keep their own licenses. Tokio uses these sets; all of them were converted from SVG to React components by react-icons.

| Set (react-icons prefix)                         | Author                                                                | License                                                                                                                                                           |
| ------------------------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VS Code Codicons 0.0.35 (`vsc`)                  | Microsoft Corporation, <https://github.com/microsoft/vscode-codicons> | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), see [`LICENSES/CC-BY-4.0.txt`](LICENSES/CC-BY-4.0.txt)                                                 |
| Font Awesome Free 5.15.4 (`fa`)                  | Fonticons, Inc., <https://fontawesome.com>                            | Icons: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (<https://fontawesome.com/license/free>), see [`LICENSES/CC-BY-4.0.txt`](LICENSES/CC-BY-4.0.txt) |
| Material Design icons 4.0.0 (`md`)               | Google, <https://github.com/google/material-design-icons>             | [Apache-2.0](LICENSES/Apache-2.0.txt)                                                                                                                             |
| Feather (`fi`), Octicons (`go`), Phosphor (`pi`) | Their respective authors                                              | MIT                                                                                                                                                               |
| Lucide (`lu`)                                    | Lucide contributors                                                   | ISC                                                                                                                                                               |
| Simple Icons 12.14.0 (`si`)                      | Simple Icons contributors, <https://simpleicons.org>                  | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/); each logo stays its owner's trademark                                                              |

Check this table when adding an icon set: react-icons also contains sets under CC BY-SA, MPL-2.0 and other licenses with extra conditions.

## Services

Tokio talks to these online services. None of them is covered by Tokio's license or by the licenses above. Each one is subject to its operator's terms and can stop working at any time.

- **TikTok:** TikTok LIVE, through @tokioapp/connector, and TikTok's text-to-speech (the TikTok voices), when the user has added a TikTok session ID. Neither is an official public API.
- **TikTok TTS proxy** (`ottsy.weilbyte.dev`): the TikTok voices when no session ID is set. It gets the text of each message to read and its voice. It's run by a third party, not by TikTok or Tokio.
- **Euler Stream** (`tiktok.eulerstream.com`): signs the connection to TikTok LIVE, with each user's own API key.
- **Twitch** (`id.twitch.tv`, `api.twitch.tv`, `eventsub.wss.twitch.tv`): LIVE events, chat and viewer counts through Twitch's official API, with each user's own sign-in.
- **Microsoft:** Edge's Read Aloud service (the Edge voices), which isn't an official public API.
- **ElevenLabs** (`api.elevenlabs.io`): the ElevenLabs voices and voice cloning, with each user's own API key. It gets the text of each message to read, and the samples of a voice to clone.
- **Fish Audio** (`api.fish.audio`): the Fish Audio voices and voice cloning, with each user's own API key. It gets the text of each message to read, and the samples of a voice to clone.
- **Cartesia** (`api.cartesia.ai`): the Cartesia voices and voice cloning, with each user's own API key. It gets the text of each message to read, and the samples of a voice to clone.
- **Inworld** (`api.inworld.ai`): the Inworld voices and voice cloning, with each user's own API key. It gets the text of each message to read, and the samples of a voice to clone.
- **Google** (`translate.googleapis.com`): chat translation, through Google Translate's web service, which isn't an official public API. It gets the text of each message to translate.
- **Kick** (`kick.com`, `web.kick.com`, `realtime.*.platform.kick.com`): a channel's chat, subscriptions, Kicks, hosts and viewer count, read from Kick's website and its chat feed the way kick.com's page does, which isn't an official API.
- **Spotify:** music requests.
- **YouTube** (`www.youtube.com`): music requests, and a LIVE's chat, Super Chats, memberships, Gifts and viewer count, read from YouTube's public pages the way youtube.com does, which isn't an official API.
- **Frankfurter** (`api.frankfurter.dev`): the US dollar's exchange rates, to add up a LIVE's YouTube Super Chats in dollars, fetched at most once a day while YouTube is part of a LIVE. The rates are central banks' public reference rates; the service is free, open source (MIT) and needs no key.
- **uBlock Origin's filter lists** (`ublockorigin.github.io`, then its mirrors `ublockorigin.pages.dev` and `cdn.jsdelivr.net`): the YouTube player's ad blocker, when **Block ads** is on. uBlock Origin's own lists and its copies of EasyList and EasyPrivacy belong to their authors, are under the GPL-3.0 or CC BY-SA 3.0, and aren't covered by Tokio's license. Tokio downloads them on the user's machine and doesn't ship them.
- **Public Suffix List** (`publicsuffix.org`): the same ad blocker, to tell a site from its subdomains. Mozilla's list is under the MPL-2.0, and Tokio downloads it rather than ship it.
- **GitHub** (`github.com`, `api.github.com`): update checks and downloads, from Tokio's releases, and the official overlays (their list, previews and downloads), from the releases of `tokio-app/overlays`.
- **MyInstants** (`www.myinstants.com`): sound search and downloads for alerts, read from the public website rather than an official API. Its sounds are uploaded by its users and aren't covered by Tokio's license.
- **Lorem Picsum** (`picsum.photos`): sample pictures (profile pictures, emotes, song covers) in overlay tests and previews.
