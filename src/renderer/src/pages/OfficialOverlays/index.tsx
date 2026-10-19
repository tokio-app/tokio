import { APP_EVENTS, APP_EVENTS_RESPONSE, OverlayApp } from "@/common/types";
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

  useIpcRequest(APP_EVENTS.GET_OVERLAYS);

  // Also sent after installing or removing one
  useIpcListener(APP_EVENTS_RESPONSE.GET_OVERLAYS, (res) => {
    if (res?.success) setOverlays(res.data!);
  });

  return (
    <Page width="wide">
      <CatalogSection overlays={overlays} />
    </Page>
  );
}
