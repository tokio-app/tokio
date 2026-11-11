import { APP_EVENTS } from "@/common/types";
import { Btn, Check, Section } from "@/components";
import { useT } from "@/ui/i18n";
import { FiFileText, FiUpload } from "react-icons/fi";

interface Props {
  debug: boolean;
  onChange: (debug: boolean) => void;
}

export function LogsSection({ debug, onChange }: Props) {
  const t = useT();
  return (
    <Section
      icon={<FiFileText />}
      title={t("settings.logs.title")}
      description={t("settings.logs.description")}
      actions={
        <Btn
          variant="icon"
          title={t("settings.logs.export")}
          onClick={() => window.api.emit(APP_EVENTS.EXPORT_LOGS)}
        >
          <FiUpload size={20} />
        </Btn>
      }
    >
      <Check
        label={t("settings.logs.debug")}
        checked={debug}
        onChange={(e) => onChange(e.target.checked)}
      />
    </Section>
  );
}
