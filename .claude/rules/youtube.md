---
paths:
  - "src/main/services/connector/providers/youtube/**"
  - "test/main/youtube.ts"
---

# YouTube

Builds on `.claude/rules/platforms.md`.

- YouTube connects with no key and no sign-in (the user's call): Tokio reads the LIVE's public chat the way youtube.com does, accepting YouTube's terms and that a change to its site can break it. The profile's `channels.youtube` is the handle or link typed on Home.

## The provider

- Everything comes from YouTube's public pages, as youtube.com reads them: `/@handle/live` finds the LIVE (a 404 is `notFound`; a canonical link to `/channel/…`, or `isUpcoming`, is `offline`), the chat page gives the **Live chat** continuation (Top chat filters messages), `get_live_chat` is polled, and `updated_metadata` gives the viewers every 30 s. Bare input is a handle, since an 11-character handle looks like a video id; only links give a video id.
- Every request sends a desktop Chrome user agent, `hl=en&gl=US` and the `SOCS` cookie. The mapping reads English text ("Sent 20 … gift memberships", "sent Vice City heart", "Member for 6 months") and amounts as en-US shows them ("$4.99", "MX$100.00"), and the cookie answers the EU consent page, which would otherwise come instead of the LIVE.
- The first `get_live_chat` answer is the chat's recent history and is dropped whole: Gifts carry no timestamp, so a time filter would let old ones through.
- The end shows first in `updated_metadata`: within 30 s its viewership renderer loses `isLive` (it doesn't turn false) and counts the video's views ("72,481 views", "Streamed live …"), while the chat keeps answering for minutes. A missing `isLive` ends the connection with `ended`, and its count is never sent as viewers; a chat answer without a continuation ends it too.
- Gifts (`giftMessageViewModel`) carry no price and no channel id. They arrive as `GIFT` with `coins: 0` (`shortcut:` in `providers/youtube`) and a gift id from the picture's file name.
  - Everyone else's id is `youtube:<channel id>`. The provider remembers each handle's channel id from this LIVE's other events (the chat history at connect included), and sends a Gift under `youtube:<channel id>` when it knows it.
  - A handle it hasn't seen keeps `youtube:@handle`, with no lookup, since a Gift has no price and they come in bursts. That viewer then has two ids.
- A gifted membership counts once, from its purchase announcement, with the count read right after its text's "Sent" (a channel's name can hold digits), else 1; each recipient's redemption is dropped.
- Super Chat amounts stay as YouTube shows them (`amount`); their dollars are in `.claude/rules/live-session.md`.
- Placeholder items (`liveChatPlaceholderItemRenderer`) are messages held from readers and never filled in: ignored.
- A member's months (`subMonths`) come from the member badge's tooltip, in English since requests ask `hl=en`. "Member (1 year)" is 12, and "New member" sets none.
