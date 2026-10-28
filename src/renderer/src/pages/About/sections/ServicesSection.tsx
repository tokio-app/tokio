import { Section } from "@/components";
import { useT } from "@/ui/i18n";
import { FiGlobe } from "react-icons/fi";
import styles from "../about.module.css";
import { SERVICES } from "../helper";

export function ServicesSection() {
  const t = useT();
  return (
    <Section
      icon={<FiGlobe />}
      title={t("about.services.title")}
      description={t("about.services.description")}
    >
      <div className={styles.list}>
        {SERVICES.map(({ name, note }) => (
          <div key={name} className={styles.row}>
            <div className={styles.row_info}>
              <span className={styles.row_name}>{name}</span>
              <p className={styles.muted}>{note}</p>
            </div>
          </div>
        ))}
      </div>
      <p className={styles.muted}>{t("about.services.disclaimer")}</p>
    </Section>
  );
}
