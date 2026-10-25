import { AlertSound, MediaFile } from "@/common/schemas";
import { APP_EVENTS, OverlayApp } from "@/common/types";
import { Modal } from "../Modal";

type Props<T> = {
  // The item waiting for the user to confirm it's deleted
  item: T;
  onClose: () => void;
  // Runs before the request, e.g. to stop the item's test
  onDelete?: (item: T) => void;
};

export function DeleteSoundModal({
  item,
  onClose,
  onDelete,
}: Props<AlertSound>) {
  return (
    <Modal
      title="Delete sound?"
      description={`"${item.name}" will be deleted from your computer and from every alert that plays it, in all your profiles.`}
      confirmText="Delete"
      onClose={onClose}
      onConfirm={() => {
        onDelete?.(item);
        window.api.emit(APP_EVENTS.REMOVE_SOUND, { file: item.file });
        onClose();
      }}
    />
  );
}

export function DeleteMediaModal({
  item,
  onClose,
  onDelete,
}: Props<MediaFile>) {
  return (
    <Modal
      title="Delete media?"
      description={`"${item.name}" will be deleted from your computer and from every alert that shows it, in all your profiles.`}
      confirmText="Delete"
      onClose={onClose}
      onConfirm={() => {
        onDelete?.(item);
        window.api.emit(APP_EVENTS.REMOVE_MEDIA, { file: item.file });
        onClose();
      }}
    />
  );
}

// A picture in the Minecraft library, which the games overlay shows
export function DeletePictureModal({
  item,
  onClose,
  onDelete,
}: Props<MediaFile>) {
  return (
    <Modal
      title="Delete picture?"
      description={`"${item.name}" will be deleted from your computer and from every game action that shows it, in all your profiles.`}
      confirmText="Delete"
      onClose={onClose}
      onConfirm={() => {
        onDelete?.(item);
        window.api.emit(APP_EVENTS.REMOVE_MINECRAFT_PICTURE, {
          file: item.file,
        });
        onClose();
      }}
    />
  );
}

export function RemoveOverlayModal({
  item,
  onClose,
  onDelete,
}: Props<Pick<OverlayApp, "id" | "name">>) {
  return (
    <Modal
      title="Remove overlay?"
      description={`${item.name} and its settings will be deleted. Streaming apps using its URL will stop showing it.`}
      confirmText="Remove"
      onClose={onClose}
      onConfirm={() => {
        onDelete?.(item);
        window.api.emit(APP_EVENTS.REMOVE_OVERLAY, { id: item.id });
        onClose();
      }}
    />
  );
}
