import { APP_EVENTS, APP_EVENTS_RESPONSE, OverlayApp } from "@/common/types";
import { Btn, EmptyState, RemoveOverlayModal, Section } from "@/components";
import { useIpcListener, useIpcRequest } from "@/hooks";
import { useT } from "@/ui/i18n";
import { useState } from "react";
import { FiTrash2, FiUpload } from "react-icons/fi";
import { VscPackage } from "react-icons/vsc";
import styles from "../settings.module.css";

export function OverlaysSection() {
  const t = useT();
  const [overlays, setOverlays] = useState<OverlayApp[]>([]);
  // Overlay waiting for the user to confirm its removal
  const [removing, setRemoving] = useState<OverlayApp | null>(null);

  useIpcRequest(APP_EVENTS.GET_OVERLAYS);

  // Failed imports and removals also send the current list
  useIpcListener(APP_EVENTS_RESPONSE.GET_OVERLAYS, (res) => {
    if (res?.data) setOverlays(res.data);
  });

  // Official overlays are managed on their own
  const imported = overlays.filter((o) => o.external);

  return (
    <>
      {removing && (
        <RemoveOverlayModal item={removing} onClose={() => setRemoving(null)} />
      )}

      <Section
        icon={<VscPackage />}
        title={t("settings.overlays.title")}
        description={t("settings.overlays.description")}
        actions={
          <Btn
            variant="icon"
            title={t("common.import")}
            onClick={() => window.api.emit(APP_EVENTS.IMPORT_OVERLAY)}
          >
            <FiUpload size={20} />
          </Btn>
        }
      >
        {imported.length === 0 ? (
          <EmptyState>{t("settings.overlays.empty")}</EmptyState>
        ) : (
          <div className={styles.library}>
            {imported.map((overlay) => (
              <div key={overlay.id} className={styles.library_item}>
                <span className={styles.library_name} title={overlay.name}>
                  {overlay.name}
                </span>
                <span className={styles.library_meta}>{overlay.version}</span>
                <Btn
                  variant="icon"
                  title={t("common.remove")}
                  onClick={() => setRemoving(overlay)}
                >
                  <FiTrash2 size={20} />
                </Btn>
              </div>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}
