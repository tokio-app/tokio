import { APP_EVENTS, APP_EVENTS_RESPONSE, LicenseText } from "@/common/types";
import { Modal, Spinner } from "@/components";
import { useIpcListener } from "@/hooks";
import { marked } from "marked";
import { MouseEvent, useEffect, useMemo, useState } from "react";
import styles from "../about.module.css";
import { resolveNoticeLink } from "../helper";

type Props = {
  id: string;
  onClose: () => void;
  // Opens another document, from a link in the notices
  onView: (id: string) => void;
};

export function LicenseModal({ id, onClose, onView }: Props) {
  const [license, setLicense] = useState<LicenseText | null>(null);

  useEffect(() => {
    setLicense(null);
    window.api.emit(APP_EVENTS.GET_LICENSE_TEXT, { id });
  }, [id]);

  useIpcListener(APP_EVENTS_RESPONSE.GET_LICENSE_TEXT, (res) => {
    // Replies for a document that's no longer shown are ignored
    if (!res || res.id !== id) return;
    // Main already notified the failure
    if (!res.success) onClose();
    else setLicense(res.data ?? null);
  });

  // Only the notices shipped with the app are rendered, never package files
  const html = useMemo(
    () =>
      license?.markdown ? marked.parse(license.text, { async: false }) : null,
    [license],
  );

  // Links would navigate the app window away
  const onLinkClick = (e: MouseEvent<HTMLDivElement>) => {
    const link = e.target instanceof Element ? e.target.closest("a") : null;
    if (!link) return;
    e.preventDefault();

    const target = resolveNoticeLink(link.getAttribute("href") ?? "");
    if (!target) return;
    if ("doc" in target) onView(target.doc);
    else window.open(target.url);
  };

  return (
    <Modal
      title={license?.title ?? "License"}
      onClose={onClose}
      closeButton
      maxWidth="800px"
    >
      {!license ? (
        <div className={styles.loading}>
          <Spinner size={24} />
        </div>
      ) : html !== null ? (
        <div
          className={styles.markdown}
          onClick={onLinkClick}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className={styles.license_text}>{license.text}</pre>
      )}
    </Modal>
  );
}
