import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { defaultProfile } from "@/common/util";
import { useState } from "react";
import { useIpcListener } from "./useIpcListener";
import { useIpcRequest } from "./useIpcRequest";

/**
 * The active profile's platforms, from one GET_PROFILE when the page mounts
 * and again on each profile switch. For a page's top level, never a
 * component: the reply drops a page's unsaved autosave.
 */
export function useProfilePlatforms() {
  const [platforms, setPlatforms] = useState(defaultProfile.platforms);

  useIpcRequest(APP_EVENTS.GET_PROFILE);
  useIpcListener(APP_EVENTS_RESPONSE.GET_PROFILE, (res) => {
    if (res?.success && res.profile) setPlatforms(res.profile.platforms);
  });

  return platforms;
}
