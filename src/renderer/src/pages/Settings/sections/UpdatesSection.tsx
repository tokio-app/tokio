import { Check, Section } from "@/components";
import { useT } from "@/ui/i18n";
import { FiDownloadCloud } from "react-icons/fi";

interface Props {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

export function UpdatesSection({ enabled, onChange }: Props) {
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
    </Section>
  );
}
