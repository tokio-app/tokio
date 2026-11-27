import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  CONTROL_ACTIONS,
  ControlAction,
} from "@/common/types";
import { defaultStoreData } from "@/common/util";
import { DeleteProfileModal, Modal, Page } from "@/components";
import {
  useImmerState,
  useIpcListener,
  useIpcRequest,
  useProfilePlatforms,
  useServerSwitch,
} from "@/hooks";
import { useT } from "@/ui/i18n";
import { useState } from "react";
import { AssistantsSection } from "./sections/AssistantsSection";
import { LanguageSection } from "./sections/LanguageSection";
import { LogsSection } from "./sections/LogsSection";
import {
  CloneProfileModal,
  NewProfileModal,
  RenameProfileModal,
} from "./sections/ProfileModals";
import { ProfileSection } from "./sections/ProfileSection";
import { ProvidersSection } from "./sections/ProvidersSection";
import { RemoteSection } from "./sections/RemoteSection";
import { ServerSection } from "./sections/ServerSection";
import { ShortcutsSection } from "./sections/ShortcutsSection";
import { TranslationSection } from "./sections/TranslationSection";
import { TraySection } from "./sections/TraySection";
import { TwitchSection } from "./sections/TwitchSection";
import { UpdatesSection } from "./sections/UpdatesSection";
import { VoiceKeysSection } from "./sections/VoiceKeysSection";

type ModalType =
  | "newProfile"
  | "cloneProfile"
  | "renameProfile"
  | "deleteProfile"
  | "confirmDebug";

export function Settings() {
  const t = useT();
  const [store, updateStore, setStore] = useImmerState(defaultStoreData);
  const [modal, setModal] = useState<ModalType | null>(null);
  const [connected, setConnected] = useState(false);
  // The shortcuts another app holds, from main's last answer
  const [taken, setTaken] = useState<ControlAction[]>([]);
  // The active profile's platforms: a platform's sections show only with it
  const platforms = useProfilePlatforms();

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
    if (!res?.success) return;
    setStore(res.data!);
    // Only the page's own request brings them, as taken at startup
    if (res.taken) setTaken(res.taken);
  });

  useIpcListener(APP_EVENTS_RESPONSE.TWITCH_ACCOUNT, (res) => {
    if (!res?.success) return;
    updateStore((s) => {
      s.settings.accounts.twitch.login = res.login;
    });
  });

  useIpcListener(APP_EVENTS_RESPONSE.SET_SHORTCUTS, (res) => {
    if (res) setTaken(res.taken ?? []);
  });

  const setShortcut = (action: ControlAction, accelerator: string) => {
    const old = store.settings.shortcuts;
    // One shortcut fires one action, so it leaves the row it was on
    const shortcuts = { ...old };
    for (const a of CONTROL_ACTIONS) {
      if (accelerator && shortcuts[a] === accelerator) shortcuts[a] = "";
    }
    shortcuts[action] = accelerator;
    updateStore((s) => {
      s.settings.shortcuts = shortcuts;
    });
    setTaken((list) =>
      list.filter((a) => a !== action && shortcuts[a] === old[a]),
    );
    window.api.emit(APP_EVENTS.SET_SHORTCUTS, { shortcuts });
  };

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

      {modal === "renameProfile" && (
        <RenameProfileModal
          profile={store.settings.activeProfile}
          onClose={closeModal}
        />
      )}

      {modal === "deleteProfile" && (
        <DeleteProfileModal
          profiles={store.profiles.filter(
            (p) => p.file !== store.settings.activeProfile.file,
          )}
          onClose={closeModal}
        />
      )}

      <Page width="wide" layout="aside">
        {/* First: connecting needs its key */}
        {platforms.includes("tiktok") && (
          <ProvidersSection settings={store.settings} />
        )}

        {/* A signed-in account stays signed in for profiles with Twitch */}
        {platforms.includes("twitch") && (
          <TwitchSection login={store.settings.accounts.twitch.login} />
        )}

        <ProfileSection
          profiles={store.profiles}
          active={store.settings.activeProfile}
          locked={connected}
          onNew={() => setModal("newProfile")}
          onClone={() => setModal("cloneProfile")}
          onRename={() => setModal("renameProfile")}
          onDelete={() => setModal("deleteProfile")}
        />

        <VoiceKeysSection />

        <ServerSection
          enabled={store.settings.server.enabled}
          onChange={server.toggle}
        />

        <RemoteSection
          remote={store.settings.remote}
          serverEnabled={store.settings.server.enabled}
          onChange={(enabled) => {
            updateStore((s) => {
              s.settings.remote.enabled = enabled;
            });
            window.api.emit(APP_EVENTS.SET_REMOTE, { enabled });
          }}
        />

        {/* MCP shares remote control's switch and key */}
        <AssistantsSection
          remote={store.settings.remote}
          serverEnabled={store.settings.server.enabled}
        />

        <ShortcutsSection
          shortcuts={store.settings.shortcuts}
          taken={taken}
          onChange={setShortcut}
        />

        {/* Only TikTok says a message's language */}
        {platforms.includes("tiktok") && (
          <TranslationSection
            language={store.settings.translation.language}
            onChange={(language) => {
              updateStore((s) => {
                s.settings.translation.language = language;
              });
              window.api.emit(APP_EVENTS.SET_TRANSLATION, { language });
            }}
          />
        )}

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
          overlays={store.settings.overlayUpdates.auto}
          onOverlaysChange={(enabled) => {
            updateStore((s) => {
              s.settings.overlayUpdates.auto = enabled;
            });
            window.api.emit(APP_EVENTS.SET_OVERLAY_UPDATES, { enabled });
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
