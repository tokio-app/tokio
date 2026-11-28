import type { AppSettings } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { useState } from "react";
import { useIpcListener } from "./useIpcListener";
import { useIpcRequest } from "./useIpcRequest";

/** One setting, `initial` until the settings say. */
export function useSetting<T>(read: (settings: AppSettings) => T, initial: T) {
  const [value, setValue] = useState(initial);

  useIpcRequest(APP_EVENTS.GET_SETTINGS);

  useIpcListener(APP_EVENTS_RESPONSE.GET_SETTINGS, (res) => {
    if (res?.success) setValue(read(res.data!.settings));
  });

  return value;
}
