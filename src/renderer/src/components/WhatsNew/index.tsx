import { REPOSITORY_URL } from "@/common/util";
import { useT } from "@/ui/i18n";
import { useRef, useState } from "react";
import { flushSync } from "react-dom";
import { FiExternalLink } from "react-icons/fi";
import { Btn } from "../Elements";
import { Modal } from "../Modal";
import { notesKey, pagesOf } from "./helper";
import styles from "./whatsnew.module.css";

type Props = {
  // The version Tokio ran as before this update, "" when it isn't known
  from: string;
  onClose: () => void;
};

/**
 * The notes of the version Tokio was updated to, a few changes per page, shown
 * once after the update. Nothing when that release has none.
 */
export function WhatsNew({ from, onClose }: Props) {
  const t = useT();
  const [page, setPage] = useState(0);
  const nextRef = useRef<HTMLButtonElement>(null);

  const version = __APP_VERSION__;
  const key = notesKey(from, version);
  if (!key) return null;

  const pages = pagesOf(t(key).split("\n"));
  const last = page === pages.length - 1;

  const back = () => {
    // Back leaves with the first page, and Chromium drops its focus on <body>
    flushSync(() => setPage(page - 1));
    if (page === 1) nextRef.current?.focus();
  };

  return (
    <Modal
      title={t("components.whatsNew.title")}
      description={t("components.whatsNew.version", { version })}
      onClose={onClose}
      closeButton
      maxWidth="560px"
      footer={
        <>
          <a
            className={styles.link}
            href={`${REPOSITORY_URL}/releases/tag/v${version}`}
            target="_blank"
            rel="noreferrer"
          >
            <FiExternalLink /> {t("components.whatsNew.releaseNotes")}
          </a>
          {pages.length > 1 && (
            <span className={styles.count}>
              {t("components.whatsNew.page", {
                page: String(page + 1),
                total: String(pages.length),
              })}
            </span>
          )}
          {page > 0 && (
            <Btn onClick={back}>{t("components.whatsNew.back")}</Btn>
          )}
          <Btn
            ref={nextRef}
            variant="accent"
            onClick={last ? onClose : () => setPage(page + 1)}
          >
            {last ? t("common.done") : t("components.whatsNew.next")}
          </Btn>
        </>
      }
    >
      <div className={styles.pages} aria-live="polite">
        {pages.map((notes, i) => (
          <ul
            key={notes[0]}
            className={styles.notes}
            // Hidden pages keep their place, so the tallest sets the height
            aria-hidden={i !== page || undefined}
            data-hidden={i !== page || undefined}
          >
            {notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        ))}
      </div>
    </Modal>
  );
}
