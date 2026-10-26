import { MediaFile } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { getPicturePreviewURL } from "@/common/util";
import { Btn, DeletePictureModal, Modal, SearchToggle } from "@/components";
// The media picker's look, which this picker shares
import styles from "@/components/MediaPicker/mediapicker.module.css";
import list from "@/components/SoundPicker/soundpicker.module.css";
import { cx } from "@/helper/cx";
import { useIpcListener, useIpcRequest } from "@/hooks";
import { useRef, useState } from "react";
import { FiCheck, FiTrash2 } from "react-icons/fi";

type Props = {
  // The game action the picture is for
  id: string;
  picture: MediaFile | null;
  // Asks main to browse for pictures, the first going on the action, which
  // replies SET_MINECRAFT_PICTURE with the request number this returns
  onRequest: () => number;
  // Picks a picture from the library, or takes the action's off it
  onSelect: (picture: MediaFile | null) => void;
  onClose: () => void;
};

/**
 * Picks the picture a game action shows on the games overlay, from the
 * Minecraft library, which all profiles share.
 */
export function PicturePicker({
  id,
  picture,
  onRequest,
  onSelect,
  onClose,
}: Props) {
  const [library, setLibrary] = useState<MediaFile[]>([]);
  const [search, setSearch] = useState("");
  const [failed, setFailed] = useState(false);
  // The newest request sent, the only one whose failure is shown
  const latest = useRef(0);
  // Picture waiting for the user to confirm it's deleted
  const [removing, setRemoving] = useState<MediaFile | null>(null);

  useIpcRequest(APP_EVENTS.GET_MINECRAFT_PICTURES);

  // Also the reply to a browse or a deletion
  useIpcListener(APP_EVENTS_RESPONSE.MINECRAFT_PICTURES, (res) => {
    if (!res) return;
    setLibrary(res.data);
    setFailed(!res.success);
  });

  useIpcListener(APP_EVENTS_RESPONSE.SET_MINECRAFT_PICTURE, (res) => {
    if (res?.id === id && res.request === latest.current) {
      setFailed(!res.success);
    }
  });

  const needle = search.trim().toLowerCase();
  const pictures = library.filter((p) => p.name.toLowerCase().includes(needle));

  return (
    <>
      <Modal
        title="Select picture"
        description="The item or mob this action makes, shown on the overlay."
        maxWidth="840px"
        onClose={onClose}
        actions={
          <SearchToggle
            placeholder="Search your pictures..."
            value={search}
            onChange={setSearch}
          />
        }
        footer={
          <>
            <Btn disabled={!picture} onClick={() => onSelect(null)}>
              Clear
            </Btn>
            <Btn
              onClick={() => {
                latest.current = onRequest();
                window.api.emit(APP_EVENTS.IMPORT_MINECRAFT_PICTURE, {
                  id,
                  request: latest.current,
                });
              }}
            >
              Browse files...
            </Btn>
            <Btn variant="accent" onClick={onClose}>
              Done
            </Btn>
          </>
        }
      >
        <div className={styles.grid}>
          {pictures.map((item) => {
            const current = item.file === picture?.file;
            return (
              <div key={item.file} className={styles.tile}>
                <button
                  type="button"
                  className={cx(styles.choice, current && styles.chosen)}
                  aria-current={current || undefined}
                  title={item.name}
                  onClick={() => onSelect(item)}
                >
                  <img
                    className={styles.thumb}
                    src={getPicturePreviewURL(item.file)}
                    alt=""
                    loading="lazy"
                  />
                  <span className={styles.label}>
                    <span className={styles.file_name}>{item.name}</span>
                  </span>
                  {current && (
                    <FiCheck size={14} className={styles.check} aria-hidden />
                  )}
                </button>
                <Btn
                  variant="icon"
                  title="Delete"
                  className={styles.delete}
                  onClick={() => setRemoving(item)}
                >
                  <FiTrash2 size={16} />
                </Btn>
              </div>
            );
          })}

          {pictures.length === 0 && (
            <p className={cx(list.status, styles.empty)}>
              {library.length === 0
                ? "No pictures yet. Browse for the items and mobs your actions make."
                : "No pictures match."}
            </p>
          )}
        </div>

        {failed && (
          <p className={list.error}>Couldn't save or load the pictures.</p>
        )}
      </Modal>

      {removing && (
        <DeletePictureModal item={removing} onClose={() => setRemoving(null)} />
      )}
    </>
  );
}
