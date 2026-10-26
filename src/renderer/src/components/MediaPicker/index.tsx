import { Alert, MediaFile } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { getMediaPreviewURL, mediaKind } from "@/common/util";
import { cx } from "@/helper/cx";
import { useIpcListener } from "@/hooks/useIpcListener";
import { useIpcRequest } from "@/hooks/useIpcRequest";
import { useId, useRef, useState } from "react";
import { FiCheck, FiFilm, FiTrash2 } from "react-icons/fi";
import { DeleteMediaModal } from "../DeleteModals";
import { Btn, SearchToggle } from "../Elements";
import { Modal } from "../Modal";
import { SoundLength } from "../SoundPicker/SoundLength";
import list from "../SoundPicker/soundpicker.module.css";
import styles from "./mediapicker.module.css";

type Props = {
  // The alert the image or video is for
  alert: Alert;
  // Asks main to save a file for the alert, which replies SET_ALERT_MEDIA
  // with the request number this returns
  onRequest: () => number;
  // Picks a file from the library, or takes the alert's off it
  onSelect: (media: MediaFile | null) => void;
  onClose: () => void;
};

/**
 * A media library video's URL for one player. Chromium fails the players
 * that load the same tokio-media: URL at once, like an alert's thumbnail and
 * its preview, so each gets its own; main ignores the query.
 */
export function useVideoURL(file: string) {
  const player = useId();
  return `${getMediaPreviewURL(file)}?player=${encodeURIComponent(player)}`;
}

/**
 * What a media library file shows: an image, or a video's first frame. A
 * video also gives its length once it's read.
 */
export function MediaThumbnail({
  file,
  onLength,
}: {
  file: string;
  onLength?: (seconds: number) => void;
}) {
  const video = useVideoURL(file);
  return mediaKind(file) === "video" ? (
    <video
      className={styles.thumb}
      src={`${video}#t=0.1`}
      muted
      preload="metadata"
      onLoadedMetadata={(e) => onLength?.(e.currentTarget.duration)}
    />
  ) : (
    <img
      className={styles.thumb}
      src={getMediaPreviewURL(file)}
      alt=""
      loading="lazy"
    />
  );
}

/**
 * Picks the image or video an alert shows on its overlay. The alert's
 * editor sets how long it shows.
 */
export function MediaPicker({ alert, onRequest, onSelect, onClose }: Props) {
  const { id, media } = alert;
  const [library, setLibrary] = useState<MediaFile[]>([]);
  const [search, setSearch] = useState("");
  const [failed, setFailed] = useState(false);
  // The newest request sent, the only one whose failure is shown
  const latest = useRef(0);
  // File waiting for the user to confirm it's deleted
  const [removing, setRemoving] = useState<MediaFile | null>(null);
  // The videos' lengths in seconds, read by their thumbnails
  const [lengths, setLengths] = useState<Record<string, number>>({});

  useIpcRequest(APP_EVENTS.GET_MEDIA);

  // Also the reply to a browse or a deletion
  useIpcListener(APP_EVENTS_RESPONSE.GET_MEDIA, (res) => {
    if (!res) return;
    setLibrary(res.data);
    setFailed(!res.success);
  });

  useIpcListener(APP_EVENTS_RESPONSE.SET_ALERT_MEDIA, (res) => {
    if (res?.id === id && res.request === latest.current) {
      setFailed(!res.success);
    }
  });

  const needle = search.trim().toLowerCase();
  const files = library.filter((f) => f.name.toLowerCase().includes(needle));

  return (
    <>
      <Modal
        title="Select media"
        description="An image or video shown on this alert's overlay."
        maxWidth="840px"
        onClose={onClose}
        actions={
          <SearchToggle
            placeholder="Search your media..."
            value={search}
            onChange={setSearch}
          />
        }
        footer={
          <>
            <Btn disabled={!media} onClick={() => onSelect(null)}>
              Clear
            </Btn>
            <Btn onClick={onClose}>Cancel</Btn>
            <Btn
              variant="accent"
              onClick={() => {
                latest.current = onRequest();
                window.api.emit(APP_EVENTS.IMPORT_MEDIA, {
                  id,
                  request: latest.current,
                });
              }}
            >
              Browse file...
            </Btn>
          </>
        }
      >
        <div className={styles.grid}>
          {files.map((file) => {
            const current = file.file === media?.file;
            return (
              <div key={file.file} className={styles.tile}>
                <button
                  type="button"
                  className={cx(styles.choice, current && styles.chosen)}
                  aria-current={current || undefined}
                  title={file.name}
                  onClick={() => onSelect(file)}
                >
                  <MediaThumbnail
                    file={file.file}
                    onLength={(seconds) =>
                      setLengths((known) => ({
                        ...known,
                        [file.file]: seconds,
                      }))
                    }
                  />
                  <span className={styles.label}>
                    {mediaKind(file.file) === "video" && (
                      <FiFilm size={14} className={styles.video} aria-hidden />
                    )}
                    <span className={styles.file_name}>{file.name}</span>
                    {/* The button's name reads "Clip 12s", not "Clip12s" */}{" "}
                    <SoundLength seconds={lengths[file.file]} />
                  </span>
                  {current && (
                    <FiCheck size={14} className={styles.check} aria-hidden />
                  )}
                </button>
                <Btn
                  variant="icon"
                  title="Delete"
                  className={styles.delete}
                  onClick={() => setRemoving(file)}
                >
                  <FiTrash2 size={16} />
                </Btn>
              </div>
            );
          })}

          {files.length === 0 && (
            <p className={cx(list.status, styles.empty)}>
              {library.length === 0
                ? "No media yet. Browse for an image or video."
                : "No media matches."}
            </p>
          )}
        </div>

        {failed && (
          <p className={list.error}>Couldn't save or load the media.</p>
        )}
      </Modal>

      {removing && (
        <DeleteMediaModal item={removing} onClose={() => setRemoving(null)} />
      )}
    </>
  );
}
