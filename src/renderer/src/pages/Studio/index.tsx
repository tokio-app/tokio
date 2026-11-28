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
import { useIpcListener, useIpcRequest, useServerEnabled } from "@/hooks";
import toolsStyles from "@/pages/Tools/tools.module.css";
import { rich, useT } from "@/ui/i18n";
import { Link, useNavigate } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { FiLink, FiPlus, FiTrash2 } from "react-icons/fi";
import { LuCopyPlus } from "react-icons/lu";
import { copyName, newOverlayName, sizeText } from "./helper";
import styles from "./studio.module.css";

/**
 * Overlay Studio's overlays, one row each. New overlay makes one and opens
 * its editor once main holds it.
 */
export function Studio() {
  const t = useT();
  const navigate = useNavigate();
  const [overlays, setOverlays] = useState<StudioOverlay[]>();
  // The overlay just asked for, opened once a reply lists it
  const [adding, setAdding] = useState<string | null>(null);
  // Waiting for the user to confirm it's deleted
  const [removing, setRemoving] = useState<Pick<
    StudioOverlay,
    "id" | "name"
  > | null>(null);
  // The names asked for by id, taken until a reply lists them, so a second
  // click before it doesn't pick the same name. A failed add's stays taken.
  const sent = useRef(new Map<string, string>());

  useIpcRequest(APP_EVENTS.GET_STUDIO);
  const serverEnabled = useServerEnabled();

  // Failures still carry what main holds
  useIpcListener(APP_EVENTS_RESPONSE.STUDIO, (res) => {
    if (!res?.data) return;
    for (const overlay of res.data) sent.current.delete(overlay.id);
    setOverlays(res.data);
    if (adding && res.data.some((overlay) => overlay.id === adding)) {
      setAdding(null);
      void navigate({ to: "/tools/studio/$id", params: { id: adding } });
    }
  });

  const taken = () => [
    ...(overlays ?? []),
    ...Array.from(sent.current.values(), (name) => ({ name })),
  ];

  const send = (id: string, name: string, copy?: string) => {
    sent.current.set(id, name);
    window.api.emit(APP_EVENTS.ADD_STUDIO_OVERLAY, { id, name, copy });
  };

  const add = () => {
    const id = crypto.randomUUID();
    setAdding(id);
    send(
      id,
      newOverlayName(taken(), (number) => t("studio.newName", { number })),
    );
  };

  // Stays on the list, unlike New overlay (the user's call). The rows show
  // only once the list has loaded
  const duplicate = (overlay: StudioOverlay, name: string) =>
    send(
      crypto.randomUUID(),
      copyName(taken(), name, (name, number) =>
        number === 1
          ? t("studio.copyName", { name })
          : t("studio.copyNameNumber", { name, number }),
      ),
      overlay.id,
    );

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
                  // Apart from Duplicate's copy icon
                  icon={<FiLink size={18} />}
                />
                <Btn
                  variant="icon"
                  title={t("studio.duplicate")}
                  aria-label={t("studio.duplicate")}
                  onClick={() => duplicate(overlay, name)}
                >
                  <LuCopyPlus size={18} />
                </Btn>
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
        <p className={toolsStyles.notice}>
          {rich(t("studio.serverOff"), {
            link: (text) => <Link to="/settings">{text}</Link>,
          })}
        </p>
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
