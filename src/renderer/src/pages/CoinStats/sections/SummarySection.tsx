import { Section } from "@/components";
import { useLanguage, useT } from "@/ui/i18n";
import { ReactNode } from "react";
import styles from "../coinstats.module.css";
import { Stat, statText } from "../helper";

interface Props {
  title: string;
  // Each on its own line under the title
  lines: string[];
  // The icon button on the title's row
  action: ReactNode;
  // The tab's tiles (readout)
  stats: Stat[];
}

// A LIVE or All time as Home showed it: when, and what it counted
export function SummarySection({ title, lines, action, stats }: Props) {
  const t = useT();
  const language = useLanguage();
  return (
    <Section
      title={title}
      description={lines.map((line, i) => (
        <span key={i} className={styles.line}>
          {line}
        </span>
      ))}
      actions={action}
    >
      <div
        className={styles.readout}
        // All's money in a row of its own when it has four currencies
        style={{
          gridTemplateColumns: `repeat(${Math.max(3, stats.filter((s) => s.currency).length)}, minmax(0, 1fr))`,
        }}
      >
        {stats.map(({ label, value, currency }) => {
          const { short, full } = statText(value, currency, language);
          return (
            <div key={label} className={styles.stat}>
              <span className={styles.stat_value} title={full}>
                {short}
              </span>
              <span className={styles.stat_label}>{t(label)}</span>
            </div>
          );
        })}
      </div>
    </Section>
  );
}
