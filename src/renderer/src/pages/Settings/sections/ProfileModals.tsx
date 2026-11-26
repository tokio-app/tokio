import { EntityMetadata } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { Field, Input, Modal, Select } from "@/components";
import { useIpcListener } from "@/hooks";
import { useT } from "@/ui/i18n";
import { useState } from "react";

// Open until main answers: a refused name stays to fix, the notice says why.
// With `file`, a reply about another profile's file isn't this modal's.
function useAnswered(
  response:
    | APP_EVENTS_RESPONSE.CREATE_PROFILE
    | APP_EVENTS_RESPONSE.CLONE_PROFILE
    | APP_EVENTS_RESPONSE.RENAME_PROFILE,
  onClose: () => void,
  file?: string,
) {
  const [waiting, setWaiting] = useState(false);
  useIpcListener(response, (res) => {
    if (file && res && "file" in res && res.file !== file) return;
    setWaiting(false);
    if (res?.success) onClose();
  });
  return [waiting, setWaiting] as const;
}

export function NewProfileModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [name, setName] = useState("");
  const [waiting, setWaiting] = useAnswered(
    APP_EVENTS_RESPONSE.CREATE_PROFILE,
    onClose,
  );

  return (
    <Modal
      title={t("settings.profiles.newTitle")}
      description={t("settings.profiles.newDescription")}
      confirmText={t("settings.profiles.create")}
      onClose={onClose}
      onConfirm={() => {
        if (!name.trim() || waiting) return;
        setWaiting(true);
        window.api.emit(APP_EVENTS.CREATE_PROFILE, { name });
      }}
    >
      <Field label={t("settings.profiles.name")}>
        <Input
          placeholder={t("settings.profiles.namePlaceholder")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </Field>
    </Modal>
  );
}

type CloneProps = {
  profiles: EntityMetadata[];
  // Cloned unless another profile is picked
  active: EntityMetadata;
  onClose: () => void;
};

export function CloneProfileModal({ profiles, active, onClose }: CloneProps) {
  const t = useT();
  const [ref, setRef] = useState(active.file);
  const [name, setName] = useState("");
  const [waiting, setWaiting] = useAnswered(
    APP_EVENTS_RESPONSE.CLONE_PROFILE,
    onClose,
  );

  return (
    <Modal
      title={t("settings.profiles.cloneTitle")}
      description={t("settings.profiles.cloneDescription")}
      confirmText={t("settings.profiles.cloneConfirm")}
      onClose={onClose}
      onConfirm={() => {
        if (!name.trim() || waiting) return;
        setWaiting(true);
        window.api.emit(APP_EVENTS.CLONE_PROFILE, { name, ref });
      }}
    >
      <Field label={t("settings.profiles.cloneFrom")}>
        <Select
          options={profiles.map((p) => ({ label: p.name, value: p.file }))}
          value={ref}
          onChange={setRef}
        />
      </Field>
      <Field label={t("settings.profiles.cloneName")}>
        <Input
          placeholder={t("settings.profiles.cloneNamePlaceholder")}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
    </Modal>
  );
}

type RenameProps = {
  // The profile renamed, with the name it has now
  profile: EntityMetadata;
  onClose: () => void;
};

export function RenameProfileModal({ profile, onClose }: RenameProps) {
  const t = useT();
  const [name, setName] = useState(profile.name);
  const [waiting, setWaiting] = useAnswered(
    APP_EVENTS_RESPONSE.RENAME_PROFILE,
    onClose,
    profile.file,
  );

  return (
    <Modal
      title={t("settings.profiles.renameTitle")}
      description={t("settings.profiles.renameDescription")}
      confirmText={t("settings.profiles.rename")}
      onClose={onClose}
      onConfirm={() => {
        if (!name.trim() || waiting) return;
        // Nothing to change
        if (name.trim() === profile.name) return onClose();
        setWaiting(true);
        window.api.emit(APP_EVENTS.RENAME_PROFILE, {
          file: profile.file,
          name,
        });
      }}
    >
      <Field label={t("settings.profiles.name")}>
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoFocus
        />
      </Field>
    </Modal>
  );
}
