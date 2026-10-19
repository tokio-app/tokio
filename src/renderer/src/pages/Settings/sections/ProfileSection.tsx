import { EntityMetadata } from "@/common/schemas";
import { APP_EVENTS } from "@/common/types";
import { Btn, Field, Section, Select } from "@/components";
import { flushSettings } from "@/hooks";
import { FiCopy, FiDownload, FiPlus, FiUpload, FiUsers } from "react-icons/fi";
import styles from "../settings.module.css";

interface Props {
  profiles: EntityMetadata[];
  active: EntityMetadata;
  locked: boolean;
  onNew: () => void;
  onClone: () => void;
}

export function ProfileSection({
  profiles,
  active,
  locked,
  onNew,
  onClone,
}: Props) {
  return (
    <Section
      icon={<FiUsers />}
      title="Live Profiles"
      description="Manage settings for different lives."
    >
      <div className={styles.profiles}>
        <Field
          label="Active Profile"
          hint={locked ? "(disconnect to switch)" : undefined}
          className={styles.profile_select}
        >
          <Select
            disabled={locked}
            options={profiles.map((p) => ({ label: p.name, value: p.file }))}
            value={active.file}
            onChange={(file) => {
              // Changes still waiting go to the profile they were made on.
              flushSettings();
              // Main answers with the new settings, which updates the page.
              window.api.emit(APP_EVENTS.SET_PROFILE, { file });
            }}
          />
        </Field>

        <div className={styles.buttons}>
          <Btn title="Create New Profile" onClick={onNew}>
            <FiPlus /> New
          </Btn>
          <Btn title="Clone a Profile" onClick={onClone}>
            <FiCopy /> Clone
          </Btn>
          <Btn
            onClick={() =>
              window.api.emit(APP_EVENTS.IMPORT_ENTITY, { type: "profile" })
            }
          >
            <FiDownload /> Import
          </Btn>
          <Btn
            onClick={() =>
              window.api.emit(APP_EVENTS.EXPORT_ENTITY, {
                type: "profile",
                file: active.file,
              })
            }
          >
            <FiUpload /> Export
          </Btn>
        </div>
      </div>
    </Section>
  );
}
