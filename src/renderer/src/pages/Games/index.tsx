import { SavedEmote } from "@/common/schemas";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  CustomGift,
  GamesData,
} from "@/common/types";
import { Page } from "@/components";
import { useEditableSettings, useIpcListener, useIpcRequest } from "@/hooks";
import { emoteOptions, giftOptions } from "@/pages/Alerts/helper";
import { useMemo, useState } from "react";
import { ActionsSection } from "./sections/ActionsSection";
import { MinecraftSection } from "./sections/MinecraftSection";

export function Games() {
  // Until main's first push
  const [games, setGames] = useState<GamesData | null>(null);
  const [gifts, setGifts] = useState<CustomGift[]>([]);
  // Gifts seen in LIVEs that TikTok's list doesn't have
  const [customGifts, setCustomGifts] = useState<CustomGift[]>([]);
  const [emotes, setEmotes] = useState<SavedEmote[]>([]);

  const { settings, update } = useEditableSettings("games", (profile) =>
    setEmotes(profile.emotes),
  );

  useIpcRequest(APP_EVENTS.GET_GAMES);
  useIpcRequest(APP_EVENTS.GET_GIFTS);
  useIpcRequest(APP_EVENTS.GET_CUSTOM_GIFTS);

  // The reply, then each change of a connection. A failed one keeps the
  // last shown.
  useIpcListener(APP_EVENTS_RESPONSE.GAMES, (res) => {
    if (res?.success && res.data) setGames(res.data);
  });

  useIpcListener(APP_EVENTS_RESPONSE.GET_GIFTS, (res) => {
    if (res) setGifts(res.data);
  });

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

  return (
    <Page width="wide">
      {games && (
        <MinecraftSection
          games={games}
          onToggle={(enabled) => {
            const changed = { ...games.settings, minecraft: { enabled } };
            window.api.emit(APP_EVENTS.SET_GAMES_SETTINGS, {
              settings: changed,
            });
            // Main's push brings the status
            setGames({ ...games, settings: changed });
          }}
        />
      )}

      <ActionsSection
        actions={settings.actions}
        edition={
          (games?.status.minecraft.state === "connected" &&
            games.status.minecraft.edition) ||
          "bedrock"
        }
        gifts={giftChoices}
        emotes={emoteChoices}
        update={update}
      />
    </Page>
  );
}
