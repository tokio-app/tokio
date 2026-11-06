import { StudioOverlay } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { getStudioOverlayURL, studioElements } from "@/common/util";
import {
  BackButton,
  Btn,
  CopyButton,
  DeleteStudioOverlayModal,
  EmptyState,
  Page,
  Section,
  Spinner,
} from "@/components";
import { useIpcListener, useIpcRequest } from "@/hooks";
import toolsStyles from "@/pages/Tools/tools.module.css";
import { useT } from "@/ui/i18n";
import { Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { FiPlus, FiTrash2 } from "react-icons/fi";
import { newOverlayName, sizeText } from "./helper";
import styles from "./studio.module.css";

/**
 * Overlay Studio's overlays, one row each. New overlay makes one and opens
 * its editor once main holds it.
 */
export function Studio() {
  const t = useT();
  const navigate = useNavigate();
  const [overlays, setOverlays] = useState<StudioOverlay[]>();
  const [serverEnabled, setServerEnabled] = useState(true);
  // The overlay just asked for, opened once a reply lists it
  const [adding, setAdding] = useState<string | null>(null);
  // Waiting for the user to confirm it's deleted
  const [removing, setRemoving] = useState<Pick<
    StudioOverlay,
    "id" | "name"
  > | null>(null);

  useIpcRequest(APP_EVENTS.GET_STUDIO);
  useIpcRequest(APP_EVENTS.GET_SETTINGS);

  // Failures still carry what main holds
  useIpcListener(APP_EVENTS_RESPONSE.STUDIO, (res) => {
    if (!res?.data) return;
    setOverlays(res.data);
    if (adding && res.data.some((overlay) => overlay.id === adding)) {
      setAdding(null);
      void navigate({ to: "/tools/studio/$id", params: { id: adding } });
    }
  });

  useIpcListener(APP_EVENTS_RESPONSE.GET_SETTINGS, (res) => {
    if (res?.success) setServerEnabled(res.data!.settings.server.enabled);
  });

  const add = () => {
    const id = crypto.randomUUID();
    setAdding(id);
    window.api.emit(APP_EVENTS.ADD_STUDIO_OVERLAY, {
      id,
      name: newOverlayName(overlays ?? [], (number) =>
        t("studio.newName", { number }),
      ),
    });
  };

  let content;
  if (!overlays) {
    content = (
      <div className={toolsStyles.loading}>
        <Spinner size={20} />
      </div>
    );
  } else if (overlays.length === 0) {
    content = <EmptyState>{t("studio.empty")}</EmptyState>;
  } else {
    content = (
      <ul className={styles.list} aria-label={t("studio.list")}>
        {overlays.map((overlay) => {
          const name = overlay.name.trim() || t("studio.untitled");
          return (
            <li key={overlay.id} className={styles.row}>
              <Link
                to="/tools/studio/$id"
                params={{ id: overlay.id }}
                className={styles.overlay_name}
              >
                {name}
              </Link>
              <span className={styles.size}>{sizeText(overlay.size)}</span>
              <span className={styles.element_count}>
                {t("studio.elements", {
                  count: studioElements(overlay).length,
                })}
              </span>
              <span className={styles.actions}>
                <CopyButton
                  value={getStudioOverlayURL(overlay.id)}
                  title={t("studio.copyUrl")}
                />
                <Btn
                  variant="icon"
                  title={t("studio.delete")}
                  aria-label={t("studio.delete")}
                  onClick={() => setRemoving({ id: overlay.id, name })}
                >
                  <FiTrash2 size={18} />
                </Btn>
              </span>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <Page>
      {!serverEnabled && (
        <p className={toolsStyles.notice}>{t("studio.serverOff")}</p>
      )}

      <Section
        icon={<BackButton to="/tools" title={t("tools.back")} />}
        title={t("studio.title")}
        description={t("studio.description")}
        actions={
          <Btn
            variant="icon"
            title={t("studio.add")}
            aria-label={t("studio.add")}
            disabled={!overlays}
            onClick={add}
          >
            <FiPlus size={20} />
          </Btn>
        }
      >
        {content}
      </Section>

      {removing && (
        <DeleteStudioOverlayModal
          item={removing}
          onClose={() => setRemoving(null)}
        />
      )}
    </Page>
  );
}
