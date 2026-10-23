import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { defaultStoreData } from "@/common/util";
import { Modal, Page } from "@/components";
import { useImmerState, useIpcListener, useIpcRequest } from "@/hooks";
import { useState } from "react";
import { MediaSection } from "./sections/MediaSection";
import { OverlaysSection } from "./sections/OverlaysSection";
import { CloneProfileModal, NewProfileModal } from "./sections/ProfileModals";
import { ProfileSection } from "./sections/ProfileSection";
import { ProvidersSection } from "./sections/ProvidersSection";
import { ServerSection } from "./sections/ServerSection";
import { SoundsSection } from "./sections/SoundsSection";
import { UpdatesSection } from "./sections/UpdatesSection";
import { VoiceKeysSection } from "./sections/VoiceKeysSection";

type ModalType = "newProfile" | "cloneProfile" | "confirmServer";

export function Settings() {
  const [store, updateStore, setStore] = useImmerState(defaultStoreData);
  const [modal, setModal] = useState<ModalType | null>(null);
  const [connected, setConnected] = useState(false);

  const setServerEnabled = (enabled: boolean) =>
    updateStore((s) => {
      s.settings.server.enabled = enabled;
    });

  useIpcRequest(APP_EVENTS.GET_SETTINGS);
  useIpcRequest(APP_EVENTS.IS_CONNECTED);

  useIpcListener(APP_EVENTS_RESPONSE.CONNECTED, (res) => {
    if (res) setConnected(res.success);
  });

  useIpcListener(APP_EVENTS_RESPONSE.GET_SETTINGS, (res) => {
    if (res?.success) setStore(res.data!);
  });

  useIpcListener(APP_EVENTS_RESPONSE.REQ_FQDN, (res) => {
    setServerEnabled(res?.success ?? false);
    if (res?.success) window.api.emit(APP_EVENTS.SET_SERVER, { enabled: true });
  });

  const closeModal = () => setModal(null);

  return (
    <>
      {modal === "confirmServer" && (
        <Modal
          title="Enable Overlay Server?"
          description="Starting the local overlay server will open the specified port on your network to allow OBS and other browser sources to connect. Are you sure you want to proceed?"
          confirmText="Enable Server"
          onClose={closeModal}
          onConfirm={() => {
            setServerEnabled(true);
            closeModal();
            window.api.emit(APP_EVENTS.REQ_FQDN);
          }}
        />
      )}

      {modal === "newProfile" && <NewProfileModal onClose={closeModal} />}

      {modal === "cloneProfile" && (
        <CloneProfileModal
          profiles={store.profiles}
          active={store.settings.activeProfile}
          onClose={closeModal}
        />
      )}

      <Page width="wide" layout="aside">
        {/* First: connecting needs its key */}
        <ProvidersSection settings={store.settings} />

        <ServerSection
          enabled={store.settings.server.enabled}
          onChange={(enabled) => {
            if (enabled) {
              setModal("confirmServer");
            } else {
              setServerEnabled(false);
              window.api.emit(APP_EVENTS.SET_SERVER, { enabled: false });
            }
          }}
        />

        <UpdatesSection
          enabled={store.settings.updates.auto}
          onChange={(enabled) => {
            updateStore((s) => {
              s.settings.updates.auto = enabled;
            });
            window.api.emit(APP_EVENTS.SET_AUTO_UPDATES, { enabled });
          }}
        />

        <VoiceKeysSection />

        <ProfileSection
          profiles={store.profiles}
          active={store.settings.activeProfile}
          locked={connected}
          onNew={() => setModal("newProfile")}
          onClone={() => setModal("cloneProfile")}
        />

        <SoundsSection />

        <MediaSection />

        <OverlaysSection />
      </Page>
    </>
  );
}
