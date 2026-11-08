import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { useState } from "react";
import { useIpcListener } from "./useIpcListener";
import { useIpcRequest } from "./useIpcRequest";

/**
 * Whether the overlay server is on, for a page's server-off notice. True
 * until the settings say, so the notice doesn't flash.
 */
export function useServerEnabled(): boolean {
  const [enabled, setEnabled] = useState(true);

  useIpcRequest(APP_EVENTS.GET_SETTINGS);

  useIpcListener(APP_EVENTS_RESPONSE.GET_SETTINGS, (res) => {
    if (res?.success) setEnabled(res.data!.settings.server.enabled);
  });

  return enabled;
}
