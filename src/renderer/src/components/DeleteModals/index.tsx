import { AlertSound, MediaFile, StudioOverlay } from "@/common/schemas";
import { APP_EVENTS, LiveSummary, OverlayApp } from "@/common/types";
import { formatDate } from "@/helper/format";
import { useLanguage, useT } from "@/ui/i18n";
import { Modal } from "../Modal";

type Props<T> = {
  // The item waiting for the user to confirm it's deleted
  item: T;
  onClose: () => void;
};

export function DeleteSoundModal({
  item,
  onClose,
  onDelete,
}: Props<AlertSound> & {
  // Runs before the request, e.g. to stop the sound's test
  onDelete?: (item: AlertSound) => void;
}) {
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

export function DeleteMediaModal({ item, onClose }: Props<MediaFile>) {
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
        window.api.emit(APP_EVENTS.REMOVE_MEDIA, { file: item.file });
        onClose();
      }}
    />
  );
}

// A picture in the Minecraft library, which the games overlay shows
export function DeletePictureModal({ item, onClose }: Props<MediaFile>) {
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
        window.api.emit(APP_EVENTS.REMOVE_MINECRAFT_PICTURE, {
          file: item.file,
        });
        onClose();
      }}
    />
  );
}

// A LIVE in the profile's history, by when it started
export function DeleteLiveModal({
  item,
  onClose,
}: Props<Pick<LiveSummary, "startedAt">>) {
  const t = useT();
  const language = useLanguage();
  return (
    <Modal
      title={t("components.deleteModals.liveTitle")}
      description={t("components.deleteModals.liveDescription", {
        date: formatDate(item.startedAt, language, "dateTime"),
      })}
      confirmText={t("common.delete")}
      onClose={onClose}
      onConfirm={() => {
        window.api.emit(APP_EVENTS.DELETE_LIVE, { startedAt: item.startedAt });
        onClose();
      }}
    />
  );
}

// Every LIVE the profile kept
export function ClearHistoryModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  return (
    <Modal
      title={t("components.deleteModals.historyTitle")}
      description={t("components.deleteModals.historyDescription")}
      confirmText={t("components.deleteModals.historyConfirm")}
      onClose={onClose}
      onConfirm={() => {
        window.api.emit(APP_EVENTS.CLEAR_LIVES);
        onClose();
      }}
    />
  );
}

// An Overlay Studio overlay, by its name as the list shows it
export function DeleteStudioOverlayModal({
  item,
  onClose,
}: Props<Pick<StudioOverlay, "id" | "name">>) {
  const t = useT();
  return (
    <Modal
      title={t("components.deleteModals.studioTitle")}
      description={t("components.deleteModals.studioDescription", {
        name: item.name,
      })}
      confirmText={t("common.delete")}
      onClose={onClose}
      onConfirm={() => {
        window.api.emit(APP_EVENTS.REMOVE_STUDIO_OVERLAY, { id: item.id });
        onClose();
      }}
    />
  );
}

export function RemoveOverlayModal({
  item,
  onClose,
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
        window.api.emit(APP_EVENTS.REMOVE_OVERLAY, { id: item.id });
        onClose();
      }}
    />
  );
}
