import { MediaFile } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { getMediaPreviewURL, mediaKind } from "@/common/util";
import { releaseOnUnmount } from "@/helper/media";
import { CSSProperties, useId, useState } from "react";
import { FiFilm } from "react-icons/fi";
import { DeleteMediaModal } from "../DeleteModals";
import { SoundLength } from "../SoundPicker/SoundLength";
import { LibraryPicker } from "./LibraryPicker";
import styles from "./mediapicker.module.css";

type Props = {
  // What the image or video is for, an alert's or a studio element's id, which
  // SET_ALERT_MEDIA echoes
  id: string;
  // Its file now
  chosen: Pick<MediaFile, "file"> | null;
  // Asks main to save a file for it, which replies SET_ALERT_MEDIA with the
  // request number this returns
  onRequest: () => number;
  // Picks a file from the library, or takes its own off it
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
  style,
}: {
  file: string;
  onLength?: (seconds: number) => void;
  // Overlay Studio's crop, through object-view-box
  style?: CSSProperties;
}) {
  const video = useVideoURL(file);
  return mediaKind(file) === "video" ? (
    <video
      ref={releaseOnUnmount}
      className={styles.thumb}
      style={style}
      src={`${video}#t=0.1`}
      muted
      preload="metadata"
      onLoadedMetadata={(e) => onLength?.(e.currentTarget.duration)}
    />
  ) : (
    <img
      className={styles.thumb}
      style={style}
      src={getMediaPreviewURL(file)}
      alt=""
      loading="lazy"
    />
  );
}

/**
 * Picks the image or video an alert or an Overlay Studio element shows. The
 * alert's editor sets how long it shows.
 */
export function MediaPicker({
  id,
  chosen,
  onRequest,
  onSelect,
  onClose,
}: Props) {
  // The videos' lengths in seconds, read by their thumbnails
  const [lengths, setLengths] = useState<Record<string, number>>({});

  return (
    <LibraryPicker
      id={id}
      chosen={chosen}
      events={{
        get: APP_EVENTS.GET_MEDIA,
        library: APP_EVENTS_RESPONSE.GET_MEDIA,
        browse: APP_EVENTS.IMPORT_MEDIA,
        browsed: APP_EVENTS_RESPONSE.SET_ALERT_MEDIA,
      }}
      texts={{
        title: "components.mediaPicker.title",
        description: "components.mediaPicker.description",
        search: "components.mediaPicker.searchPlaceholder",
        empty: "components.mediaPicker.empty",
        noMatch: "components.mediaPicker.noMatch",
        failed: "components.mediaPicker.failed",
        browse: "common.browse",
      }}
      Delete={DeleteMediaModal}
      tile={(file) => (
        <>
          <MediaThumbnail
            file={file.file}
            onLength={(seconds) =>
              setLengths((known) => ({ ...known, [file.file]: seconds }))
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
        </>
      )}
      onRequest={onRequest}
      onSelect={onSelect}
      onClose={onClose}
    />
  );
}
