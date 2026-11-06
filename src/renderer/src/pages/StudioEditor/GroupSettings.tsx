import { STUDIO_NAME_MAX_LENGTH, StudioGroup } from "@/common/schemas";
import { Field, Input } from "@/components";
import { useT } from "@/ui/i18n";
import styles from "./studioeditor.module.css";

type Props = {
  group: StudioGroup;
  onChange: (group: StudioGroup) => void;
};

/** The selected group's name, and how its elements move together. */
export function GroupSettings({ group, onChange }: Props) {
  const t = useT();
  return (
    <div className={styles.settings}>
      <h3 className={styles.panel_title}>{t("studio.group.title")}</h3>
      <Field label={t("common.name")}>
        <Input
          maxLength={STUDIO_NAME_MAX_LENGTH}
          placeholder={t("studio.editor.untitledGroup")}
          value={group.name}
          onChange={(e) => onChange({ ...group, name: e.target.value })}
        />
      </Field>
      <p className={styles.note}>
        {t(
          group.hidden
            ? "studio.group.hidden"
            : group.locked
              ? "studio.group.locked"
              : "studio.group.move",
        )}
      </p>
    </div>
  );
}
