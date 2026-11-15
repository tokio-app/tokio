import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { useState } from "react";
import { useIpcListener } from "./useIpcListener";
import { useIpcRequest } from "./useIpcRequest";

/**
 * The language Settings translates chat into, "" while it's off or until the
 * settings say, so nothing about translation shows early.
 */
export function useTranslationLanguage(): string {
  const [language, setLanguage] = useState("");

  useIpcRequest(APP_EVENTS.GET_SETTINGS);

  useIpcListener(APP_EVENTS_RESPONSE.GET_SETTINGS, (res) => {
    if (res?.success) setLanguage(res.data!.settings.translation.language);
  });

  return language;
}
