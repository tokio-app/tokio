import { STUDIO_NAME_MAX_LENGTH, StudioOverlay } from "@/common/schemas";
import { getStudioOverlayURL } from "@/common/util";
import { CopyField, Field, Input, RadioGroup } from "@/components";
import { sizeText } from "@/pages/Studio/helper";
import { useT } from "@/ui/i18n";
import styles from "./studioeditor.module.css";

type Props = {
  overlay: StudioOverlay;
  onChange: (overlay: StudioOverlay) => void;
};

/** With no layer selected: the overlay's name, canvas and URL. */
export function OverlaySettings({ overlay, onChange }: Props) {
  const t = useT();
  return (
    <div className={styles.settings}>
      <h3 className={styles.panel_title}>{t("studio.settings.title")}</h3>
      <Field label={t("common.name")}>
        <Input
          maxLength={STUDIO_NAME_MAX_LENGTH}
          placeholder={t("studio.untitled")}
          value={overlay.name}
          onChange={(e) => onChange({ ...overlay, name: e.target.value })}
        />
      </Field>
      <Field label={t("studio.settings.canvas")}>
        <RadioGroup
          name="studio-size"
          value={overlay.size}
          options={[
            {
              value: "portrait",
              label: t("studio.settings.portrait"),
              description: sizeText("portrait"),
            },
            {
              value: "landscape",
              label: t("studio.settings.landscape"),
              description: sizeText("landscape"),
            },
          ]}
          onChange={(size) => onChange({ ...overlay, size })}
        />
      </Field>
      <Field label={t("common.overlayUrl")}>
        <CopyField
          value={getStudioOverlayURL(overlay.id)}
          title={t("studio.copyUrl")}
        />
      </Field>
    </div>
  );
}
