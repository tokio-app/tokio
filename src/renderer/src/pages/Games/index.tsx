import { MediaFile, SavedEmote } from "@/common/schemas";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  CustomGift,
  GamesData,
} from "@/common/types";
import { Page } from "@/components";
import { useEditableSettings, useIpcListener, useIpcRequest } from "@/hooks";
import { emoteOptions, giftOptions } from "@/pages/Alerts/helper";
import { useMemo, useRef, useState } from "react";
import { PicturePicker } from "./PicturePicker";
import { ActionsSection } from "./sections/ActionsSection";
import { MinecraftSection } from "./sections/MinecraftSection";
import { OverlaySection } from "./sections/OverlaySection";

export function Games() {
  // Until main's first push
  const [games, setGames] = useState<GamesData | null>(null);
  const [gifts, setGifts] = useState<CustomGift[]>([]);
  // Gifts seen in LIVEs that TikTok's list doesn't have
  const [customGifts, setCustomGifts] = useState<CustomGift[]>([]);
  const [emotes, setEmotes] = useState<SavedEmote[]>([]);
  const [serverEnabled, setServerEnabled] = useState(true);
  // Id of the action whose overlay picture is being picked
  const [pictureFor, setPictureFor] = useState<string | null>(null);
  // Actions waiting for main to save browsed pictures. A pick made since
  // drops the action, so a slow dialog can't replace it.
  const asked = useRef(new Set<string>());

  const { settings, update } = useEditableSettings("games", (profile) =>
    setEmotes(profile.emotes),
  );

  useIpcRequest(APP_EVENTS.GET_GAMES);
  useIpcRequest(APP_EVENTS.GET_GIFTS);
  useIpcRequest(APP_EVENTS.GET_CUSTOM_GIFTS);
  useIpcRequest(APP_EVENTS.GET_SETTINGS);

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

  useIpcListener(APP_EVENTS_RESPONSE.GET_SETTINGS, (res) => {
    if (res?.success) setServerEnabled(res.data!.settings.server.enabled);
  });

  const setPicture = (id: string, picture: MediaFile | null) =>
    update((s) => {
      const action = s.actions.find((a) => a.id === id);
      if (action) action.overlay.image = picture;
    });

  // A browse still applies after its picker closed
  useIpcListener(APP_EVENTS_RESPONSE.SET_MINECRAFT_PICTURE, (res) => {
    if (!res?.success || !res.picture || !asked.current.has(res.id)) return;
    setPicture(res.id, res.picture);
  });

  // A deleted picture leaves the actions shown, as main took it off every
  // profile's: the next save mustn't bring it back
  useIpcListener(APP_EVENTS_RESPONSE.MINECRAFT_PICTURE_REMOVED, (res) => {
    if (!res) return;
    update((s) => {
      for (const action of s.actions) {
        if (action.overlay.image?.file === res.file)
          action.overlay.image = null;
      }
    });
  });

  const giftChoices = useMemo(
    () => giftOptions(gifts, customGifts),
    [gifts, customGifts],
  );
  const emoteChoices = useMemo(() => emoteOptions(emotes), [emotes]);
  const pictureAction = settings.actions.find((a) => a.id === pictureFor);

  return (
    <>
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

        <OverlaySection
          games={settings}
          gifts={giftChoices}
          emotes={emotes}
          serverEnabled={serverEnabled}
          update={update}
          onPickPicture={setPictureFor}
        />
      </Page>

      {pictureAction && (
        <PicturePicker
          id={pictureAction.id}
          picture={pictureAction.overlay.image}
          onRequest={() => asked.current.add(pictureAction.id)}
          onSelect={(picture) => {
            asked.current.delete(pictureAction.id);
            setPicture(pictureAction.id, picture);
          }}
          onClose={() => setPictureFor(null)}
        />
      )}
    </>
  );
}
