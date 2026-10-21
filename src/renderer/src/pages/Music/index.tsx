import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { Page, PermissionsSection, ProtectionSection } from "@/components";
import {
  scopeUpdater,
  useEditableSettings,
  useIpcListener,
  useIpcRequest,
} from "@/hooks";
import { useState } from "react";
import { ControlsSection } from "./sections/ControlsSection";
import { ProviderSection } from "./sections/ProviderSection";

export function Music() {
  const [connected, setConnected] = useState(false);
  const [loading, setLoading] = useState(false);

  const { settings, update } = useEditableSettings("music");

  useIpcRequest(APP_EVENTS.IS_MUSIC_CONNECTED);

  useIpcListener(APP_EVENTS_RESPONSE.MUSIC_CONNECTED, (res) => {
    setConnected(res?.success ?? false);
    setLoading(false);
  });

  return (
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
            window.api.emit(APP_EVENTS.CONNECT_MUSIC, { ...settings.provider });
          }
        }}
      />

      <ControlsSection
        controls={settings.controls}
        update={scopeUpdater(update, "controls")}
      />

      <PermissionsSection
        feature="Music"
        permissions={settings.permissions}
        update={scopeUpdater(update, "permissions")}
      />

      <ProtectionSection
        feature="Music"
        protection={settings.protection}
        update={scopeUpdater(update, "protection")}
      />
    </Page>
  );
}
