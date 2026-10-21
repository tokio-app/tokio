import { APP_EVENTS, APP_EVENTS_RESPONSE, OverlayApp } from "@/common/types";
import { Btn, EmptyState, Modal, Section } from "@/components";
import { useIpcListener, useIpcRequest } from "@/hooks";
import { useState } from "react";
import { FiTrash2 } from "react-icons/fi";
import { LuPackagePlus } from "react-icons/lu";
import { VscPackage } from "react-icons/vsc";
import styles from "../settings.module.css";

export function OverlaysSection() {
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
        <Modal
          title="Remove overlay?"
          description={`${removing.name} and its settings will be deleted. Streaming apps using its URL will stop showing it.`}
          confirmText="Remove"
          onClose={() => setRemoving(null)}
          onConfirm={() => {
            window.api.emit(APP_EVENTS.REMOVE_OVERLAY, { id: removing.id });
            setRemoving(null);
          }}
        />
      )}

      <Section
        icon={<VscPackage />}
        title="Imported Overlays"
        description="Removing one deletes its settings too."
        actions={
          <Btn
            variant="icon"
            title="Import"
            onClick={() => window.api.emit(APP_EVENTS.IMPORT_OVERLAY)}
          >
            <LuPackagePlus size={20} />
          </Btn>
        }
      >
        {imported.length === 0 ? (
          <EmptyState>No overlays imported yet.</EmptyState>
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
                  title="Remove"
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
