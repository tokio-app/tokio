import { useT } from "@/ui/i18n";
import styles from "./elements.module.css";

export function Spinner({ size = 16 }: { size?: number }) {
  const t = useT();
  return (
    <span
      role="status"
      aria-label={t("common.loading")}
      className={styles.spinner}
      style={{ width: size, height: size }}
    />
  );
}
