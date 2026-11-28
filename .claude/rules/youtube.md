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
- Gifts (`giftMessageViewModel`) carry no price and no channel id. They arrive as `GIFT` with `coins: 0` and a gift id from the picture's file name (`youtube:silver_star_v2_320x320`), named after the label's " sent a gift, " ("@handle sent a gift, Star"), else after the text's "sent ". Tokio keeps no price list: Gifts are only for some creators (the user's call, 2026-11-27).
  - A combo ("comboed x3 Yes for 6 Jewels") is one message: `comboCount` 3. Whether YouTube also sends a combo's gifts one by one is unchecked (`shortcut:` in the mapping).
  - Each Gift's card (`updateOrAddInteractivityWidgetAction`, `giftAttributionItemViewModel`) comes in the same poll before it, with the sender's channel id. The provider takes every card's handle before it maps the poll's items, so the Gift goes out as `youtube:<channel id>`. A card can come again for the same Gift, so cards are never counted.
  - The provider also remembers each handle's channel id from this LIVE's other events. Cards and events in the chat history at connect count too. It keeps the newest `IDS_KEPT` (10,000) handles used (`keepNewest`, `connector/common`); one that dropped out is a handle with neither.
  - A handle with neither keeps `youtube:@handle`, with no lookup, since Gifts come in bursts. That viewer then has two ids.
- A gifted membership counts once, from its purchase announcement, with the count read right after its text's "Sent" (a channel's name can hold digits), else 1; each recipient's redemption is dropped.
- Super Chat amounts stay as YouTube shows them (`amount`); their dollars are in `.claude/rules/live-session.md`.
- A listener's throw is logged (`_logOnce`) and drops only that event, never failing the poll, which would read as a drop.
- Placeholder items (`liveChatPlaceholderItemRenderer`) are messages held from readers and never filled in: ignored.
- A member's months (`subMonths`) come from the member badge's tooltip, in English since requests ask `hl=en`. "Member (1 year)" is 12, and "New member" sets none.
