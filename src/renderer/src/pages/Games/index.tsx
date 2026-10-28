import { MediaFile } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE, GamesData } from "@/common/types";
import { Page } from "@/components";
import { useEditableSettings, useIpcListener, useIpcRequest } from "@/hooks";
import { useTriggerChoices } from "@/pages/Alerts/useTriggerChoices";
import { useRef, useState } from "react";
import { PicturePicker } from "./PicturePicker";
import { ActionsSection } from "./sections/ActionsSection";
import { MinecraftSection } from "./sections/MinecraftSection";
import { OverlaySection } from "./sections/OverlaySection";

export function Games() {
  // Until main's first push
  const [games, setGames] = useState<GamesData | null>(null);
  const { giftChoices, emoteChoices, emotes, setEmotes } = useTriggerChoices();
  const [serverEnabled, setServerEnabled] = useState(true);
  // Id of the action whose overlay picture is being picked
  const [pictureFor, setPictureFor] = useState<string | null>(null);
  // Actions waiting for main to save browsed pictures. A pick made since
  // drops the action, so a slow dialog can't replace it.
  const asked = useRef(new Set<string>());
  // Numbers the browses, and the newest one applied per action, so a late
  // reply to an older browse can't replace a newer one
  const counter = useRef(0);
  const applied = useRef(new Map<string, number>());
  // Each profile loaded, which the actions open on, on the tab of an
  // edition that has some
  const [loads, setLoads] = useState(0);

  const { settings, update } = useEditableSettings(
    "games",
    (profile, switched) => {
      setEmotes(profile.emotes);
      if (switched) {
        // A clone has the same action ids: a browse for the last profile
        // mustn't land in this one
        asked.current.clear();
        setLoads((n) => n + 1);
      }
    },
  );

  useIpcRequest(APP_EVENTS.GET_GAMES);
  useIpcRequest(APP_EVENTS.GET_SETTINGS);

  // The reply, then each change of a connection. A failed one keeps the
  // last shown.
  useIpcListener(APP_EVENTS_RESPONSE.GAMES, (res) => {
    if (res?.success && res.data) setGames(res.data);
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
    if (res.request <= (applied.current.get(res.id) ?? 0)) return;
    applied.current.set(res.id, res.request);
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
          key={loads}
          actions={settings.actions}
          connected={
            games?.status.minecraft.state === "connected"
              ? games.status.minecraft.edition
              : undefined
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
          onRequest={() => {
            asked.current.add(pictureAction.id);
            return ++counter.current;
          }}
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
