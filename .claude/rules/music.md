---
paths:
  - "src/main/services/music/**"
  - "src/main/events/pages/music.ts"
  - "src/renderer/src/pages/Music/**"
---

# Music

- `createWindow(view)` (`services/music/common`) places a provider's page under the music window's title bar.

## Chat commands

- `MusicService._match` matches a control's command with `startsWithCommand` (`src/main/helper/chat.ts`): in any case, alone or followed by a space. Chat translation uses it too, to leave music commands untranslated (`.claude/rules/translation.md`), so a change there changes both.
- `!next` skips only to a waiting request; the live controls' skip also presses the player's own Next (`.claude/rules/controls.md`).

## YouTube's player

- Connecting doesn't ask for an account: YouTube connects once a `music.youtube.com` page loads, signed in or not, and the streamer signs in from YouTube Music's own page if they want to (the user's call). Never send the page to Google's sign-in or clear its session to force one. A page that loads first, like Google's sign-in or a consent page, doesn't count.
- After about 40 minutes with nobody at the page, YouTube Music pauses each song a few seconds in, behind "Video paused. Continue watching?". `KeepPlayingJSCode` answers it from an isolated world (`KEEP_PLAYING_WORLD`) on each page load. A real check takes that long, and can't run under Playwright: it sets `navigator.webdriver`, and YouTube then stops each stream 40 to 60 seconds in. Use a plain Electron script with the player's setup.

## YouTube's ad blocker

- **Block ads** (`music.provider.block_ads`, off by default) asks first, with YouTube's own warning that blocking its ads breaks its Terms of Service and may stop playback (the user's call). Turning it off doesn't ask.
- The engine is ours, `@tokioapp/adblock` (`tokio-app/adblock`, locally `../tokio-adblock`, with its own `AGENTS.md` and clean-room rule). Fix rules, scriptlets or stand-ins there, release it, then upgrade it here with the `add-dependency` skill.
- `AdBlocker` (`providers/youtube/common/adblock.ts`) applies uBlock Origin's default lists except the malware list and Peter Lowe's (`ADBLOCK_LISTS`, the user's call), saved in `extra/adblock/`.
- At startup when the active profile blocks ads, and as soon as it's turned on, Tokio only downloads the lists that expired (`AdBlocker.update`), so YouTube's connect doesn't wait for the network. It checks at most once an hour: every Music autosave with Block ads on asks for it (`prepareAdBlocker`), and each check reads every saved list, about 7 MB. Don't add a read to the save handler instead: an `await` before its `updateProfileData` reopens a race with MCP writes.
- The blocker itself is built when YouTube connects and freed when the session ends (the user's call): its rules hold about 30 MB of main's memory and take half a second to build, which every start paid when it was built at startup.
- Connecting waits for the blocker: its preload and scriptlets only reach pages loaded after `enable()`, and the player loads one page per connect. It waits for an update still running first, so no list downloads twice, then gives up when its connect ended meanwhile (`ready(current)`): the window's close found no blocker to free, so one built after it would stay. With no list saved or downloaded, connecting tries once more, then plays with ads and a warning.
- `adblockScheme` is in the app's one `protocol.registerSchemesAsPrivileged` call (`src/main/index.ts`). The stand-ins for ad scripts load from it, and a second call would replace the first.
- The blocker owns `webRequest.onBeforeRequest` and `onHeadersReceived` in `persist:music-youtube` (Electron keeps one listener per event) and IPC channels app-wide, so the app has one `AdBlocker`, in `YouTubeMusic`.
- The player has no `nodeIntegrationInSubFrames` (the user's call): frames get their requests filtered, but no scriptlets or cosmetic filters.
- A connect without it frees the blocker and its lists, and so does the end of a session with it; the next connect with it makes a new one.
