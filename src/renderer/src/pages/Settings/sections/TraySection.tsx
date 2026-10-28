import { Check, Section } from "@/components";
import { useT } from "@/ui/i18n";
import { FiInbox } from "react-icons/fi";

interface Props {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

export function TraySection({ enabled, onChange }: Props) {
  const t = useT();
  return (
    <Section
      icon={<FiInbox />}
      title={t("settings.tray.title")}
      description="Open Tokio or quit from its icon."
    >
      <Check
        label="Keep Tokio running in the tray when you close it"
        checked={enabled}
        onChange={(e) => onChange(e.target.checked)}
      />
    </Section>
  );
}
