import { Btn } from "@/components";
import { useT } from "@/ui/i18n";
import { useId } from "react";
import { FiPlay } from "react-icons/fi";
import styles from "../home.module.css";

// While a hotkey, the phone or the API has paused Tokio's reactions
export function PausedSection({ onResume }: { onResume: () => void }) {
  const t = useT();
  const id = useId();
  return (
    <section className={styles.paused} aria-labelledby={id}>
      {/* Now playing's bars, standing still */}
      <span className={styles.paused_bars} aria-hidden>
        <span />
        <span />
      </span>
      <div className={styles.paused_body}>
        <h2 id={id} className={styles.paused_title}>
          {t("home.paused.title")}
        </h2>
        <p className={styles.paused_text}>{t("home.paused.description")}</p>
      </div>
      <Btn variant="accent" className={styles.paused_btn} onClick={onResume}>
        <FiPlay size={16} /> {t("home.paused.resume")}
      </Btn>
    </section>
  );
}
