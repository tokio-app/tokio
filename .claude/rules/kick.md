---
paths:
  - "src/main/services/connector/providers/kick/**"
---

# Kick

Builds on `.claude/rules/platforms.md`.

- Kick connects with no key and no sign-in, through our own provider rather than the `kicksdk-js` package (the user's call): Kick's website API and its chat feed, read the way kick.com's page does. The profile's `channels.kick` is the channel's name or kick.com link.

## The provider

- Everything goes through kick.com's own API and chat feed, as a guest: `GET kick.com/api/v2/channels/<slug>` gives the channel id, the chatroom id (a different number) and whether it's live; `web.kick.com/api/v1/realtime` gives the feed's server and a 45-minute guest token; the socket is Kick's Centrifugo server. Kick's notes come from kicksdk's `docs/KICK.md` (Apache-2.0, read as a reference, never copied).
- Every request and the socket send `User-Agent: Tokio/<version>`. Kick answers a non-browser that sends a browser's user agent with 403 "Request blocked by security policy", so never make Tokio pretend to be a browser. The socket also has to send `Origin: https://kick.com`, or its handshake gets a 403.
- The feeds are `chatrooms.<chatroom>.v2` (chat, subs, hosts), `chatroom_<chatroom>` (gifted subs, reward redemptions), `channel.<channel>` (live and offline) and `channel_<channel>` (Kicks). Never `chatrooms.<chatroom>`: it repeats every host. A publication's `data` is a JSON string inside the JSON.
- The token is refreshed at 80% of its life for the same client id. Closes coded 3500-3999 and 4500-4999 are terminal: wait 5 minutes, doubling up to 30, then come back as a new client id. Any other drop reconnects from 1 s, doubling up to 30 s, never giving up; a reconnect redoes the lookup, which is how it learns the stream ended while away.
- It connects while the channel is offline (the chat is the channel's), like Twitch, and `StopStreamBroadcast` ends the connection only for a stream seen live. Viewers come from the lookup every 60 s while live, and two offline answers in a row end the stream, in case the feed missed `StopStreamBroadcast` (one could be a glitch).
- A viewer's Kicks are one `KICKS`, the amount picked on Kick's slider in `kicks` and the message pinned with them in `message`. Kick's feed calls it `KicksGifted` with a gift for the amount's tier, which Tokio ignores. A row saved while Kicks were gifts (`GIFT` on Kick) loads as a Kicks row (`kicksRow`, `src/common/schemas/profile.ts`).
- Hosts and redemptions name the viewer only by username, so they have no `userId`. Every event's `handle` is the slug chat's `sender.slug` holds (`slugOf` of the username elsewhere), so a block list matches every event by one name.
- Subs and gifted subs name their viewer only by username too, so the provider finds their id (`_withId`) (`kick:<id>`) in this LIVE's chat and Kicks, by username in any case, else with one lookup of their channel by `slugOf` (lowercase, `_` as `-`; the raw username is a 404). The lookup's `user_id` is chat's `sender.id` (checked 2026-11-22).
  - The answer is kept for the connection, failures included, each failure logged once per name. After a failed lookup the event goes out without an id.
  - A lookup holds that event back by its round trip, so it can come after events that arrived behind it.
- The feed is unofficial and changed from Pusher to Centrifugo in October 2026. An event Tokio can't read is dropped and logged once per name, never thrown out of the socket's listener.
- A subscriber's months (`subMonths`) are the `subscriber` or `founder` badge's `count` (checked on kick.com's chat, 2026-11-23).
