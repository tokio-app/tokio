---
paths:
  - "src/main/services/tts/**"
  - "src/renderer/src/pages/TTS/**"
  - "src/renderer/src/components/VoiceSelect/**"
  - "src/renderer/src/pages/Settings/sections/VoiceKeysSection.tsx"
  - "scripts/edge-tts/**"
---

# TTS engines

- A provider extends `TTSProvider` (`src/main/services/tts/common`) and implements `label`, `getVoices` (may be async), `generateBuffer` and `setKey`. Set `keyLabel` if it takes a key. Override `dispose` (runs on `will-quit`) if it holds resources such as child processes.
- Providers aren't picked: `TTSService` treats each one as an engine, and its `addProvider` name is the engine id. `getVoices` lists every engine's voices as `VoiceData` (`{ engine, name, lang }`), and `generateBuffer` speaks with the voice's engine. A failing engine is logged and left out of the list.
- Voices saved before engines existed have `engine: ""`. Those, and voices naming an engine that isn't registered (Windows on macOS), go to the active provider: `settings.activeTTSProvider`, set by the store at startup. `generateBuffer` must still fall back to a default when given another engine's voice name.
- Engines with a `keyLabel` get a field in Settings → Voice Engines (`GET_VOICE_KEYS` / `SET_VOICE_KEY`). Their keys are saved encrypted in `settings.providers.tts` and applied to every engine at startup.
- `windows` drives SAPI and OneCore voices through a long-lived 32-bit PowerShell helper, so 32-bit-only voices such as Loquendo are visible. Its script in `common/script.ts` must not contain backticks.
- `edge` uses Microsoft's unofficial Read Aloud protocol. Read `providers/edge/README.md` before changing it. Volatile values live in its `config/index.ts`. Its `common/drm-v2.ts` is LGPL-3.0-only: see Licensing in `AGENTS.md`.
