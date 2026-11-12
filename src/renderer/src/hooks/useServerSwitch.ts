import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { useState } from "react";
import { useIpcListener } from "./useIpcListener";

/**
 * The overlay server's switch, for Settings and Home. Off stops it at once.
 * On asks first (`asking`, answered by `confirm` or `cancel`), then main sets
 * up tokio-app.local, which can show an administrator prompt, and only then
 * starts the server. `onEnabled` shows the switch's state right away, and
 * turns it back off when the hostname fails.
 */
export function useServerSwitch(onEnabled: (enabled: boolean) => void) {
  const [asking, setAsking] = useState(false);

  useIpcListener(APP_EVENTS_RESPONSE.REQ_FQDN, (res) => {
    onEnabled(res?.success ?? false);
    if (res?.success) window.api.emit(APP_EVENTS.SET_SERVER, { enabled: true });
  });

  return {
    asking,
    toggle: (enabled: boolean) => {
      if (enabled) {
        setAsking(true);
        return;
      }
      onEnabled(false);
      window.api.emit(APP_EVENTS.SET_SERVER, { enabled: false });
    },
    confirm: () => {
      setAsking(false);
      onEnabled(true);
      window.api.emit(APP_EVENTS.REQ_FQDN);
    },
    cancel: () => setAsking(false),
  };
}
