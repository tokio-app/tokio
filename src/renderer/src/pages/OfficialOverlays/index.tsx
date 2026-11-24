import { APP_EVENTS, APP_EVENTS_RESPONSE, OverlayApp } from "@/common/types";
import { defaultProfile } from "@/common/util";
import { Page } from "@/components";
import { useIpcListener, useIpcRequest } from "@/hooks";
import { useState } from "react";
import { CatalogSection } from "./sections/CatalogSection";

/**
 * The official overlays, opened from the gallery. Its route is under
 * /overlays, so the sidebar keeps Overlays active.
 */
export function OfficialOverlays() {
  const [overlays, setOverlays] = useState<OverlayApp[]>([]);
  // The catalog shows the overlays that work on them
  const [platforms, setPlatforms] = useState(defaultProfile.platforms);

  useIpcRequest(APP_EVENTS.GET_OVERLAYS);
  useIpcRequest(APP_EVENTS.GET_PROFILE);
  useIpcListener(APP_EVENTS_RESPONSE.GET_PROFILE, (res) => {
    if (res?.success && res.profile) setPlatforms(res.profile.platforms);
  });

  // Also sent after installing or removing one
  useIpcListener(APP_EVENTS_RESPONSE.GET_OVERLAYS, (res) => {
    if (res?.success) setOverlays(res.data!);
  });

  return (
    <Page width="wide">
      <CatalogSection overlays={overlays} platforms={platforms} />
    </Page>
  );
}
