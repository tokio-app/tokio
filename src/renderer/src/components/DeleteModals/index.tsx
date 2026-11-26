import { AlertSound, MediaFile, StudioOverlay } from "@/common/schemas";
import { APP_EVENTS, LiveSummary, OverlayApp } from "@/common/types";
import { formatDate } from "@/helper/format";
import { useLanguage, useT } from "@/ui/i18n";
import { Modal } from "../Modal";
import { EntityMetadata } from "@/common/schemas";
import { RefObject, useEffect, useRef, useState } from "react";
import { Select } from "../Elements";
import { Field } from "../Page";

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

// A profile picked among those that can go: the active one can't
export function DeleteProfileModal({
  profiles,
  onClose,
}: {
  profiles: EntityMetadata[];
  onClose: () => void;
}) {
  const t = useT();
  const [file, setFile] = useState(profiles[0]?.file ?? "");
  const item = profiles.find((p) => p.file === file);
  return (
    <Modal
      title={t("components.deleteModals.profileTitle")}
      description={
        item &&
        t("components.deleteModals.profileDescription", { name: item.name })
      }
      confirmText={t("common.delete")}
      onClose={onClose}
      onConfirm={() => {
        if (item) window.api.emit(APP_EVENTS.DELETE_PROFILE, { file });
        onClose();
      }}
    >
      <Field
        label={t("components.deleteModals.profileFrom")}
        hint={t("components.deleteModals.profileHint")}
      >
        <Select
          options={profiles.map((p) => ({ label: p.name, value: p.file }))}
          value={file}
          onChange={setFile}
        />
      </Field>
    </Modal>
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

// An alert of the profile, by its name as the list shows it. Its sound and
// media stay in the library.
export function DeleteAlertModal({
  item,
  onClose,
  onDelete,
}: Props<{ name: string }> & { onDelete: () => void }) {
  const t = useT();
  return (
    <Modal
      title={t("components.deleteModals.alertTitle")}
      description={t("components.deleteModals.alertDescription", {
        name: item.name,
      })}
      confirmText={t("common.delete")}
      onClose={onClose}
      onConfirm={() => {
        onDelete();
        onClose();
      }}
    />
  );
}

// A game action of the profile, by its name (see actionName)
export function DeleteActionModal({
  item,
  onClose,
  onDelete,
}: Props<{ name: string }> & { onDelete: () => void }) {
  const t = useT();
  return (
    <Modal
      title={t("components.deleteModals.actionTitle")}
      description={t("components.deleteModals.actionDescription", {
        name: item.name,
      })}
      confirmText={t("common.delete")}
      onClose={onClose}
      onConfirm={() => {
        onDelete();
        onClose();
      }}
    />
  );
}

// A test overlay, whose id an overlay being built connects with
export function DeleteTestOverlayModal({
  item,
  onClose,
}: Props<{ id: string; name: string }>) {
  const t = useT();
  return (
    <Modal
      title={t("components.deleteModals.testOverlayTitle")}
      description={t("components.deleteModals.testOverlayDescription", {
        name: item.name,
      })}
      confirmText={t("common.delete")}
      onClose={onClose}
      onConfirm={() => {
        window.api.emit(APP_EVENTS.REMOVE_TEST_OVERLAY, { id: item.id });
        onClose();
      }}
    />
  );
}

/**
 * Puts the focus back in a list once a row the user deleted has left it.
 * Its trash went with it, so Chromium dropped the focus on <body>: it goes
 * to the row now in its place, else the last row, else to fallback. Call
 * the function it returns with the row's id and place once its delete is
 * asked for; rows are the list's children.
 */
export function useFocusAfterDelete(
  ids: string[],
  list: RefObject<HTMLElement | null>,
  fallback: RefObject<HTMLElement | null>,
) {
  const deleted = useRef<{ id: string; index: number } | null>(null);
  useEffect(() => {
    const row = deleted.current;
    if (!row || ids.includes(row.id)) return;
    deleted.current = null;
    // Only when the focus went with the row (jsdom keeps it on the detached
    // button), not after a delete from elsewhere
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) return;
    const rows = [...(list.current?.children ?? [])];
    const target =
      rows[Math.min(row.index, rows.length - 1)]?.querySelector<HTMLElement>(
        "input:not(:disabled), button:not(:disabled), a[href]",
      ) ?? fallback.current;
    target?.focus();
  });
  return (id: string, index: number) => {
    deleted.current = { id, index };
  };
}
