import { Check, Section } from "@/components";
import { useT } from "@/ui/i18n";
import { FiDownloadCloud } from "react-icons/fi";

interface Props {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  // Official overlays update in the background too
  overlays: boolean;
  onOverlaysChange: (enabled: boolean) => void;
}

export function UpdatesSection({
  enabled,
  onChange,
  overlays,
  onOverlaysChange,
}: Props) {
  const t = useT();
  return (
    <Section
      icon={<FiDownloadCloud />}
      title={t("settings.updates.title")}
      description={t("settings.updates.description")}
    >
      <Check
        label={t("settings.updates.label")}
        checked={enabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <Check
        label={t("settings.updates.overlays")}
        checked={overlays}
        onChange={(e) => onOverlaysChange(e.target.checked)}
      />
    </Section>
  );
}
