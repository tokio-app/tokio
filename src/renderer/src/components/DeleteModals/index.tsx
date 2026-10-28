import { AlertSound, MediaFile } from "@/common/schemas";
import { APP_EVENTS, OverlayApp } from "@/common/types";
import { useT } from "@/ui/i18n";
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
  const t = useT();
  return (
    <Modal
      title={t("components.deleteModals.soundTitle")}
      description={t("components.deleteModals.soundDescription", {
        name: item.name,
      })}
      confirmText={t("common.delete")}
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
  const t = useT();
  return (
    <Modal
      title={t("components.deleteModals.mediaTitle")}
      description={t("components.deleteModals.mediaDescription", {
        name: item.name,
      })}
      confirmText={t("common.delete")}
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
  const t = useT();
  return (
    <Modal
      title={t("components.deleteModals.pictureTitle")}
      description={t("components.deleteModals.pictureDescription", {
        name: item.name,
      })}
      confirmText={t("common.delete")}
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
  const t = useT();
  return (
    <Modal
      title={t("components.deleteModals.overlayTitle")}
      description={t("components.deleteModals.overlayDescription", {
        name: item.name,
      })}
      confirmText={t("common.remove")}
      onClose={onClose}
      onConfirm={() => {
        onDelete?.(item);
        window.api.emit(APP_EVENTS.REMOVE_OVERLAY, { id: item.id });
        onClose();
      }}
    />
  );
}
