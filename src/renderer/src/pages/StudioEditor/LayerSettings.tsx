import { STUDIO_NAME_MAX_LENGTH, StudioLayer } from "@/common/schemas";
import { Field, Input } from "@/components";
import { useT } from "@/ui/i18n";
import styles from "./studioeditor.module.css";

type Props = {
  layer: StudioLayer;
  onChange: (layer: StudioLayer) => void;
};

/** The selected layer's name, and how its elements move together. */
export function LayerSettings({ layer, onChange }: Props) {
  const t = useT();
  return (
    <div className={styles.settings}>
      <h3 className={styles.panel_title}>{t("studio.layer.title")}</h3>
      <Field label={t("common.name")}>
        <Input
          maxLength={STUDIO_NAME_MAX_LENGTH}
          placeholder={t("studio.editor.untitledLayer")}
          value={layer.name}
          onChange={(e) => onChange({ ...layer, name: e.target.value })}
        />
      </Field>
      <p className={styles.note}>
        {t(
          layer.hidden
            ? "studio.layer.hidden"
            : layer.locked
              ? "studio.layer.locked"
              : "studio.layer.move",
        )}
      </p>
    </div>
  );
}
