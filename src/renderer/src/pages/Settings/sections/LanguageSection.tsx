import { APP_LANGUAGES } from "@/common/i18n";
import { Section, Select } from "@/components";
import { useT } from "@/ui/i18n";
import { FiGlobe } from "react-icons/fi";
import styles from "../settings.module.css";

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
      <Select
        aria-label={title}
        className={styles.language_select}
        options={options}
        value={value}
        onChange={onChange}
      />
    </Section>
  );
}
