import { OverlayConfig } from "@/common/schemas";
import {
  APP_EVENTS,
  APP_EVENTS_RESPONSE,
  CustomGift,
  OverlayApp,
} from "@/common/types";
import { OverlayModal, Page } from "@/components";
import { useIpcListener, useIpcRequest } from "@/hooks";
import { useState } from "react";
import { postToOverlay, postToPreviews } from "./helper";
import { GallerySection } from "./sections/GallerySection";

export function Overlays() {
  const [overlays, setOverlays] = useState<OverlayApp[]>([]);
  const [gifts, setGifts] = useState<CustomGift[]>([]);
  // Overlay being customized, and its config once loaded
  const [configId, setConfigId] = useState<string | null>(null);
  const [config, setConfig] = useState<OverlayConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const editing = overlays.find((overlay) => overlay.id === configId);

  const closeModal = () => {
    setConfigId(null);
    setConfig(null);
    setSaving(false);
  };

  useIpcRequest(APP_EVENTS.GET_OVERLAYS);
  useIpcRequest(APP_EVENTS.GET_GIFTS);

  useIpcListener(APP_EVENTS_RESPONSE.GET_OVERLAYS, (res) => {
    if (res?.success) setOverlays(res.data!);
  });

  useIpcListener(APP_EVENTS_RESPONSE.GET_OVERLAY_CONFIG, (res) => {
    // A late reply for an overlay that's no longer being customized
    if (!res || res.id !== configId) return;
    if (res.success) setConfig(res.data!);
    // Main has already reported the failure.
    else closeModal();
  });

  useIpcListener(APP_EVENTS_RESPONSE.GET_GIFTS, (res) => {
    if (res) setGifts(res.data);
  });

  useIpcListener(APP_EVENTS_RESPONSE.SAVE_OVERLAY_CONFIG, (res) => {
    if (!res) return;
    if (res.success) {
      postToOverlay(res.id, { type: "tokio:config", data: res.data! });
    }
    // A late reply still updates its overlay, but not the settings open now.
    if (res.id !== configId) return;
    setSaving(false);
    if (res.success) closeModal();
  });

  // Tests from the settings stay in the previews, which show the unsaved
  // settings, so they never reach the stream.
  useIpcListener(APP_EVENTS_RESPONSE.TEST_OVERLAY, (res) => {
    if (!res) return;
    const post = configId === null ? postToOverlay : postToPreviews;
    for (const payload of res.payloads) post(res.id, payload);
  });

  return (
    <>
      {editing && (
        <OverlayModal
          overlay={editing}
          gifts={gifts}
          config={config}
          saving={saving}
          onRequestClose={closeModal}
          onTest={() =>
            window.api.emit(APP_EVENTS.TEST_OVERLAY, { id: editing.id })
          }
          onSave={(saved) => {
            setSaving(true);
            window.api.emit(APP_EVENTS.SAVE_OVERLAY_CONFIG, {
              config: saved,
              id: editing.id,
            });
          }}
        />
      )}

      <Page width="wide">
        <GallerySection
          overlays={overlays}
          onTest={(id) => window.api.emit(APP_EVENTS.TEST_OVERLAY, { id })}
          onCustomize={(id) => {
            window.api.emit(APP_EVENTS.GET_OVERLAY_CONFIG, { id });
            setConfigId(id);
          }}
        />
      </Page>
    </>
  );
}
