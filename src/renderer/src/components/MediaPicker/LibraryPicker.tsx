import { MessageKey } from "@/common/i18n";
import { MediaFile } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { cx } from "@/helper/cx";
import { useIpcListener } from "@/hooks/useIpcListener";
import { useIpcRequest } from "@/hooks/useIpcRequest";
import { useT } from "@/ui/i18n";
import { ComponentType, ReactNode, useRef, useState } from "react";
import { FiCheck, FiTrash2 } from "react-icons/fi";
import { Btn, SearchToggle } from "../Elements";
import { Modal } from "../Modal";
import list from "../SoundPicker/soundpicker.module.css";
import styles from "./mediapicker.module.css";

type Props = {
  // The alert's or the game action's, which browsed files go on
  id: string;
  chosen: Pick<MediaFile, "file"> | null;
  events: {
    get: APP_EVENTS.GET_MEDIA | APP_EVENTS.GET_MINECRAFT_PICTURES;
    // Also the reply to a browse or a deletion
    library:
      APP_EVENTS_RESPONSE.GET_MEDIA | APP_EVENTS_RESPONSE.MINECRAFT_PICTURES;
    browse: APP_EVENTS.IMPORT_MEDIA | APP_EVENTS.IMPORT_MINECRAFT_PICTURE;
    browsed:
      | APP_EVENTS_RESPONSE.SET_ALERT_MEDIA
      | APP_EVENTS_RESPONSE.SET_MINECRAFT_PICTURE;
  };
  texts: Record<
    | "title"
    | "description"
    | "search"
    | "empty"
    | "noMatch"
    | "failed"
    | "browse",
    MessageKey
  >;
  // Stays open after a pick, with Done instead of Cancel
  stays?: boolean;
  // The thumbnail and the label inside a file's button
  tile: (item: MediaFile) => ReactNode;
  // Asks to confirm a file's deletion
  Delete: ComponentType<{ item: MediaFile; onClose: () => void }>;
  // Asks main to browse for files, which replies on events.browsed with the
  // request number this returns
  onRequest: () => number;
  // Picks a file from the library, or takes the chosen one off
  onSelect: (item: MediaFile | null) => void;
  onClose: () => void;
};

/** Picks a file from a library of images or videos, or browses for more. */
export function LibraryPicker({
  id,
  chosen,
  events,
  texts,
  stays,
  tile,
  Delete,
  onRequest,
  onSelect,
  onClose,
}: Props) {
  const t = useT();
  const [library, setLibrary] = useState<MediaFile[]>([]);
  const [search, setSearch] = useState("");
  const [failed, setFailed] = useState(false);
  // The newest request sent, the only one whose failure is shown
  const latest = useRef(0);
  // File waiting for the user to confirm it's deleted
  const [removing, setRemoving] = useState<MediaFile | null>(null);

  useIpcRequest(events.get);

  useIpcListener(events.library, (res) => {
    if (!res) return;
    setLibrary(res.data);
    setFailed(!res.success);
  });

  useIpcListener(events.browsed, (res) => {
    if (res?.id === id && res.request === latest.current) {
      setFailed(!res.success);
    }
  });

  const needle = search.trim().toLowerCase();
  const items = library.filter((f) => f.name.toLowerCase().includes(needle));

  const browse = (
    <Btn
      variant={stays ? "default" : "accent"}
      onClick={() => {
        latest.current = onRequest();
        window.api.emit(events.browse, { id, request: latest.current });
      }}
    >
      {t(texts.browse)}
    </Btn>
  );

  return (
    <>
      <Modal
        title={t(texts.title)}
        description={t(texts.description)}
        maxWidth="840px"
        onClose={onClose}
        actions={
          <SearchToggle
            placeholder={t(texts.search)}
            value={search}
            onChange={setSearch}
          />
        }
        footer={
          <>
            <Btn disabled={!chosen} onClick={() => onSelect(null)}>
              {t("common.clear")}
            </Btn>
            {stays ? (
              <>
                {browse}
                <Btn variant="accent" onClick={onClose}>
                  {t("common.done")}
                </Btn>
              </>
            ) : (
              <>
                <Btn onClick={onClose}>{t("common.cancel")}</Btn>
                {browse}
              </>
            )}
          </>
        }
      >
        <div className={styles.grid}>
          {items.map((item) => {
            const current = item.file === chosen?.file;
            return (
              <div key={item.file} className={styles.tile}>
                <button
                  type="button"
                  className={cx(styles.choice, current && styles.chosen)}
                  aria-current={current || undefined}
                  title={item.name}
                  onClick={() => onSelect(item)}
                >
                  {tile(item)}
                  {current && (
                    <FiCheck size={14} className={styles.check} aria-hidden />
                  )}
                </button>
                <Btn
                  variant="icon"
                  title={t("common.delete")}
                  className={styles.delete}
                  onClick={() => setRemoving(item)}
                >
                  <FiTrash2 size={16} />
                </Btn>
              </div>
            );
          })}

          {items.length === 0 && (
            <p className={cx(list.status, styles.empty)}>
              {library.length === 0 ? t(texts.empty) : t(texts.noMatch)}
            </p>
          )}
        </div>

        {failed && <p className={list.error}>{t(texts.failed)}</p>}
      </Modal>

      {removing && <Delete item={removing} onClose={() => setRemoving(null)} />}
    </>
  );
}
