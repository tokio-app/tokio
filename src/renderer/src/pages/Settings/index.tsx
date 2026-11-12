import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { defaultStoreData } from "@/common/util";
import { Modal, Page } from "@/components";
import {
  useImmerState,
  useIpcListener,
  useIpcRequest,
  useServerSwitch,
} from "@/hooks";
import { useT } from "@/ui/i18n";
import { useState } from "react";
import { LanguageSection } from "./sections/LanguageSection";
import { LogsSection } from "./sections/LogsSection";
import { CloneProfileModal, NewProfileModal } from "./sections/ProfileModals";
import { ProfileSection } from "./sections/ProfileSection";
import { ProvidersSection } from "./sections/ProvidersSection";
import { ServerSection } from "./sections/ServerSection";
import { TraySection } from "./sections/TraySection";
import { UpdatesSection } from "./sections/UpdatesSection";
import { VoiceKeysSection } from "./sections/VoiceKeysSection";

type ModalType = "newProfile" | "cloneProfile" | "confirmDebug";

export function Settings() {
  const t = useT();
  const [store, updateStore, setStore] = useImmerState(defaultStoreData);
  const [modal, setModal] = useState<ModalType | null>(null);
  const [connected, setConnected] = useState(false);

  const setServerEnabled = (enabled: boolean) =>
    updateStore((s) => {
      s.settings.server.enabled = enabled;
    });
  const server = useServerSwitch(setServerEnabled);

  const setDebug = (debug: boolean) =>
    updateStore((s) => {
      s.settings.logs.debug = debug;
    });

  useIpcRequest(APP_EVENTS.GET_SETTINGS);
  useIpcRequest(APP_EVENTS.IS_CONNECTED);

  useIpcListener(APP_EVENTS_RESPONSE.CONNECTED, (res) => {
    if (res) setConnected(res.success);
  });

  useIpcListener(APP_EVENTS_RESPONSE.GET_SETTINGS, (res) => {
    if (res?.success) setStore(res.data!);
  });

  const closeModal = () => setModal(null);

  return (
    <>
      {server.asking && (
        <Modal
          title={t("settings.server.confirmTitle")}
          description={t("settings.server.confirmDescription")}
          confirmText={t("settings.server.enable")}
          onClose={server.cancel}
          onConfirm={server.confirm}
        />
      )}

      {modal === "confirmDebug" && (
        <Modal
          title={t("settings.logs.confirmTitle")}
          description={t("settings.logs.confirmDescription")}
          confirmText={t("settings.logs.enable")}
          onClose={closeModal}
          onConfirm={() => {
            setDebug(true);
            closeModal();
            window.api.emit(APP_EVENTS.SET_LOGS, { enabled: true });
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
          onChange={server.toggle}
        />

        <LanguageSection
          language={store.settings.language}
          onChange={(language) => {
            updateStore((s) => {
              s.settings.language = language;
            });
            window.api.emit(APP_EVENTS.SET_LANGUAGE, { language });
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

        <TraySection
          enabled={store.settings.tray.enabled}
          onChange={(enabled) => {
            updateStore((s) => {
              s.settings.tray.enabled = enabled;
            });
            window.api.emit(APP_EVENTS.SET_TRAY, { enabled });
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

        <LogsSection
          debug={store.settings.logs.debug}
          onChange={(debug) => {
            if (debug) {
              setModal("confirmDebug");
            } else {
              setDebug(false);
              window.api.emit(APP_EVENTS.SET_LOGS, { enabled: false });
            }
          }}
        />
      </Page>
    </>
  );
}
