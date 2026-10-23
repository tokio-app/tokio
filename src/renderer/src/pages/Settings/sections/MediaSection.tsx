import { MediaFile } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { getMediaPreviewURL, mediaKind } from "@/common/util";
import { Btn, EmptyState, MediaThumbnail, Modal, Section } from "@/components";
import { useIpcListener, useIpcRequest } from "@/hooks";
import { useState } from "react";
import { FiImage, FiMaximize2, FiTrash2, FiUpload } from "react-icons/fi";
import styles from "../settings.module.css";

export function MediaSection() {
  const [media, setMedia] = useState<MediaFile[]>([]);
  const [error, setError] = useState(false);
  // File shown full size
  const [showing, setShowing] = useState<MediaFile | null>(null);
  // File waiting for the user to confirm it's deleted
  const [removing, setRemoving] = useState<MediaFile | null>(null);

  useIpcRequest(APP_EVENTS.GET_MEDIA);

  // Also the reply to an upload or a deletion
  useIpcListener(APP_EVENTS_RESPONSE.GET_MEDIA, (res) => {
    if (!res) return;
    setMedia(res.data);
    setError(!res.success);
  });

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
              className={styles.media_full}
              src={getMediaPreviewURL(showing.file)}
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
        <Modal
          title="Delete media?"
          description={`"${removing.name}" will be deleted from your computer and from every alert that shows it, in all your profiles.`}
          confirmText="Delete"
          onClose={() => setRemoving(null)}
          onConfirm={() => {
            window.api.emit(APP_EVENTS.REMOVE_MEDIA, { file: removing.file });
            setRemoving(null);
          }}
        />
      )}

      <Section
        icon={<FiImage />}
        title="Media Library"
        description="Images and videos for alerts, shared by every profile."
        actions={
          <Btn
            variant="icon"
            title="Upload"
            onClick={() => window.api.emit(APP_EVENTS.UPLOAD_MEDIA)}
          >
            <FiUpload size={20} />
          </Btn>
        }
      >
        {media.length === 0 ? (
          <EmptyState>No media yet.</EmptyState>
        ) : (
          <div className={styles.library}>
            {media.map((file) => (
              <div key={file.file} className={styles.library_item}>
                <div className={styles.library_thumb}>
                  <MediaThumbnail file={file.file} />
                </div>
                <span className={styles.library_name} title={file.name}>
                  {file.name}
                </span>
                <Btn
                  variant="icon"
                  title="Full size"
                  onClick={() => setShowing(file)}
                >
                  <FiMaximize2 size={20} />
                </Btn>
                <Btn
                  variant="icon"
                  title="Delete"
                  onClick={() => setRemoving(file)}
                >
                  <FiTrash2 size={20} />
                </Btn>
              </div>
            ))}
          </div>
        )}

        {error && (
          <p className={styles.error}>
            Some media couldn't be uploaded or removed.
          </p>
        )}
      </Section>
    </>
  );
}
