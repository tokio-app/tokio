import { EntityMetadata } from "@/common/schemas";
import { APP_EVENTS } from "@/common/types";
import { Btn, Field, Section, Select } from "@/components";
import { flushSettings } from "@/hooks";
import { useT } from "@/ui/i18n";
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
  const t = useT();
  return (
    <Section
      icon={<FiUsers />}
      title={t("settings.profiles.title")}
      description={t("settings.profiles.description")}
    >
      <div className={styles.profiles}>
        <Field
          label={t("settings.profiles.active")}
          hint={locked ? t("settings.profiles.locked") : undefined}
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
          <Btn title={t("settings.profiles.newTitle")} onClick={onNew}>
            <FiPlus /> {t("settings.profiles.new")}
          </Btn>
          <Btn title={t("settings.profiles.cloneHint")} onClick={onClone}>
            <FiCopy /> {t("settings.profiles.clone")}
          </Btn>
          <Btn
            onClick={() =>
              window.api.emit(APP_EVENTS.IMPORT_ENTITY, { type: "profile" })
            }
          >
            <FiDownload /> {t("common.import")}
          </Btn>
          <Btn
            onClick={() =>
              window.api.emit(APP_EVENTS.EXPORT_ENTITY, {
                type: "profile",
                file: active.file,
              })
            }
          >
            <FiUpload /> {t("common.export")}
          </Btn>
        </div>
      </div>
    </Section>
  );
}
