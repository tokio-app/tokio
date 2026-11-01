import { Section } from "@/components";
import { formatStat } from "@/helper";
import { useLanguage, useT } from "@/ui/i18n";
import { ReactNode } from "react";
import styles from "../coinstats.module.css";
import { READOUT, Totals } from "../helper";

interface Props {
  title: string;
  // Each on its own line under the title
  lines: string[];
  // The icon button on the title's row
  action: ReactNode;
  totals: Totals;
}

// A LIVE or All time as Home showed it: when, and what it counted
export function SummarySection({ title, lines, action, totals }: Props) {
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
      <div className={styles.readout}>
        {READOUT.map(({ key, label }) => {
          const { short, full } = formatStat(totals[key], language);
          return (
            <div key={key} className={styles.stat}>
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
