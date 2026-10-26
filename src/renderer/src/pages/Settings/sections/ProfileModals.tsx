import { EntityMetadata } from "@/common/schemas";
import { APP_EVENTS, APP_EVENTS_RESPONSE } from "@/common/types";
import { Field, Input, Modal, Select } from "@/components";
import { useIpcListener } from "@/hooks";
import { useState } from "react";

// Open until main answers: a refused name stays to fix, the notice says why.
function useAnswered(
  response:
    APP_EVENTS_RESPONSE.CREATE_PROFILE | APP_EVENTS_RESPONSE.CLONE_PROFILE,
  onClose: () => void,
) {
  const [waiting, setWaiting] = useState(false);
  useIpcListener(response, (res) => {
    setWaiting(false);
    if (res?.success) onClose();
  });
  return [waiting, setWaiting] as const;
}

export function NewProfileModal({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState("");
  const [waiting, setWaiting] = useAnswered(
    APP_EVENTS_RESPONSE.CREATE_PROFILE,
    onClose,
  );

  return (
    <Modal
      title="Create New Profile"
      description="Enter a name for your new streamer profile. This will start with completely blank settings."
      confirmText="Create Profile"
      onClose={onClose}
      onConfirm={() => {
        if (!name.trim() || waiting) return;
        setWaiting(true);
        window.api.emit(APP_EVENTS.CREATE_PROFILE, { name });
      }}
    >
      <Field label="Profile Name">
        <Input
          placeholder="e.g. Chill Stream"
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
  const [ref, setRef] = useState(active.file);
  const [name, setName] = useState("");
  const [waiting, setWaiting] = useAnswered(
    APP_EVENTS_RESPONSE.CLONE_PROFILE,
    onClose,
  );

  return (
    <Modal
      title="Clone Existing Profile"
      description="Select an existing profile to copy its settings, and give the new clone a name."
      confirmText="Clone Profile"
      onClose={onClose}
      onConfirm={() => {
        if (!name.trim() || waiting) return;
        setWaiting(true);
        window.api.emit(APP_EVENTS.CLONE_PROFILE, { name, ref });
      }}
    >
      <Field label="Profile to Clone">
        <Select
          options={profiles.map((p) => ({ label: p.name, value: p.file }))}
          value={ref}
          onChange={setRef}
        />
      </Field>
      <Field label="New Profile Name">
        <Input
          placeholder="e.g. Horror Stream Layout"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Field>
    </Modal>
  );
}
