# Edge TTS provider

The "Edge" TTS provider uses Microsoft Edge's Read Aloud service: about 320 neural voices, free, with no key. The protocol is **unofficial** and Microsoft changes it from time to time. This file explains how to find out what broke and how to fix it.

The reference implementation is [rany2/edge-tts](https://github.com/rany2/edge-tts), a Python project licensed under LGPLv3. When the provider breaks, upstream has usually fixed it already.

**Last synced with upstream:** `master` at `b2ffbdd9f43f28f03cc939b5de0f3964aa62d60e` (2026-10-13, "Fix locale-dependent server date parsing").

## Files

| File                 | Upstream reference                  | Contents                                                                                                                       |
| -------------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `config/index.ts`    | `constants.py`                      | Every value Microsoft can change: client token, Chromium version, URLs, Origin, headers, output format, token versions to try. |
| `common/drm.ts`      | `drm.py`                            | Token versions, clock-skew correction, MUID cookie, the 403 retry loop.                                                        |
| `common/drm-v2.ts`   | `drm.py` (`generate_sec_ms_gec_v2`) | v2 token generator. **LGPL-3.0**, see below.                                                                                   |
| `common/protocol.ts` | `communicate.py`, `voices.py`       | Voice list request, WebSocket messages, SSML, frame parsing, text chunking.                                                    |
| `common/errors.ts`   | n/a                                 | `EdgeTTSError`, which carries the failing stage, HTTP status and token versions.                                               |
| `index.ts`           | n/a                                 | The `EdgeTTS` provider: voice list cache, voice mapping, fallback to the default voice.                                        |

## Diagnosing a break

1. Run the live check, which uses the real provider code:

   ```sh
   yarn tts:edge:check
   yarn tts:edge:check --voice es-MX-DaliaNeural --text "Hola" --out test.mp3
   ```

   It prints `PASS`/`FAIL` for the `voices` and `synthesis` stages and exits with code 1 on any failure. The token v2 reference vectors need no network, so they live in `common/drm.test.ts` and run with `yarn test`.

2. Or read the user's log. Every provider error is logged as `<tts> Unable to generate audio - Edge <stage> ...`, with the HTTP status and token versions when they apply.

| Symptom                                                             | Likely cause                                              | Fix                                                                                                                                                                                                            |
| ------------------------------------------------------------------- | --------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `handshake`/`voices` HTTP 403 `Rejected for every token version`    | Chromium version, token algorithm or client token changed | Compare upstream `constants.py` (`CHROMIUM_FULL_VERSION`, `SEC_MS_GEC_VERSION`, `TRUSTED_CLIENT_TOKEN`) and `drm.py`. Try a candidate first with `--chromium <version>`. The Chromium version **is** enforced. |
| HTTP 403 on synthesis with one token version only                   | Microsoft enforces a newer token version on that endpoint | Put the newer version first in `TOKEN_VERSIONS`. Since 2026-10, synthesis needs v2; the voice list still accepts v1.                                                                                           |
| `yarn test` fails on the token v2 vectors in `common/drm.test.ts`   | `drm-v2.ts` was edited incorrectly                        | Diff it against upstream `drm.py`.                                                                                                                                                                             |
| `synthesis` `Socket closed ... (code 1007, Unsupported voice X)`    | Voice retired, or the profile holds a bad name            | Normally prevented: the provider falls back to `DEFAULT_VOICE` when the voice isn't in the list. Check `DEFAULT_VOICE` still exists.                                                                           |
| `synthesis` socket closed with another code, or an unexpected frame | Message format changed                                    | Compare `communicate.py` (`send_command_request`, `ssml_headers_plus_data`, `mkssml`, the frame parsing in `__stream`).                                                                                        |
| `no-audio`                                                          | Service accepted the request but sent no audio            | Check `OUTPUT_FORMAT` and the SSML against upstream.                                                                                                                                                           |
| `timeout` / `network`                                               | User's connection, firewall or proxy                      | Nothing to fix in the code.                                                                                                                                                                                    |

## Adding a new token version

1. Port the upstream generator into its **own file**, e.g. `common/drm-v3.ts`, as `(ticks: string, clientToken: string) => string`. `ticks` is the 5-minute-floored Windows file time that `drm.ts` passes in. Upstream code is LGPLv3, so the port is LGPL-3.0-only. Give it the same header as `drm-v2.ts` (SPDX line, upstream commit, original authors, dated modification notice). List it in `THIRD_PARTY_NOTICES.md` at the repository root and in the banner in `electron.vite.config.ts`.
2. Add the version to `TokenVersion` in `types/index.ts` and to `TOKEN_GENERATORS` in `common/drm.ts`.
3. Put it first in `TOKEN_VERSIONS` in `config/index.ts`. The 403 loop falls back to the older versions.
4. Generate reference vectors with upstream, for example `generate_sec_ms_gec_v2(1700000000)`. Add them to `common/drm.test.ts` and run `yarn test`.

## Licensing

`common/drm-v2.ts` is derived from LGPLv3 code and stays **LGPL-3.0-only**. Its header carries the upstream attribution and the modification notice. The rest of this provider is MIT, like the rest of the repository. Repository-wide details are in `THIRD_PARTY_NOTICES.md`.

Rules for contributors:

- **Keep LGPL code isolated.** Code ported or adapted from edge-tts goes only into its own LGPL file, never into the MIT files.
- **The MIT files are independent implementations of the protocol.** The message formats, headers, URLs and constants are facts of Microsoft's protocol. Compare them with upstream to find what changed, then write the fix yourself rather than copying upstream code.
- **Keep the header and dated modification notices** in LGPL files when you change them (GPLv3 §5a, which the LGPLv3 incorporates).
- **Keep the notices in the build.** The bundler drops file header comments, so `electron.vite.config.ts` adds a license banner to `out/main/index.js`, and `electron-builder.yml` ships `LICENSE`, `THIRD_PARTY_NOTICES.md` and `LICENSES/` to `resources/licenses`. Update both if LGPL files are added or renamed.
