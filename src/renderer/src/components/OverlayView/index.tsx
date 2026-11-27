import { listOf } from "@/common/i18n";
import { OverlayApp } from "@/common/types";
import { getOverlayURL, PLATFORM_LABELS } from "@/common/util";
import { usePlatforms } from "@/context/platforms";
import { useLanguage, useT } from "@/ui/i18n";
import { useState } from "react";
import { FiMaximize2, FiTrash2 } from "react-icons/fi";
import { GoUnverified, GoVerified } from "react-icons/go";
import { PiShootingStarThin } from "react-icons/pi";
import { VscPackage, VscSettings } from "react-icons/vsc";
import { CopyField } from "../CopyField";
import { Btn } from "../Elements";
import { Iframe } from "../Iframe";
import { Modal } from "../Modal";
import { OverlayPreview, PREVIEW } from "../OverlayPreview";
import styles from "./overlayview.module.css";

interface Props {
  onTest: (id: string) => void;
  onCustomize: (id: string) => void;
  // Shows a Remove button, official overlays included
  onRemove?: (overlay: OverlayApp) => void;
  overlay: OverlayApp;
}

export function OverlayView({ onTest, onCustomize, onRemove, overlay }: Props) {
  const t = useT();
  const language = useLanguage();
  const profilePlatforms = usePlatforms();
  const [expanded, setExpanded] = useState(false);
  // Where it works, said only when it's none of the profile's platforms
  const { platforms } = overlay;
  const elsewhere =
    Array.isArray(platforms) &&
    platforms.length > 0 &&
    !platforms.some((p) => profilePlatforms.includes(p));

  return (
    <div className={styles.container}>
      {expanded && (
        <Modal
          title={overlay.name}
          closeButton
          maxWidth="fit-content"
          onClose={() => setExpanded(false)}
          footer={
            <Btn onClick={() => onTest(overlay.id)}>
              <PiShootingStarThin size={18} />
              {t("common.test")}
            </Btn>
          }
        >
          <div className={styles.frame} style={PREVIEW}>
            <Iframe name={overlay.id} source={overlay.path} />
          </div>
        </Modal>
      )}

      <div className={styles.header}>
        <div className={styles.info}>
          <h3 className={styles.title} title={overlay.name}>
            {overlay.name}
          </h3>
          <div className={styles.tags}>
            <span className={styles.tag}>
              <VscPackage size={14} />
              {overlay.version}
            </span>
            {overlay.external ? (
              <span className={styles.tag}>
                <GoUnverified size={14} />
                {t("components.overlayView.external")}
              </span>
            ) : (
              <span className={styles.tag}>
                <GoVerified size={14} color="var(--success)" />
                {t("components.overlayView.verified")}
              </span>
            )}
          </div>
        </div>

        <div className={styles.buttons}>
          <Btn onClick={() => onTest(overlay.id)}>
            <PiShootingStarThin size={18} />
            {t("common.test")}
          </Btn>
          {overlay.config && (
            <Btn onClick={() => onCustomize(overlay.id)}>
              <VscSettings size={18} />
              {t("components.overlayView.customize")}
            </Btn>
          )}
          {onRemove && (
            <Btn
              variant="icon"
              title={t("common.remove")}
              onClick={() => onRemove(overlay)}
            >
              <FiTrash2 size={20} />
            </Btn>
          )}
        </div>
      </div>

      {/* Zoomed out so the whole layout fits, the modal shows it full size */}
      <OverlayPreview overlay={overlay}>
        <Btn
          variant="icon"
          title={t("common.fullSize")}
          className={styles.expand}
          onClick={() => setExpanded(true)}
        >
          <FiMaximize2 size={16} />
        </Btn>
      </OverlayPreview>

      <CopyField
        value={getOverlayURL(overlay.id)}
        title={t("common.copyUrl")}
      />

      {elsewhere && (
        <p className={styles.platforms}>
          {t("components.overlayView.worksOn", {
            platforms: listOf(
              language,
              platforms.map((p) => PLATFORM_LABELS[p]),
            ),
          })}
        </p>
      )}
    </div>
  );
}
