import { MediaFile } from "@/common/schemas";
import { getMediaPreviewURL, mediaKind } from "@/common/util";
import {
  Btn,
  DeleteMediaModal,
  EmptyState,
  MediaThumbnail,
  Modal,
  SoundLength,
  useVideoURL,
} from "@/components";
import picker from "@/components/MediaPicker/mediapicker.module.css";
import { cx } from "@/helper";
import { releaseOnUnmount } from "@/helper/media";
import { useT } from "@/ui/i18n";
import { useState } from "react";
import { FiFilm, FiTrash2 } from "react-icons/fi";
import styles from "../library.module.css";

interface Props {
  // The ones the search shows, newest first
  media: MediaFile[];
  // The library has none
  empty: boolean;
  // An upload or a deletion failed
  failed: boolean;
}

export function MediaTab({ media, empty, failed }: Props) {
  const t = useT();
  // File shown full size
  const [showing, setShowing] = useState<MediaFile | null>(null);
  // File waiting for the user to confirm it's deleted
  const [removing, setRemoving] = useState<MediaFile | null>(null);
  // The videos' lengths in seconds, read by their thumbnails
  const [lengths, setLengths] = useState<Record<string, number>>({});
  // Apart from its thumbnail's, which is loaded too
  const fullVideo = useVideoURL(showing?.file ?? "");

  return (
    <>
      {showing && (
        <Modal
          title={showing.name}
          closeButton
          maxWidth="840px"
          onClose={() => setShowing(null)}
        >
          {mediaKind(showing.file) === "video" ? (
            <video
              ref={releaseOnUnmount}
              className={styles.media_full}
              src={fullVideo}
              controls
              autoPlay
            />
          ) : (
            <img
              className={styles.media_full}
              src={getMediaPreviewURL(showing.file)}
              alt={showing.name}
            />
          )}
        </Modal>
      )}

      {removing && (
        <DeleteMediaModal item={removing} onClose={() => setRemoving(null)} />
      )}

      {media.length === 0 ? (
        <EmptyState>
          {empty
            ? t("alerts.library.mediaEmpty")
            : t("alerts.library.mediaNoMatch")}
        </EmptyState>
      ) : (
        <div className={styles.panel}>
          <div className={styles.grid}>
            {media.map((file) => (
              <div key={file.file} className={cx(picker.tile, styles.tile)}>
                <button
                  type="button"
                  className={picker.choice}
                  title={file.name}
                  onClick={() => setShowing(file)}
                >
                  <MediaThumbnail
                    file={file.file}
                    onLength={(seconds) =>
                      setLengths((known) =>
                        Object.is(known[file.file], seconds)
                          ? known
                          : { ...known, [file.file]: seconds },
                      )
                    }
                  />
                  <span className={picker.label}>
                    {mediaKind(file.file) === "video" && (
                      <FiFilm size={14} className={picker.video} aria-hidden />
                    )}
                    <span className={picker.file_name}>{file.name}</span>
                    {/* The button's name reads "Clip 12s", not "Clip12s" */}{" "}
                    <SoundLength seconds={lengths[file.file]} />
                  </span>
                </button>
                <Btn
                  variant="icon"
                  title={t("common.delete")}
                  className={picker.delete}
                  onClick={() => setRemoving(file)}
                >
                  <FiTrash2 size={16} />
                </Btn>
              </div>
            ))}
          </div>
        </div>
      )}

      {failed && (
        <p className={styles.error}>{t("alerts.library.mediaError")}</p>
      )}
    </>
  );
}
