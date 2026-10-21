import { Check, Section } from "@/components";
import { FiDownloadCloud } from "react-icons/fi";

interface Props {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

export function UpdatesSection({ enabled, onChange }: Props) {
  return (
    <Section
      icon={<FiDownloadCloud />}
      title="Updates"
      description="Checked on startup and every few hours."
    >
      <Check
        label="Check for updates automatically"
        checked={enabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </Section>
  );
}
