import { Check, Section } from "@/components";
import { FiInbox } from "react-icons/fi";

interface Props {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
}

export function TraySection({ enabled, onChange }: Props) {
  return (
    <Section
      icon={<FiInbox />}
      title="Tray"
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
