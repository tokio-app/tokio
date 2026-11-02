import { MediaFile } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { getPicturePreviewURL } from "@/common/util";
import { DeletePictureModal, LibraryPicker } from "@/components";
// The tile's look, which the media picker's library gives
import styles from "@/components/MediaPicker/mediapicker.module.css";

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
  return (
    <LibraryPicker
      id={id}
      chosen={picture}
      events={{
        get: APP_EVENTS.GET_MINECRAFT_PICTURES,
        library: APP_EVENTS_RESPONSE.MINECRAFT_PICTURES,
        browse: APP_EVENTS.IMPORT_MINECRAFT_PICTURE,
        browsed: APP_EVENTS_RESPONSE.SET_MINECRAFT_PICTURE,
      }}
      texts={{
        title: "games.pictures.title",
        description: "games.pictures.description",
        search: "games.pictures.search",
        empty: "games.pictures.empty",
        noMatch: "games.pictures.noMatch",
        failed: "games.pictures.failed",
        browse: "games.pictures.browse",
      }}
      stays
      Delete={DeletePictureModal}
      tile={(item) => (
        <>
          <img
            className={styles.thumb}
            src={getPicturePreviewURL(item.file)}
            alt=""
            loading="lazy"
          />
          <span className={styles.label}>
            <span className={styles.file_name}>{item.name}</span>
          </span>
        </>
      )}
      onRequest={onRequest}
      onSelect={onSelect}
      onClose={onClose}
    />
  );
}
