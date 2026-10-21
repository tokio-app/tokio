import { OverlayApp } from "@/common/types";
import { getOverlayURL } from "@/common/util";
import { useEffect, useState } from "react";
import { FaRegCopy } from "react-icons/fa";
import { FiCheck, FiMaximize2 } from "react-icons/fi";
import { GoUnverified, GoVerified } from "react-icons/go";
import { PiShootingStarThin } from "react-icons/pi";
import { VscPackage, VscSettings } from "react-icons/vsc";
import { Btn } from "../Elements";
import { Iframe } from "../Iframe";
import { Modal } from "../Modal";
import { OverlayPreview, PREVIEW } from "../OverlayPreview";
import styles from "./overlayview.module.css";

interface Props {
  onTest: (id: string) => void;
  onCustomize: (id: string) => void;
  overlay: OverlayApp;
}

export function OverlayView({ onTest, onCustomize, overlay }: Props) {
  const url = getOverlayURL(overlay.id);
  const [expanded, setExpanded] = useState(false);
  // Shows a check on the URL for a moment after copying it
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

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
              Test
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
                External
              </span>
            ) : (
              <span className={styles.tag}>
                <GoVerified size={14} color="var(--success)" />
                Verified
              </span>
            )}
          </div>
        </div>

        <div className={styles.buttons}>
          <Btn onClick={() => onTest(overlay.id)}>
            <PiShootingStarThin size={18} />
            Test
          </Btn>
          {overlay.config && (
            <Btn onClick={() => onCustomize(overlay.id)}>
              <VscSettings size={18} />
              Customize
            </Btn>
          )}
        </div>
      </div>

      {/* Zoomed out so the whole layout fits, the modal shows it full size */}
      <OverlayPreview overlay={overlay}>
        <Btn
          variant="icon"
          title="Full size"
          className={styles.expand}
          onClick={() => setExpanded(true)}
        >
          <FiMaximize2 size={16} />
        </Btn>
      </OverlayPreview>

      <Btn
        title="Copy URL"
        className={styles.url}
        onClick={() => {
          void navigator.clipboard.writeText(url);
          setCopied(true);
        }}
      >
        <span className={styles.url_text}>{url}</span>
        {copied ? (
          <FiCheck size={16} className={styles.copied} />
        ) : (
          <FaRegCopy size={16} />
        )}
      </Btn>
    </div>
  );
}
