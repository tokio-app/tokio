import { SavedEmote } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE, CustomGift } from "@/common/types";
import { useIpcListener, useIpcRequest } from "@/hooks";
import { useMemo, useState } from "react";
import { emoteOptions, giftOptions } from "./helper";

/**
 * The gifts and emotes a trigger can pick, for Alerts and Games. The page
 * sets the profile's emotes when it loads; main pushes new ones while
 * connected.
 */
export function useTriggerChoices() {
  const [gifts, setGifts] = useState<CustomGift[]>([]);
  // Gifts seen in LIVEs that TikTok's list doesn't have
  const [customGifts, setCustomGifts] = useState<CustomGift[]>([]);
  const [emotes, setEmotes] = useState<SavedEmote[]>([]);

  useIpcRequest(APP_EVENTS.GET_GIFTS);
  useIpcRequest(APP_EVENTS.GET_CUSTOM_GIFTS);

  useIpcListener(APP_EVENTS_RESPONSE.GET_GIFTS, (res) => {
    if (res) setGifts(res.data);
  });

  // The reply, then new ones while connected
  useIpcListener(APP_EVENTS_RESPONSE.CUSTOM_GIFTS, (res) => {
    if (res) setCustomGifts(res.data);
  });

  useIpcListener(APP_EVENTS_RESPONSE.EMOTES, (res) => {
    if (res) setEmotes(res.data);
  });

  const giftChoices = useMemo(
    () => giftOptions(gifts, customGifts),
    [gifts, customGifts],
  );
  const emoteChoices = useMemo(() => emoteOptions(emotes), [emotes]);

  return { giftChoices, emoteChoices, emotes, setEmotes };
}
