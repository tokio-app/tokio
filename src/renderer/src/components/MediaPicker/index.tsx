import {
  Alert,
  MEDIA_DURATION,
  MEDIA_MAX_DURATION,
  MediaFile,
} from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import {
  getAlertOverlayURL,
  getMediaPreviewURL,
  mediaKind,
} from "@/common/util";
import { cx } from "@/helper/cx";
import { useIpcListener } from "@/hooks/useIpcListener";
import { useIpcRequest } from "@/hooks/useIpcRequest";
import { useEffect, useState } from "react";
import { FaRegCopy } from "react-icons/fa";
import { FiCheck, FiFilm, FiTrash2 } from "react-icons/fi";
import { DeleteMediaModal } from "../DeleteModals";
import { Btn, Check, NumberInput, SearchToggle } from "../Elements";
import { Modal } from "../Modal";
import list from "../SoundPicker/soundpicker.module.css";
import styles from "./mediapicker.module.css";

type Props = {
  // The alert the image or video is for
  alert: Alert;
  // Asks main to save a file for the alert, which replies SET_ALERT_MEDIA
  onRequest: () => void;
  // Picks a file from the library, or takes the alert's off it
  onSelect: (media: MediaFile | null) => void;
  onDuration: (seconds: number) => void;
  // Makes the duration follow the video's length, or not
  onMatch: (match: boolean) => void;
  onClose: () => void;
};

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
  const src = getMediaPreviewURL(file);
  return mediaKind(file) === "video" ? (
    <video
      className={styles.thumb}
      src={`${src}#t=0.1`}
      muted
      preload="metadata"
      onLoadedMetadata={(e) => onLength?.(e.currentTarget.duration)}
    />
  ) : (
    <img className={styles.thumb} src={src} alt="" loading="lazy" />
  );
}

/**
 * Picks the image or video an alert shows on its overlay, and gives that
 * overlay's URL. It stays open after a pick, for the duration and the URL.
 */
export function MediaPicker({
  alert,
  onRequest,
  onSelect,
  onDuration,
  onMatch,
  onClose,
}: Props) {
  const { id, media } = alert;
  const url = getAlertOverlayURL(id);
  const [library, setLibrary] = useState<MediaFile[]>([]);
  const [search, setSearch] = useState("");
  const [failed, setFailed] = useState(false);
  // Shows a check on the URL for a moment after copying it
  const [copied, setCopied] = useState(false);
  // File waiting for the user to confirm it's deleted
  const [removing, setRemoving] = useState<MediaFile | null>(null);
  // The videos' lengths in seconds, read by their thumbnails
  const [lengths, setLengths] = useState<Record<string, number>>({});

  useEffect(() => {
    if (!copied) return undefined;
    const timer = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(timer);
  }, [copied]);

  useIpcRequest(APP_EVENTS.GET_MEDIA);

  // Also the reply to a browse or a deletion
  useIpcListener(APP_EVENTS_RESPONSE.GET_MEDIA, (res) => {
    if (!res) return;
    setLibrary(res.data);
    setFailed(!res.success);
  });

  useIpcListener(APP_EVENTS_RESPONSE.SET_ALERT_MEDIA, (res) => {
    if (res?.id === id) setFailed(!res.success);
  });

  const needle = search.trim().toLowerCase();
  const files = library.filter((f) => f.name.toLowerCase().includes(needle));

  const video = media ? mediaKind(media.file) === "video" : false;
  // The whole video, in seconds the duration takes. Unknown for videos that
  // don't say their length, like some recordings.
  const length = media && lengths[media.file];
  const match =
    length && Number.isFinite(length)
      ? Math.min(Math.ceil(length), MEDIA_MAX_DURATION)
      : null;
  // The duration follows the video, also one picked after it was matched.
  const following = !!media?.match_video && video && match !== null;

  useEffect(() => {
    if (following && media && match !== null && media.duration !== match) {
      onDuration(match);
    }
  }, [following, match, media, onDuration]);

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
            <div className={styles.timing}>
              <label className={styles.duration}>
                Duration (seconds)
                <NumberInput
                  integer
                  min={1}
                  max={MEDIA_MAX_DURATION}
                  className={styles.number}
                  value={media?.duration ?? MEDIA_DURATION}
                  disabled={!media || following}
                  onChange={onDuration}
                />
              </label>
              {media && video && (
                <Check
                  label="Match video"
                  title={`The video's length, up to ${MEDIA_MAX_DURATION} seconds`}
                  checked={media.match_video}
                  // Off, a video of unknown length can't be matched
                  disabled={!media.match_video && match === null}
                  onChange={(e) => onMatch(e.target.checked)}
                />
              )}
            </div>
            <Btn disabled={!media} onClick={() => onSelect(null)}>
              Clear
            </Btn>
            <Btn
              onClick={() => {
                onRequest();
                window.api.emit(APP_EVENTS.IMPORT_MEDIA, { id });
              }}
            >
              Browse file...
            </Btn>
            <Btn variant="accent" onClick={onClose}>
              Done
            </Btn>
          </>
        }
      >
        <div className={styles.overlay}>
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
