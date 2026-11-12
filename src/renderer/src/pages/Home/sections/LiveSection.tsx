import { TopGifter } from "@/common/types";
import { Avatar, Section } from "@/components";
import { formatStat } from "@/helper";
import { coinsLabel } from "@/helper/gifts";
import { useLanguage, useT } from "@/ui/i18n";
import styles from "../home.module.css";
import { Stat } from "../helper";
import { ViewersChart } from "./ViewersChart";

interface Props {
  // TikTok's count now
  viewers: number;
  // Each minute's highest count, from main
  minutes: number[];
  // The LIVE's other numbers, TikTok's and counted since connecting
  stats: Stat[];
  // This LIVE's, most coins first
  gifters: TopGifter[];
}

// Short, with the exact number on hover, as the language writes them
function StatValue({ value, className }: { value: number; className: string }) {
  const language = useLanguage();
  const { short, full } = formatStat(value, language);
  return (
    <span className={className} title={full}>
      {short}
    </span>
  );
}

// Only while LIVE: the viewers and their line, the numbers and top gifters
export function LiveSection({ viewers, minutes, stats, gifters }: Props) {
  const t = useT();
  const language = useLanguage();
  return (
    <div className={styles.live}>
      <div className={styles.pulse}>
        <div className={styles.hero}>
          <StatValue value={viewers} className={styles.hero_value} />
          <span className={styles.stat_label}>{t("home.stats.viewers")}</span>
        </div>
        <ViewersChart viewers={minutes} liveCount={viewers} />
      </div>

      <div className={styles.stats}>
        {stats.map(({ label, value }) => (
          <div key={label} className={styles.stat}>
            <StatValue value={value} className={styles.stat_value} />
            <span className={styles.stat_label}>{t(label)}</span>
          </div>
        ))}
      </div>

      <Section title={t("home.gifters.title")}>
        {gifters.length === 0 ? (
          <p className={styles.quiet}>{t("home.gifters.empty")}</p>
        ) : (
          <ol className={styles.gifters} aria-label={t("home.gifters.title")}>
            {gifters.slice(0, 3).map((gifter, i) => {
              const name = gifter.username || gifter.handle;
              return (
                <li key={gifter.userId} className={styles.gifter}>
                  {/* The list's order already says it to screen readers */}
                  <span className={styles.rank} aria-hidden="true">
                    {i + 1}
                  </span>
                  <Avatar name={name} picture={gifter.picture} />
                  <span className={styles.gifter_body}>
                    <span
                      className={styles.gifter_name}
                      title={`@${gifter.handle}`}
                    >
                      {name}
                    </span>
                    <span className={styles.gifter_coins}>
                      {coinsLabel(gifter.live.coins, language)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ol>
        )}
      </Section>
    </div>
  );
}
