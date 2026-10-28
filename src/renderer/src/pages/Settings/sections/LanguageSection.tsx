import { APP_LANGUAGES } from "@/common/i18n";
import { FormGrid, Section, Select } from "@/components";
import { useT } from "@/ui/i18n";
import { FiGlobe } from "react-icons/fi";

interface Props {
  // "system", or a tag in APP_LANGUAGES
  language: string;
  onChange: (language: string) => void;
}

// Each language named in its own, so it can be found from any of them
export function LanguageSection({ language, onChange }: Props) {
  const t = useT();
  const title = t("settings.language.title");
  const options = [
    { value: "system", label: t("settings.language.system") },
    ...APP_LANGUAGES.map(({ tag, name }) => ({ value: tag, label: name })),
  ];
  // One Tokio no longer has follows the system, as main shows it
  const value = options.some((o) => o.value === language) ? language : "system";

  return (
    <Section
      icon={<FiGlobe />}
      title={title}
      description={t("settings.language.description")}
    >
      {/* In the grid's first column, like the fields above and below */}
      <FormGrid>
        <Select
          aria-label={title}
          options={options}
          value={value}
          onChange={onChange}
        />
      </FormGrid>
    </Section>
  );
}
