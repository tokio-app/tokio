# Third-party notices

## Summary

| What                                                    | License                                                                                                                          |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Tokio's own source code in this repository              | MIT ([`LICENSE`](LICENSE)), except the file below                                                                                |
| `src/main/services/tts/providers/edge/common/drm-v2.ts` | LGPL-3.0-only ([`LICENSES/LGPL-3.0.txt`](LICENSES/LGPL-3.0.txt), which builds on [`LICENSES/GPL-3.0.txt`](LICENSES/GPL-3.0.txt)) |
| **The distributed application**                         | **AGPL-3.0-only** as a whole ([`LICENSES/AGPL-3.0.txt`](LICENSES/AGPL-3.0.txt)), because it includes the AGPL dependencies below |

Tokio's own files stay MIT and can be reused under MIT on their own. The application built from them includes `tiktok-live-connector` and `tiktok-live-proto`, which are licensed AGPL-3.0-only. So anyone who distributes the application, modified or not, must do so under the AGPL-3.0, including making the complete corresponding source available.

**Corresponding source.** The complete source of Tokio is published at <https://github.com/tokio-app/tokio>, and every released version is built from it. The exact dependency versions are pinned in `yarn.lock`. See the README for build instructions (`yarn build:win`).

**Licenses in the app.** `LICENSE`, this notice and the `LICENSES/` folder are installed with the application, in its `resources/licenses` folder. Every npm dependency ships with its own license file inside `resources/app.asar`, under `node_modules/<package>/`. The About page of the app shows these notices, the license texts and the license of every npm package it ships.

## AGPL-3.0-only dependencies

### tiktok-live-connector

|             |                                                                                       |
| ----------- | ------------------------------------------------------------------------------------- |
| **Version** | 2.4.3 (licensed AGPL-3.0-only since 2.4.1; 2.4.0 and earlier were MIT)                |
| **Author**  | zerodytrash and contributors                                                          |
| **Source**  | <https://github.com/zerodytrash/TikTok-Live-Connector>                                |
| **Use**     | Unmodified npm dependency. It connects to TikTok LIVE and provides the stream events. |

### tiktok-live-proto

|             |                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------- |
| **Version** | 0.2.4 (licensed AGPL-3.0-only since 0.2.4; 0.2.3 and earlier were MIT)                            |
| **Source**  | <https://github.com/isaackogan/TikTok-Webcast-Protobuf>                                           |
| **Use**     | Unmodified npm dependency of tiktok-live-connector. It contains the TikTok LIVE protocol schemas. |

**Network use (AGPL §13).** Tokio uses these packages unmodified, and its overlay server only listens on the local machine. If you modify these packages and let users interact with your modified version over a network, §13 requires you to offer those users its source.

## LGPL-3.0-only code: edge-tts

|                      |                                                                                                                                                      |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| **File**             | [`src/main/services/tts/providers/edge/common/drm-v2.ts`](src/main/services/tts/providers/edge/common/drm-v2.ts)                                     |
| **Derived from**     | `src/edge_tts/drm.py` (`generate_sec_ms_gec_v2`) of [edge-tts](https://github.com/rany2/edge-tts), commit `b2ffbdd9f43f28f03cc939b5de0f3964aa62d60e` |
| **Original authors** | rany \<ranygh@riseup.net\> and the edge-tts contributors (v2 token support co-authored by HarryXiaoCN)                                               |
| **Modifications**    | Ported from Python to TypeScript by Italo Alfaro, 2026-10-14                                                                                         |

This file generates the `Sec-MS-GEC` token required by Microsoft Edge's Read Aloud service, which the "Edge" TTS provider uses. You may modify it, or replace it with a modified version, and rebuild the application from the repository. The rest of the Edge provider (`src/main/services/tts/providers/edge/`, except `common/drm-v2.ts`) is an independent MIT implementation of the same service protocol; edge-tts is only used there as a reference for the protocol's behavior.

## Other dependencies

All other npm dependencies are under permissive licenses. A scan of the 180 production packages on 2026-10-14 found MIT, BSD-2-Clause, BSD-3-Clause, ISC, Apache-2.0, 0BSD, Unlicense, CC0-1.0, BlueOak-1.0.0 and Python-2.0. Their license files are shipped with the application as described above, including those of libraries bundled into the user interface (such as React). That scan reads package-level licenses only. Content inside a package can carry its own license, as the icons below do.

Re-check when adding or upgrading dependencies, since licenses can change between versions, as tiktok-live-connector's did. Electron's and Chromium's licenses are included by Electron as `LICENSE.electron.txt` and `LICENSES.chromium.html` in the installation folder.

## Icons

The [react-icons](https://github.com/react-icons/react-icons) package (MIT) bundles icon sets that keep their own licenses. Tokio uses these sets; all of them were converted from SVG to React components by react-icons.

| Set (react-icons prefix)                                                 | Author                                                                | License                                                                                                                                                           |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VS Code Codicons 0.0.35 (`vsc`)                                          | Microsoft Corporation, <https://github.com/microsoft/vscode-codicons> | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/), see [`LICENSES/CC-BY-4.0.txt`](LICENSES/CC-BY-4.0.txt)                                                 |
| Font Awesome Free 5.15.4 (`fa`)                                          | Fonticons, Inc., <https://fontawesome.com>                            | Icons: [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) (<https://fontawesome.com/license/free>), see [`LICENSES/CC-BY-4.0.txt`](LICENSES/CC-BY-4.0.txt) |
| Material Design icons 4.0.0 (`md`)                                       | Google, <https://github.com/google/material-design-icons>             | [Apache-2.0](LICENSES/Apache-2.0.txt)                                                                                                                             |
| Feather (`fi`), Octicons (`go`), Bootstrap Icons (`bs`), Phosphor (`pi`) | Their respective authors                                              | MIT                                                                                                                                                               |
| Lucide (`lu`)                                                            | Lucide contributors                                                   | ISC                                                                                                                                                               |

Check this table when adding an icon set: react-icons also contains sets under CC BY-SA, MPL-2.0 and other licenses with extra conditions.

## Services

Tokio talks to these online services. None of them is covered by Tokio's license or by the licenses above. Each one is subject to its operator's terms and can stop working at any time.

- **TikTok:** TikTok LIVE, through tiktok-live-connector, and TikTok's text-to-speech (the TikTok voices). Neither is an official public API.
- **Euler Stream** (`api.eulerstream.com`): request signing used by tiktok-live-connector.
- **Microsoft:** Edge's Read Aloud service (the Edge voices), which isn't an official public API.
- **Spotify and YouTube:** music requests.
- **GitHub** (`github.com`, `api.github.com`): update checks and downloads, from Tokio's releases, and the official overlays (their list, previews and downloads), from the releases of `tokio-app/overlays`.
- **MyInstants** (`www.myinstants.com`): sound search and downloads for alerts, read from the public website rather than an official API. Its sounds are uploaded by its users and aren't covered by Tokio's license.
