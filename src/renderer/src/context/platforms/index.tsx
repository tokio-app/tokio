import { Platform } from "@/common/types";
import { createContext, useContext } from "react";

// The active profile's platforms for a page's trigger pickers. The page loads
// the profile once and provides them: a GET_PROFILE per picker would drop
// the page's unsaved autosave with its reply.
export const PlatformsContext = createContext<readonly Platform[]>(["tiktok"]);

export const usePlatforms = () => useContext(PlatformsContext);
