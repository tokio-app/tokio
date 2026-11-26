---
paths:
  - "src/renderer/src/components/Welcome/**"
  - "src/renderer/src/components/Tour/**"
---

# First start

- The first `LOAD_APP` of a run replies `newStore: true` when there was no store file, not one rebuilt from a file that didn't load (`corruptedBackup()`), and `welcome` with it while the profile is untouched: TikTok alone, no names (`src/main/events/init.ts`).
- `welcome` opens the first-start dialog (`components/Welcome`), and the tour when it closes. It asks for one platform, its username or Twitch's sign-in (`TwitchSignIn`), TikTok's optional Euler key and the profile's name (the user's calls). The platform is a `radiogroup` of native radios.
- Save, or Enter through the form, sends only what changed (`SET_PLATFORMS`, `SET_CHANNELS`, `SET_PROVIDER`, `RENAME_PROFILE`) and waits for Layout's `GET_SETTINGS` reply, which names the profile and the provider. Skip, Escape and × send nothing: they ask first ("Skip setup?") when something was typed, and close at once otherwise.
- It sits near the window's top (`Modal`'s `top`), so switching platform moves only its foot, never the radios under the pointer.
- Its title must never be the tour's: `App.test.tsx` and e2e find the tour by "Welcome to Tokio".
- The tour (`components/Tour`) opens after that dialog, on its own on a `newStore` load without it, and again from About's **Take the tour** (the user's call).
- Each step lights one piece found by its `data-tour`: a sidebar icon by its page, or Home's `features` and `connect`. `App.test.tsx` fails when a piece is missing.
- A step is a sentence or two, titled with the app's own name for the piece (`nav.*`), in words that fit every platform (the user's call): no step names one platform's key, sign-in or tab.
