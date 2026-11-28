import { useSetting } from "./useSetting";

/**
 * Whether the overlay server is on, for a page's server-off notice. True
 * until the settings say, so the notice doesn't flash.
 */
export const useServerEnabled = () => useSetting((s) => s.server.enabled, true);
