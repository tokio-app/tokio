import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { defaultProfile } from "@/common/util";
import {
  Check,
  Page,
  PermissionsSection,
  ProtectionSection,
} from "@/components";
import {
  scopeUpdater,
  useEditableSettings,
  useIpcListener,
  useIpcRequest,
} from "@/hooks";
import { PlatformsContext } from "@/context/platforms";
import { useT } from "@/ui/i18n";
import { useState } from "react";
import { ControlsSection } from "./sections/ControlsSection";
import { ProviderSection } from "./sections/ProviderSection";

export function Music() {
  const t = useT();
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);

  // The permissions' tabs, one per platform
  const [platforms, setPlatforms] = useState(defaultProfile.platforms);
  const { settings, update } = useEditableSettings("music", (profile) =>
    setPlatforms(profile.platforms),
  );

  useIpcRequest(APP_EVENTS.IS_MUSIC_CONNECTED);

  useIpcListener(APP_EVENTS_RESPONSE.MUSIC_CONNECTED, (res) => {
    setConnected(res?.success ?? false);
    setLoading(false);
  });

  return (
    <PlatformsContext value={platforms}>
      <Page width="wide" layout="aside">
        <ProviderSection
          provider={settings.provider}
          update={scopeUpdater(update, "provider")}
          connected={connected}
          loading={loading}
          onConnect={() => {
            setLoading(true);
            if (connected) {
              window.api.emit(APP_EVENTS.DISCONNECT_MUSIC);
            } else {
              window.api.emit(APP_EVENTS.CONNECT_MUSIC, {
                ...settings.provider,
              });
            }
          }}
        />

        <ControlsSection
          controls={settings.controls}
          update={scopeUpdater(update, "controls")}
        />

        <PermissionsSection
          feature={t("music.feature")}
          permissions={settings.permissions}
          update={scopeUpdater(update, "permissions")}
        />

        <ProtectionSection
          feature={t("music.feature")}
          protection={settings.protection}
          update={scopeUpdater(update, "protection")}
        >
          <Check
            label={t("music.protection.onePerViewer")}
            title={t("music.protection.onePerViewerHint")}
            checked={settings.protection.one_per_viewer}
            onChange={(e) =>
              update((s) => {
                s.protection.one_per_viewer = e.target.checked;
              })
            }
          />
          <Check
            label={t("music.protection.limitControls")}
            title={t("music.protection.limitControlsHint")}
            checked={settings.protection.limit_controls}
            onChange={(e) =>
              update((s) => {
                s.protection.limit_controls = e.target.checked;
              })
            }
          />
        </ProtectionSection>
      </Page>
    </PlatformsContext>
  );
}
