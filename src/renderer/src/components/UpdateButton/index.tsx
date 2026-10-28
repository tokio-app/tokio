import { APP_EVENTS, UpdateStatus } from "@/common/types";
import { useT } from "@/ui/i18n";
import { useState } from "react";
import { createPortal } from "react-dom";
import { FiDownload, FiRefreshCw } from "react-icons/fi";
import { Btn } from "../Elements";
import { Modal } from "../Modal";
import styles from "./updatebutton.module.css";

type Props = {
  status: UpdateStatus;
  // Restarting ends the LIVE connection, so it asks first
  connected: boolean;
};

/**
 * Title bar button shown once an update is downloaded, or on macOS once one
 * can be downloaded from the release page.
 */
export function UpdateButton({ status, connected }: Props) {
  const t = useT();
  const [confirm, setConfirm] = useState(false);

  const ready = status.state === "ready";
  const manual = status.state === "available" && status.manual;
  if (!ready && !manual) return null;

  const install = () => window.api.emit(APP_EVENTS.INSTALL_UPDATE);

  return (
    <div className={styles.container}>
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
        variant="accent"
        title={`Tokio ${status.version}`}
        className={styles.button}
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
