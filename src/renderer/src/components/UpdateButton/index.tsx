import { APP_EVENTS, UpdateStatus } from "@/common/types";
import { cx } from "@/helper/cx";
import { flushSettings } from "@/hooks";
import { useT } from "@/ui/i18n";
import { useState } from "react";
import { createPortal } from "react-dom";
import { FiArrowDown, FiDownload, FiRefreshCw } from "react-icons/fi";
import { Btn } from "../Elements";
import { Modal } from "../Modal";
import styles from "./updatebutton.module.css";

type Props = {
  status: UpdateStatus;
  // Restarting ends the LIVE connection, so it asks first
  connected: boolean;
  // Smaller, and a ring fills in its place while the update downloads
  titleBar?: boolean;
};

/**
 * The button shown once an update is downloaded, or on macOS once one can be
 * downloaded from the release page. Rose only while no LIVE is connected.
 */
export function UpdateButton({ status, connected, titleBar }: Props) {
  const t = useT();
  const [confirm, setConfirm] = useState(false);

  if (titleBar && status.state === "downloading") {
    const label = t("components.update.downloading", {
      version: status.version,
    });
    return (
      <span
        className={cx(styles.container, styles.ring)}
        role="progressbar"
        aria-label={label}
        aria-valuenow={status.percent}
        title={label}
      >
        <svg className={styles.dial} viewBox="0 0 20 20" aria-hidden="true">
          <circle className={styles.track} cx="10" cy="10" r="9" />
          <circle
            className={styles.arc}
            cx="10"
            cy="10"
            r="9"
            pathLength={100}
            strokeDasharray="100"
            style={{ strokeDashoffset: 100 - status.percent }}
          />
        </svg>
        <FiArrowDown size={11} />
      </span>
    );
  }

  const ready = status.state === "ready";
  const manual = status.state === "available" && status.manual;
  if (!ready && !manual) return null;

  const install = () => {
    // The installer quits Tokio before the window's pagehide would send them
    flushSettings();
    window.api.emit(APP_EVENTS.INSTALL_UPDATE);
  };

  return (
    <div className={cx(titleBar && styles.container)}>
      {confirm &&
        createPortal(
          <Modal
            title={t("components.update.confirmTitle")}
            description={t("components.update.confirmDescription")}
            confirmText={t("components.update.restart")}
            onClose={() => setConfirm(false)}
            onConfirm={() => {
              setConfirm(false);
              install();
            }}
          />,
          document.body,
        )}

      <Btn
        // Rose says "do this", and a LIVE is no time to restart
        variant={connected ? "default" : "accent"}
        title={`Tokio ${status.version}`}
        className={cx(titleBar && styles.button)}
        onClick={() => (ready && connected ? setConfirm(true) : install())}
      >
        {ready ? <FiRefreshCw size={14} /> : <FiDownload size={14} />}
        {ready
          ? t("components.update.restartToUpdate")
          : t("components.update.download")}
      </Btn>
    </div>
  );
}
